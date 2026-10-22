// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * ui.js — host glue ONLY: lifecycle, MIDI, LEDs, settings, the state machine.
 *
 * Everything with logic in it lives in a sibling .mjs and runs under plain
 * `node`. This file is the part that cannot be tested off-device, so it is
 * kept as close to empty of decisions as it can be.
 *
 * TWO HOST FACTS SHAPE THIS FILE.
 *
 *  - tick() runs at ~500Hz in overtake but the OLED tops out near 49Hz, so
 *    the draw is throttled off the clock and the rest of the frame returns
 *    early. Drawing every tick would spend the whole budget on a screen
 *    nobody can see change.
 *  - host_module_get_param / shadow_get_param cost ~2.8ms each, MORE THAN A
 *    WHOLE FRAME. Nothing in the draw path may call them, and
 *    tests/ui_contract.test.mjs asserts that none appears in this file.
 */

import {
  setLED,
  setButtonLED,
  invalidateLedCache,
  decodeDelta,
} from '/data/UserData/schwung/shared/input_filter.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';

import * as L from './layout.mjs';
import * as PAD from './padmap.mjs';
import * as PIO from './pads_io.mjs';
import * as PMS from './padmap_screen.mjs';
import * as KIT from './kit.mjs';
import * as C from './controls.mjs';
import * as SET from './settings_def.mjs';
import * as SC from './scoring.mjs';
import * as CH from './chart.mjs';
import * as V from './view.mjs';
import * as GEN from './generator.mjs';
import * as GR from './grid_render.mjs';
import * as CAT from './catalog.mjs';
import { dynOf } from './events.mjs';
import * as IO from './exercise_io.mjs';
import * as ST from './stats.mjs';
import * as LAD from './ladder.mjs';
import * as T from './transport.mjs';
import * as Q from './guess.mjs';
import * as AP from './answer_pads.mjs';
import * as PROG from './progress.mjs';
import * as PLAN from './program.mjs';
import * as LES from './lessons.mjs';
import * as ROWS from './path_rows.mjs';
import * as H from './hints.mjs';
import * as SH from './row_sheet.mjs';
import * as HP from './help.mjs';
import * as TIPS from './tips.mjs';
import * as UT from './untimed.mjs';
import { availableLevels } from './levels.mjs';
import * as IDS from './ids.mjs';
import { isUntimedId } from './ids.mjs';
import { paint, flashColor, guideTargets, FLASH_MS } from './led_paint.mjs';
import { stats as timingStats, statsSince, perVoice, voicesBySpread } from './timing.mjs';

const MODULE_DIR = '/data/UserData/schwung/modules/tools/drums-practice';
const SETTINGS_PATH = `${MODULE_DIR}/settings.json`;
/* The Custom pad layout (pads_io.mjs). */
const PADS_PATH = `${MODULE_DIR}/pads.json`;
/* Its second copy, as for stats and progress below: the host's write empties
 * the file before it fills it, so a save cut short leaves the other whole. */
const PADS_BAK_PATH = `${MODULE_DIR}/pads.bak.json`;
const STATS_PATH = `${MODULE_DIR}/stats.json`;
/* A second copy, written after the first: the host has no rename, so a save
 * cut short by the power going leaves one of the two whole. */
const STATS_BAK_PATH = `${MODULE_DIR}/stats.bak.json`;
/* A stats file that would not read, kept rather than overwritten. */
const STATS_BAD_PATH = `${MODULE_DIR}/stats.bad.json`;
/* How far you have got with every drill (progress.mjs), kept the same way. */
const PROGRESS_PATH = `${MODULE_DIR}/progress.json`;
const PROGRESS_BAK_PATH = `${MODULE_DIR}/progress.bak.json`;
const PROGRESS_BAD_PATH = `${MODULE_DIR}/progress.bad.json`;
/* A progress file of an earlier version, set aside when progress is rebuilt. */
const PROGRESS_OLD_PATH = `${MODULE_DIR}/progress.v1.json`;
const CRASH_PATH = `${MODULE_DIR}/crash.log`;
const EXERCISE_DIR = `${MODULE_DIR}/exercises`;

const DRAW_INTERVAL_MS = 20;
const LED_INTERVAL_MS = 20;
/* The MIDI out buffer holds ~64 packets and drains 31 per audio block, so
 * everything leaving here is paced. Flooding it drops notes silently. */
const OUTBOX_PER_TICK = 8;
const OUTBOX_MAX = 512;

/* Screens: named in hints.mjs, so none can go without a hint line. */
const {
  MENU, READY, RUNNING, SUMMARY, LADDER, QUIZ, RESULT, PROGRESS, PROGRESS_ITEM, SETTINGS, ERROR, CARD,
  PADMAP, SHEET, HELP, WELCOME, TIP,
} = H.SCREENS;

/* MIDI out routes. */
const OUT_TRACK = 1;
const OUT_USB = 2;
const OUT_INTERNAL = 4;

/* ---- the draw ctx ------------------------------------------------------- */
/* One thin wrapper over the host primitives, so view.mjs can be rendered into
 * a byte buffer in tests instead. One extra property lookup per call is
 * nothing beside the ~490ns QuickJS binding crossing. */
const ctx = {
  clear() { clear_screen(); },
  fillRect(x, y, w, h, v) { if (w > 0 && h > 0) fill_rect(x, y, w, h, v); },
  drawRect(x, y, w, h, v) { if (w > 0 && h > 0) draw_rect(x, y, w, h, v); },
  line(x0, y0, x1, y1, v) { draw_line(x0, y0, x1, y1, v); },
  text(x, y, s, v) { print(x, y, s, v); },
  textWidth(s) {
    if (typeof text_width === 'function') return text_width(s);
    return s.length * 6 - 1;
  },
};

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/* ---- files -------------------------------------------------------------- */
function readFile(path) {
  if (typeof host_read_file !== 'function') return null;
  try { return host_read_file(path); } catch (e) { return null; }
}

function writeFile(path, text) {
  if (typeof host_write_file !== 'function') return false;
  try { return host_write_file(path, text) === true; } catch (e) { return false; }
}

/* ---- failing safely ------------------------------------------------------ */
/*
 * THE RULE: nothing this module does may leave the Move needing a rescue.
 *
 * The first hardware run wedged the screen and left NOTHING behind — the log
 * held a successful init and then silence, and the only way out was a chord
 * the player had to be told about. Every part of this section exists because
 * of that.
 *
 *   guard()       no host callback may throw INTO the host. QuickJS runs this
 *                 on shadow_ui's loop; an exception there stops the frame and
 *                 the OLED simply keeps whatever it last had, which reads as a
 *                 freeze with no cause.
 *   panic         whatever broke, sixteen voices must not be left ringing.
 *   crash.log     the message is written next to the module, so a freeze can
 *                 be diagnosed over SSH afterwards instead of guessed at.
 *   safe mode     after a few failures the drill stops running entirely and
 *                 only the error screen is drawn. Retrying a path that throws
 *                 every frame is how a fault becomes a hang.
 *
 * An infinite loop still cannot be escaped from inside JavaScript, so the
 * defence against THAT is upstream: every loop in this module is bounded, and
 * `MAX_ENTRIES` in scoring.mjs is the backstop for the one that grows.
 */
const MAX_ERRORS = 5;
const SLOW_FRAME_MS = 250;

let errCount = 0;
let lastError = null;
let safeMode = false;
let crashWritten = false;
/*
 * Set when drawing the ERROR SCREEN ITSELF throws — which means a host draw
 * primitive is gone and nothing can be put on the display at all. At that
 * point the only useful thing left is to stop trying and stay responsive to
 * Back, so the player can close the module instead of being held by a loop
 * that repaints, fails, and panics the engine fifty times a second.
 */
let drawDead = false;

function describe(e) {
  if (!e) return 'unknown';
  const msg = e.message !== undefined ? e.message : String(e);
  return String(msg).slice(0, 120);
}

function recordError(where, e) {
  /*
   * Past the limit this does nothing but count. Everything below — the
   * panic, the file write, the screen change — is worth doing once and
   * ruinous to do every frame, and a path that throws at 50Hz will arrive
   * here 50 times a second for as long as the module is open.
   */
  errCount++;
  if (safeMode) return;
  lastError = { where, message: describe(e) };
  /* Silence first. Whatever else is broken, the kit must not be left ringing
   * behind a screen that is no longer responding. */
  try { dspSet('panic', '1'); } catch (ignored) { /* nothing left to try */ }
  if (errCount >= MAX_ERRORS) safeMode = true;
  screen = ERROR;

  /* Only the FIRST failure is written. A path that throws every frame would
   * otherwise put an eMMC write in the frame loop, which is how a fault
   * becomes a brick. */
  if (!crashWritten) {
    crashWritten = true;
    const stack = e && e.stack ? String(e.stack).slice(0, 600) : '';
    writeFile(CRASH_PATH,
      `${new Date().toISOString()}\n${where}: ${describe(e)}\n${stack}\n`);
  }
}

/* Run `fn`, and turn any throw into a screen the player can read. */
function guard(where, fn) {
  try {
    return fn();
  } catch (e) {
    recordError(where, e);
    return undefined;
  }
}

/* ---- state -------------------------------------------------------------- */
let settings = SET.coerceInto({}, null);
let stats = ST.emptyStats();
let statsDirty = false;
let progress = PROG.emptyProgress();
let progressDirty = false;
/* Folder sums over the tree, cached by folder against progress.rev. */
const agg = PROG.createAggregator();
/* The Learning Path's stages, every leaf by item id, and what each item is
 * called on its own — all made with the tree, once. */
let program = { stages: [], tracks: [] };
let pathNode = null;
let leafIdx = new Map();
let itemNames = new Map();
/* The step of the Learning Path the armed drill was opened as, so Click on
 * its result goes on along the path; null when it came from anywhere else. */
let pathStep = null;
/* The lesson cards (lessons.json), and the deck on screen (lessons.mjs):
 * { deck, then } — `then` is what Click goes on to once the last is read,
 * null when they were opened from Lessons to read again. */
let lessons = new Map();
let card = null;
/* How stuck the learner is on that step, for the result's footer (program.mjs
 * stuckLevel): 0, 1 suggest an easier way in, 2 parked for a day. */
let stuckNow = 0;
/* What the take just did to the drill's progress, for the result screens. */
let progressNote = null;
let settingsDirty = false;
let lastFlush = 0;

let screen = MENU;
/* The drill tree, and the folders open in it (catalog.mjs). */
let catalog = null;
let nav = [];
/* The chart the armed drill was built from, before the Tempo and Reps settings
 * were applied — re-armed from when one of those changes, so a random drill
 * keeps its notes and a level keeps its rung. */
let armedSource = null;
/* A word for the list's title bar, briefly: "BAD USER.JSON". */
let menuNote = '';
let menuNoteUntil = 0;
let settingsSel = 0;
let settingsEditing = false;
/* The rows the settings editor shows: one group's, opened from the
 * Settings folder, or every row, over a drill (settings_def.mjs). */
let settingsGroup = null;
let settingsDefs = SET.ROWS;
/* The Settings folder of the tree, for the sheet's Settings... */
let settingsNode = null;
/* The action sheet on screen (row_sheet.mjs): { title, items, sel, row }. */
let sheet = null;
/* MENU's help page on screen (help.mjs): { title, lines, top, back }. */
let help = null;
let helpTopics = new Map();
/* The welcome on screen (tips.mjs), and a tip card: { key, lines, back }. */
let welcome = null;
let welcomeLines = null;
let tipCard = null;
const WELCOME_PAGES = TIPS.welcomePages();
/* The panel's own measure, for fitting a page of text (help.mjs fitPage). */
const measure = (t) => ctx.textWidth(t);
/*
 * Continue alternates when reviews are due: one review, then one new step.
 * Which comes next is kept for the session only. `fromContinue` is set while
 * a review Continue opened is on screen, so Click on its result goes on as
 * Continue would.
 */
let continueTurn = 'review';
let fromContinue = false;
let progressSel = 0;
let progressRows = [];
/* The item the Progress chart is showing. */
let progressItem = null;
let progressRight = '';

let chart = null;
let run = null;
/*
 * DERIVED STATE, rebuilt by whatever invalidates it rather than by the draw.
 *
 * All five of these were recomputed on every frame from data that had not
 * changed: the settings rows cost 11.9us and the playability check 11.6us,
 * each MORE than drawing the entire scrolling chart. On QuickJS, interpreted
 * on a Cortex-A72, that is a real slice of a 20ms frame spent rebuilding an
 * answer nobody asked again.
 *
 * The rule the module keeps now: a draw reads, it does not compute.
 */
let settingsRowsCache = [];
let chartWarning = '';
let chartLanes = null;
let chartLength = '';
let resultCache = null;
let quiz = null;
/* The quiz's own name for its header: "PICK: GROOVE", not "pick: groove". */
let quizTitle = '';
let ladder = null;
let ladderReason = '';
/* Bars of the current rung held when a Ladder was stopped, for its screen. */
let ladderBarsDone = 0;
/* The armed drill's tempo — its own, scaled by Speed — kept apart from
 * `chart.bpm`, which the Ladder changes as it climbs. */
let armedBpm = 0;
/* The screen Settings was opened from, which leaving Settings returns to. */
let settingsFrom = MENU;
/* Whether the take on the summary beat every one before it. */
let summaryIsBest = false;
/* What the result screen shows beyond the run: worked out once when the run
 * stops, not on every frame of the result. */
let summaryInfo = null;
/* The take just recorded was the first at tempo, clean: the drill is learned. */
let takeLearned = false;
/*
 * Looking back over a finished take: { run, end, at }. `run` is the whole take
 * as it was judged (SC.reviewOf), `end` the beat it ended on, and `at` where
 * the review is — null while the result is showing. Turning back from the
 * result scrolls into the take; turning forward past its end brings the
 * result back.
 */
let review = null;
const REVIEW_UNITS_PER_BAR = 36;
/*
 * An L0 take (untimed.mjs) while one is running, else null. L0 has no clock:
 * the transport is only borrowed for its modes — Record's light, pause,
 * judging — and the tick never advances it.
 */
let untimed = null;
const isUntimed = () => Boolean(chart && chart.untimed);
let clockMode = false;
let shiftHeld = false;
/* Where the playhead is and what moves it: see transport.mjs. */
const tp = T.createTransport();

/*
 * THE TRANSPORT.
 *
 *   READY ─Play─▶ RUNNING ◀─Play─▶ PAUSED ─Back─▶ READY ─Back─▶ list
 *
 * Play, Record and Back all used to land on stop(), which threw the playhead
 * away — so there was no way to take a breath in the middle of a drill and
 * carry on. Play now HOLDS the position and Record does the same for
 * practice, so the two buttons behave alike; Back restarts, and because Back
 * from READY already goes to the list, pressing it twice leaves without
 * inventing a second gesture.
 *
 * Pausing shifts `startedAt` by the time spent stopped — the trick
 * `waitedBeats` already uses — so resuming carries on in tempo rather than
 * lurching forward to wall time.
 */
/*
 * The playhead was moved by the scrub knob since the music last ran, so the
 * pads show the stack it has landed on — whatever Guide pads says, because
 * scrubbing is finding your place, not playing. A freshly armed drill, a plain
 * pause and the moment the music runs all leave the pads to the usual rules.
 */
/* What Listen just played, lit until `listenLitUntil` (ms): a drum is a hit,
 * not a held key, so the light is a short flash in time with the sound. */
let listenLit = [];
let listenLitUntil = 0;
const LISTEN_LIT_MS = 120;
/*
 * Scrubbing is continuous, at SCRUB_UNITS_PER_BAR clicks to the bar — about a
 * third of a turn — rather than teleporting between bar lines. These encoders
 * send more than one unit per detent, which is why the other knobs already
 * clamp; this is the number most likely to need changing on the device.
 */
const SCRUB_UNITS_PER_BAR = 36;
/*
 * The judge's clock. Equal to songBeats except while Study holds the scroll on
 * a note, when it runs on in real time — see CH.applyWait. Everything that
 * SCORES reads this; everything that DRAWS reads songBeats.
 */
/* `waitedBeats` as it was when the current freeze began, or null. */
let beatFlash = false;

let lastDraw = 0;
let lastLed = 0;
const held = new Set();
let flash = null;
let flashUntil = 0;

const ledBuf = new Array(PAD.PAD_COUNT).fill(-1);
const ledPrev = new Array(PAD.PAD_COUNT).fill(-1);
const outbox = [];
/* The DSP parameter channel is a SINGLE-SLOT MAILBOX: one call per drum would
 * have a kick-and-snare overwrite itself and only the second would sound. So a
 * frame's hits are accumulated and sent as one write. */
let dspNotes = '';

/* ---- DSP ---------------------------------------------------------------- */
function dspSet(key, val) {
  if (typeof host_module_set_param !== 'function') return;
  try { host_module_set_param(key, val); } catch (e) { /* nothing to do here */ }
}

/*
 * A voice sounds as its General MIDI note (kit.mjs), in the kit and down a
 * MIDI route alike: the engine plays its recordings by GM note, and a Drum
 * Rack at the other end of a route answers the same drum.
 */
function sound(voice, vel) {
  const gm = KIT.gmOf(voice);
  if (!gm) return;
  if (settings.midiOut & OUT_INTERNAL) {
    dspNotes = dspNotes ? `${dspNotes},${gm}:${vel}` : `${gm}:${vel}`;
  }
  const route = settings.midiOut & (OUT_TRACK | OUT_USB);
  /* Both halves or neither: a note-on whose note-off was dropped on a full
   * queue is a note left sounding downstream. */
  if (route && outboxRoom() >= 2) {
    queue(route, 0x90 | midiChannel(), gm, vel);
    queue(route, 0x80 | midiChannel(), gm, 0);
  }
}

function midiChannel() {
  return settings.midiCh > 0 ? settings.midiCh - 1 : 9; /* 10 is the drum channel */
}

/*
 * Silence, in order with the strokes around it.
 *
 * The engine's parameter channel holds ONE value per tick, and the strokes go
 * last (flushDsp). A panic written straight away was overwritten whenever a
 * pad — or Listen — had queued a stroke earlier in the same tick, and a crash
 * rang on after Stop. So the panic goes INTO the stroke list, as `x`: what was
 * queued before it is dropped, what comes after it in this tick plays after
 * the cut. Closing, unloading and the error path keep the direct write —
 * nothing flushes after them.
 */
function panicDsp() {
  dspNotes = 'x';
}

function flushDsp() {
  if (!dspNotes) return;
  dspSet('n', dspNotes);
  dspNotes = '';
}

/* ---- MIDI out ----------------------------------------------------------- */
/*
 * Read from a moving head rather than shift()ed — shifting a queue is a copy
 * of all of it, four times a message — and emptied for reuse once drained.
 * `routesUsed` remembers where anything was ever sent, so the exit sweep only
 * goes down routes that could have a note sounding on them.
 */
let outboxHead = 0;
let routesUsed = 0;

function outboxRoom() {
  return (OUTBOX_MAX - (outbox.length - outboxHead)) >> 2;
}

function queue(route, status, d1, d2) {
  if (outboxRoom() < 1) return;
  routesUsed |= route;
  outbox.push(route, status, d1, d2);
}

function serviceOutbox(all) {
  let n = all ? (outbox.length - outboxHead) >> 2 : OUTBOX_PER_TICK;
  while (n-- > 0 && outboxHead < outbox.length) {
    const route = outbox[outboxHead];
    const status = outbox[outboxHead + 1];
    const d1 = outbox[outboxHead + 2];
    const d2 = outbox[outboxHead + 3];
    outboxHead += 4;
    if ((route & OUT_TRACK) && typeof move_midi_inject_to_move === 'function') {
      move_midi_inject_to_move([(2 << 4) | (status >> 4), status, d1, d2]);
    }
    if ((route & OUT_USB) && typeof move_midi_external_send === 'function') {
      move_midi_external_send([status >> 4, status, d1, d2]);
    }
  }
  if (outboxHead >= outbox.length) {
    outbox.length = 0;
    outboxHead = 0;
  }
}

/* Drop whatever is still queued: on the way out, silence goes first. */
function clearOutbox() {
  outbox.length = 0;
  outboxHead = 0;
}

/* ---- LEDs --------------------------------------------------------------- */
/* The stack a parked playhead has landed on, as guide targets. */
function scrubTargets() {
  if (!tp.scrubCue || !run || !(screen === READY || (screen === RUNNING && tp.paused))) return null;
  const e = run.entries[SC.nextEntryIndex(run, Math.max(0, tp.songBeats))];
  if (!e) return null;
  return e.notes.map((n) => ({
    voice: n.voice,
    hand: run.sticking !== 'off' ? n.wantHand : null,
    beatsAway: 0,
  }));
}

/* The drum Study has stopped for. A rescue, so it lives behind Guide pads like
 * every other hint: this is a reading trainer first. */
function stuckTargets() {
  if (!settings.guide || !tp.blocked || !run || screen !== RUNNING) return null;
  const notes = SC.blockingNotes(run);
  if (!notes.length) return null;
  return notes.map((n) => ({ voice: n.voice, hand: run.sticking !== 'off' ? n.wantHand : null }));
}

/* One state object for the LED paint, filled in place: it was a new object
 * literal on every repaint, fifty times a second. */
const paintState = {
  layout: null, held: null, flash: null, targets: null, sounding: null,
  stuck: null, phase: 0, prompt: null, answerPads: null, answerColours: null, dark: false,
};
const promptBuf = [null];
const answerColourBuf = [];
const answerStruck = (i) => Q.isEliminated(quiz, i);

/*
 * The answer bar: a multiple-choice drill's answers as coloured pads along the
 * bottom row (answer_pads.mjs), as Piano Practice does it. Only for the Pick
 * drills, which ask for a NAME — in Guess: drum and Hear: drum the answer is a
 * drum, and the bottom row holds drums.
 */
function answerBarActive() {
  return screen === QUIZ && Boolean(quiz) && quiz.mode === 'pick' && quiz.options.length > 0;
}

function paintLeds(t) {
  const st = paintState;
  st.layout = layoutNow();
  st.held = held;
  st.flash = flash && t < flashUntil ? flash : null;
  st.targets = scrubTargets() || (settings.guide && run && screen === RUNNING
    ? (untimed ? UT.targets(untimed) : guideTargets(run, tp.songBeats)) : null);
  st.sounding = t < listenLitUntil && ((tp.mode === C.MODE_LISTEN && screen === RUNNING)
    || (isUntimed() && (screen === READY || screen === RUNNING))) ? listenLit : null;
  st.stuck = stuckTargets();
  st.selected = padMapSelected();
  st.phase = Math.floor(t / 500) % 2;
  /* The second hint lights the pad. Only for the drills whose answer IS a
   * pad — naming a groove has no pad to light, and a Pick drill's hints strike
   * out answers instead. */
  if (screen === QUIZ && quiz && quiz.kind === 'voice' && quiz.mode !== 'pick' && quiz.hints >= 2) {
    promptBuf[0] = quiz.prompt;
    st.prompt = promptBuf;
  } else {
    st.prompt = null;
  }
  if (answerBarActive()) {
    const n = quiz.options.length;
    st.answerPads = AP.answerPads(n);
    st.answerColours = AP.answerLeds(n, quiz.revealed ? -1 : quiz.choice, answerStruck,
      st.phase, answerColourBuf);
  } else {
    st.answerPads = null;
  }
  st.dark = false;
  paint(ledBuf, st);
  for (let i = 0; i < PAD.PAD_COUNT; i++) {
    if (ledBuf[i] === ledPrev[i]) continue;
    ledPrev[i] = ledBuf[i];
    setLED(PAD.PAD_FIRST + i, ledBuf[i]);
  }
}

function darkenPads() {
  for (let i = 0; i < PAD.PAD_COUNT; i++) {
    ledPrev[i] = -1;
    setLED(PAD.PAD_FIRST + i, PAD.LED_OFF);
  }
}

function transport() {
  const phase = (now() / 600) % 1;
  /* Paused pulses rather than sitting steady, which would claim something is
   * running. Paused and stuck both show a motionless scroll and only one of
   * them is waiting for you. */
  const running = tp.paused ? C.MODE_IDLE : tp.mode;
  const colors = C.transportColors(running, screen === READY || screen === RUNNING, phase);
  setButtonLED(C.CC_PLAY, colors.play);
  setButtonLED(C.CC_RECORD, colors.record);
}

/* ---- persistence -------------------------------------------------------- */
/*
 * Saved lazily. Writing the file inline would put a blocking eMMC write in
 * the frame path; the flag is set here and flushed at most once a second, and
 * always on the way out.
 */
function saveSettings() { settingsDirty = true; }
function saveStats() { statsDirty = true; }
function saveProgress() { progressDirty = true; }

function flushFiles(force) {
  const t = now();
  if (!force && t - lastFlush < 1000) return;
  lastFlush = t;
  if (settingsDirty) {
    settingsDirty = !writeFile(SETTINGS_PATH, SET.serialiseSettings(settings));
  }
  if (statsDirty) {
    const text = ST.serialiseStats(stats);
    statsDirty = !writeFile(STATS_PATH, text);
    if (!statsDirty) writeFile(STATS_BAK_PATH, text);
  }
  if (progressDirty) {
    const text = PROG.serialiseProgress(progress);
    progressDirty = !writeFile(PROGRESS_PATH, text);
    if (!progressDirty) writeFile(PROGRESS_BAK_PATH, text);
  }
}

/*
 * The history, from the main file or, if that will not read, its backup. A
 * damaged main file is kept aside as stats.bad.json: it used to read as empty
 * and be overwritten by the next save, which is every take you ever recorded.
 */
function loadStats() {
  const text = readFile(STATS_PATH);
  const main = ST.readStats(text);
  if (main.ok) return main.stats;
  if (text) writeFile(STATS_BAD_PATH, text);
  const bak = ST.readStats(readFile(STATS_BAK_PATH));
  return bak.ok ? bak.stats : ST.emptyStats();
}

/*
 * Progress, the same way: the main file, else its backup, a damaged main file
 * kept aside. With neither file there — the first start of a version that
 * has progress — the takes already in stats.json are read into it, so a week
 * of practice before the update is not lost to it. A file of an earlier
 * version is set aside whole and progress is rebuilt from stats.json the same
 * way, judged by today's rules.
 */
function loadProgress() {
  const text = readFile(PROGRESS_PATH);
  const main = PROG.readProgress(text);
  if (main.ok) return main.progress;
  if (main.stale) {
    writeFile(PROGRESS_OLD_PATH, text);
    /* Saved even when stats.json had nothing in it, so the old file is not
     * found, and set aside, again on every start. What the old file had
     * reached is merged in: the stats log is capped, the old file is not. */
    return PROG.mergeLegacy(rebuildProgress(true), main.legacy);
  }
  if (text) writeFile(PROGRESS_BAD_PATH, text);
  const bakText = readFile(PROGRESS_BAK_PATH);
  const bak = PROG.readProgress(bakText);
  if (bak.ok) return bak.progress;
  if (text || bakText) return PROG.emptyProgress();
  return rebuildProgress();
}

function rebuildProgress(always = false) {
  const fresh = PROG.importStats(PROG.emptyProgress(), stats.records, itemOfRecord, writtenOf);
  if (fresh.rev || always) saveProgress();
  return fresh;
}

/*
 * The item a stats record belongs to: its drill id without the kind in front
 * and the strictness and sticking behind — "drill:rock-backbeat:l2:normal" is
 * the item "rock-backbeat:l2". A quiz round is filed as "pick:groove".
 */
function itemOfRecord(rec) {
  const id = IDS.itemOfDrillId(rec.d);
  if (!id || IDS.isQuizItemId(id) || IDS.isClockItemId(id)) return id;
  return itemNames.has(id) ? id : null;
}

/*
 * The tempo an item is written at, which a clean speed is measured against:
 * a file's own tempo, or for a generated drill its target on the path. A
 * Clock's is the drill it wraps.
 */
function writtenOf(id, rec) {
  if (id === CAT.CLOCK_ID && rec) {
    const wrapped = itemOfRecord({ d: `drill:${String(rec.d).split(':').slice(1).join(':')}` });
    return wrapped ? writtenOf(wrapped) : settings.bpm;
  }
  if (PLAN.targetBpm(id)) return PLAN.targetBpm(id);
  const node = leafIdx.get(id);
  const c = node && node.kind === 'chart' ? fileChartOf(id) : null;
  return c ? c.bpm : settings.bpm;
}

function fileChartOf(id) {
  const r = IDS.parseLevelId(id);
  const base = r ? r.base : id;
  for (let i = 0; i < fileCharts.length; i++) if (fileCharts[i].id === base) return fileCharts[i];
  return null;
}

/* ---- the drill list ----------------------------------------------------- */
let fileCharts = [];
/* [{ chart, category }] in manifest order, and the categories to file them in. */
let fileEntries = [];
let fileCategories = [];

/*
 * TWO manifests, and the split is load-bearing.
 *
 *   index.json  what this module ships. REPLACED on every update.
 *   user.json   what you added. PRESERVED across updates.
 *
 * There is no directory-listing call in the host, which is why a manifest
 * exists at all. One manifest was not enough: the install preserves
 * hand-added exercise FILES but overwrites index.json, so before this a drill
 * you wrote survived an update with its entry gone — the file was still
 * there and it never appeared in the list again. It also meant a drill this
 * module stopped shipping was copied forward for ever.
 */
function loadExercises() {
  fileCharts = [];
  fileEntries = [];
  fileCategories = [];
  loadManifest(`${EXERCISE_DIR}/index.json`);
  loadManifest(`${EXERCISE_DIR}/user.json`);
}

/* A manifest that will not parse is reported in the list's title, once, and
 * otherwise skipped: the shipped drills still load. */
let manifestError = '';

function loadManifest(path) {
  const text = readFile(path);
  if (!text) return;
  const parsed = IO.parseManifest(text, path.slice(path.lastIndexOf('/') + 1));
  const entries = parsed.entries || [];
  const categories = parsed.categories || [];
  if (parsed.error && !manifestError) manifestError = parsed.error;
  /* The shipped manifest declares the categories; user.json may file a drill
   * into one of them, and anything else lands in Other. */
  for (const c of categories) {
    if (!fileCategories.some((x) => x.id === c.id)) fileCategories.push(c);
  }
  for (const e of entries) {
    const text2 = readFile(`${EXERCISE_DIR}/${e.file}`);
    if (!text2) continue;
    const r = IO.parseExercise(text2, e.id);
    /* A drill that does not validate simply does not appear. Loading it
     * half-formed would mean being marked down for someone else's typo. */
    if (!r.chart) continue;
    fileCharts.push(r.chart);
    fileEntries.push({ chart: r.chart, category: e.category });
  }
}

/*
 * THE FIRST THING IN THE LIST IS THE NEXT THING TO PLAY: Continue, then the
 * Path, the Practice library, Quiz, Progress and Settings — the top level
 * Piano Practice shares (catalog.mjs). Each is a folder, so the top of the
 * list is six rows rather than forty-eight.
 *
 * Built once, when the material is loaded. Every leaf is indexed by its item
 * id here too, which makes the lazy folders: the folder sums need every leaf
 * anyway, and doing it now keeps that work out of the frames that follow.
 */
function rebuildMenu() {
  itemNames = namesOfItems();
  program = PLAN.buildProgram({
    entries: fileEntries,
    categories: fileCategories,
    has: (id) => itemNames.has(id) && !IDS.isQuizItemId(id),
    label: itemTitle,
  });
  /* A pooled quiz is an item of its own, named by its step. */
  for (const stage of program.stages) {
    for (const st of PLAN.coreSteps(stage).concat(PLAN.electiveSteps(stage))) {
      if (st.quiz) itemNames.set(st.id, st.label);
    }
  }
  pathNode = PLAN.programFolder(program, reviewRows);
  catalog = CAT.drumsTree({
    entries: fileEntries,
    categories: fileCategories,
    bpm: settings.bpm,
    drills: Q.DRILLS,
    newSeed: () => (Date.now() & 0x7fffffff) || 1,
    path: pathNode,
    pathPrefs: PLAN.pathSettingsFolder(fileCategories.filter((c) => c.folder === 'Grooves')),
  });
  settingsNode = catalog.children.find((c) => c.label === 'Settings') || null;
  nav = CAT.navStart(catalog);
  leafIdx = CAT.leafIndex(catalog);
  PROG.resetShape(agg);
  rowsNode = null;
}

/* What every item is called on its own, outside the folder that holds it:
 * "Rock backbeat L2", not "L2 + kick". */
function namesOfItems() {
  const names = new Map();
  for (const e of fileEntries) {
    const levels = availableLevels(e.chart);
    if (levels.length > 1) {
      for (const lv of levels) names.set(`${e.chart.id}:${lv.id}`, `${e.chart.name} ${lv.step}`);
    } else {
      names.set(e.chart.id, e.chart.name);
    }
  }
  for (const c of GEN.builtins({})) names.set(c.family, c.name);
  for (const d of GEN.RANDOM_DRILLS) names.set(d.family, d.name);
  for (const d of Q.DRILLS) names.set(PLAN.quizItemId(d), d.name);
  names.set(CAT.CLOCK_ID, 'Clock');
  return names;
}

function itemTitle(id) {
  return itemNames.get(id) || id;
}

/* What is due again today, as the rows of Path › Review — and the ones
 * already played today, ticked. None at all, and the Path shows no Review. */
function reviewRows() {
  const session = PROG.repetitionSession(progress, Date.now());
  return session.map((r) => ({
    label: itemTitle(r.id),
    value: r.done ? 'today' : 'due',
    mark: r.done ? PROG.MARK_DONE : null,
    repId: r.id,
  }));
}

/* ---- arming and running ------------------------------------------------- */
function armChart(c) {
  /* Every drill plays at its own tempo times Speed — a generated drill's own
   * tempo being the Tempo setting. A hand-written drill used to ignore both,
   * so the eighty-odd grooves and rudiments could not be slowed down at all. */
  const base = c.generated ? settings.bpm : c.bpm;
  chart = { ...c, bpm: Math.max(20, Math.round((base * settings.speed) / 100)) };
  armedBpm = chart.bpm;
  /*
   * How long a practice is belongs to the FILE. `reps` is an override for
   * when you want to play something longer today, and 0 means "as written" —
   * so leaving it alone keeps the author's intent.
   */
  if (settings.reps > 0) chart.repeats = settings.reps;
  /* L0 keeps every stack of the take for its page and its review, so a take
   * is held under the run's entry ceiling: past it the cursor would reach
   * the end of what was built and wait there for ever. */
  if (chart.untimed) {
    const per = Math.max(1, (chart.events || []).length);
    chart.repeats = Math.max(1, Math.min(chart.repeats, Math.floor(SC.MAX_ENTRIES / per)));
  }
  run = SC.createRun(chart, runOpts());
  /* Everything about the armed drill that the draw would otherwise work out
   * again fifty times a second. */
  chartWarning = warningFor(chart);
  chartLanes = GR.lanes(KIT.voicesInChart(chart));
  chartLength = chart.untimed ? IO.untimedLength(chart) : IO.practiceLength(chart);
  /* A newly armed drill starts at home, where the box is. */
  T.home(tp);
  review = null;
  untimed = null;
  clearPrompt();
  if (ladder) ladder = newLadder();
  screen = READY;
  announce(`${chart.name} ready`);
}

/* A Ladder for the armed drill: from 70% of its tempo, climbing through it. */
function newLadder() {
  const step = settings.ladderStep;
  return LAD.createLadder({
    bpm: LAD.startFor(armedBpm, step),
    target: armedBpm,
    step,
    bars: settings.ladderBars,
    maxBpm: Math.max(240, armedBpm + step * 8),
  });
}

/* Change the tempo under a run: the chart, the run's windows and the clock. */
function setTempo(bpm) {
  chart = { ...chart, bpm };
  if (run) SC.setTempo(run, bpm);
  T.rebaseTempo(tp, now(), bpm);
}

/* Knob 8 in a drill: Speed, a step at a time. On the ready screen the drill is
 * re-armed at the new tempo; mid-run the tempo changes under you and the run
 * stops counting as a whole attempt. The Ladder sets its own tempo. */
function changeSpeed(delta) {
  if (ladder) return;
  const before = settings.speed;
  SET.applySetting(settings, 'speed', delta > 0 ? 1 : -1);
  if (settings.speed === before) return;
  refreshSettingsRows();
  saveSettings();
  const base = armedSource && armedSource.generated ? settings.bpm : (armedSource ? armedSource.bpm : chart.bpm);
  armedBpm = Math.max(20, Math.round((base * settings.speed) / 100));
  if (screen === READY) {
    chart = { ...chart, bpm: armedBpm };
    run = SC.createRun(chart, runOpts());
  } else if (untimed) {
    /* L0 has no tempo to change under you: Speed is only how fast Play
     * sounds the bar, and the take carries on whole. */
    chart = { ...chart, bpm: armedBpm };
  } else {
    setTempo(armedBpm);
    tp.scrubbed = true;
  }
  announce(`speed ${settings.speed} percent, ${armedBpm} bpm`);
}

function runOpts() {
  return {
    bpm: chart.bpm,
    strictness: settings.strictness,
    sticking: chart.sticking === 'off' ? 'off' : settings.sticking,
    dynamics: settings.dynamics,
    accentLift: settings.accentLift,
    ghostDrop: settings.ghostDrop,
    latencyMs: settings.latencyMs,
    /* The Ladder and the Clock outlast the drill they wrap and impose their
     * own ending, so they run it endless. Everything else ends when the
     * written practice does. */
    repeats: (ladder || clockMode) ? 0 : undefined,
  };
}

function start(practice) {
  if (isUntimed()) {
    startUntimed(practice);
    return;
  }
  /*
   * Start where the playhead IS, not always at the top: scrubbing the ready
   * screen is how you pick a passage, and resetting would make that pointless.
   * NO COUNT-IN WHEN STARTING MID-DRILL: it exists to orient you at the top,
   * you have just been looking at the bar you picked, and with Study on the
   * scroll halts at the first note anyway.
   */
  run = SC.createRun(chart, runOpts());
  const from = T.start(tp, {
    mode: practice ? C.MODE_PRACTICE : C.MODE_LISTEN,
    nowMs: now(),
    bpm: chart.bpm,
    countInBeats: -C.countInStart(settings.countIn),
  });
  /* seekTo settles the bars behind the start point rather than counting them
   * as missed, and rewinds both cursors so the run does not open with a
   * backlog to expire. */
  if (from > 0) {
    SC.ensureEntries(run, from + 8);
    SC.seekTo(run, from);
  }
  screen = RUNNING;
  if (ladder) {
    /* A fresh climb every time, from the drill's own tempo — never from the
     * tempo the last attempt reached. */
    ladder = newLadder();
    setTempo(ladder.bpm);
    /* From the top, the first rung begins when the count-in ends, so a tap
     * while counting in is not a stray against it. */
    ladder.started = from > 0;
    if (from > 0) LAD.beginRung(ladder, run, from);
  }
  announce(practice ? 'practising' : 'listening');
}

/*
 * L0. Record begins at once — there is no count-in, because there is nothing
 * to count in to — from the top, or from the bar the ready screen was scrubbed
 * to (a passage, so not kept, as on every rung). Play does not start a take:
 * it sounds the bar at its written tempo, so the groove can be heard before
 * it is stepped.
 */
function startUntimed(practice) {
  if (!practice) {
    hearBar();
    return;
  }
  if (untimedUnplayable()) {
    announce(`L0 needs every drum of the groove: no ${missingOnPads()[0]} on these pads.`);
    return;
  }
  clearPrompt();
  run = SC.createRun(chart, runOpts());
  const from = T.start(tp, { mode: C.MODE_PRACTICE, nowMs: now(), bpm: chart.bpm, countInBeats: 0 });
  let index = 0;
  if (from > 0) {
    SC.ensureEntries(run, from + 8);
    SC.seekTo(run, from);
    index = Math.max(0, SC.nextEntryIndex(run, from));
  }
  beginActivity('untimed');
  untimed = UT.createUntimed(run, { togetherMs: SC.WINDOWS[settings.strictness].goodMs, from: index });
  screen = RUNNING;
  announce('own pace');
}

/*
 * The drums the armed chart asks for that the pads in force cannot reach:
 * a Custom layout without a hat foot, the cowbell on Chromatic, every drum
 * but the snare on Sticking. A timed rung scores such a note a miss and the
 * clock moves on — so the ready box says so before it starts, naming the drum
 * — and L0, which has no clock and would wait on it for ever, refuses.
 */
function missingOnPads(c = chart) {
  return c ? PAD.missingVoices(c, padLayout) : [];
}

/* The one line the ready box gives a drill that cannot be played as it is. */
function warningFor(c) {
  const missing = missingOnPads(c);
  return IO.playabilityWarnings(c)[0] || (missing.length ? `NO ${missing[0]} ON PADS` : '');
}

function untimedUnplayable() {
  return Boolean(chart && chart.untimed && missingOnPads().length);
}

/*
 * Play on L0: the bar on the page, sounded once at the drill's tempo times
 * Speed, its pads lit as it goes. Laid out on the wall clock through the
 * quiz's prompt queue — it is the same job, a figure sounded with nothing to
 * keep time with — and nothing about the take changes while it plays.
 */
function hearBar() {
  clearPrompt();
  if (!run || !chart) return;
  const perBar = CH.beatsPerBar(chart);
  const cursor = untimed ? untimed.index : Math.max(0, SC.nextEntryIndex(run, Math.max(0, tp.songBeats)));
  const from = V.pageBar(run, cursor, perBar) * perBar;
  const beatMs = 60000 / (chart.bpm || 90);
  const t = now();
  for (const e of run.entries) {
    if (e.beat < from - 1e-9) continue;
    if (e.beat >= from + perBar - 1e-9) break;
    for (const n of e.notes) {
      promptQueue.push({ atMs: t + (e.beat - from) * beatMs, voice: n.voice,
        vel: n.wantDyn === 'accent' ? 115 : n.wantDyn === 'ghost' ? 45 : 90, lit: true });
    }
  }
  announce('listen');
}

/* Hold the playhead. The clock stops; the panel does not. */
function pause() {
  if (!T.pause(tp, now())) return;
  if (untimed) UT.pause(untimed);
  panicDsp();
  announce('paused');
}

function resume() {
  if (!T.resume(tp, now())) return;
  announce('playing');
}

function togglePause() {
  if (tp.paused) resume();
  else pause();
}

/*
 * A transport button pressed mid-run. Its OWN mode's button pauses and
 * resumes; the OTHER one switches in place, from wherever the playhead is —
 * watch a bar, then play it, without going back to the top. Switching into
 * practice re-arms the notes ahead, which Listen had marked as played.
 */
function transportPress(want) {
  /* L0 has nothing to listen to in place: Play sounds the bar, and Record
   * pauses and resumes. */
  if (untimed) {
    if (want === C.MODE_LISTEN) hearBar();
    else togglePause();
    return;
  }
  if (tp.mode === want) { togglePause(); return; }
  const at = T.switchMode(tp, want, now(), chart.bpm);
  if (want === C.MODE_PRACTICE) SC.seekTo(run, at);
  panicDsp();
  if (tp.paused) resume();
  announce(want === C.MODE_PRACTICE ? 'practising' : 'listening');
}

/*
 * READY, at the top of the drill, with a fresh run. Every way onto the ready
 * screen comes through here — arming a drill, Back from a run, on from a
 * result or the Ladder — because the one that did not (a result) started the
 * next attempt at the end of the last one, and it ended on the spot.
 */
function enterReady() {
  panicDsp();
  review = null;
  untimed = null;
  clearPrompt();
  T.home(tp);
  if (ladder) chart = { ...chart, bpm: armedBpm };
  run = SC.createRun(chart, runOpts());
  screen = READY;
}

/* Back from a run restarts it, rather than ending it. */
function restart() {
  enterReady();
  announce(`${chart.name} ready`);
}

/*
 * Scrub, while stopped or paused.
 *
 * A SEEK IS NOT A CLOCK MOVE: the notes behind settle, the notes ahead re-arm
 * so the bar can be taken again, and the markers from the previous attempt
 * drop. `SC.seekTo` does that; the transport solves the clock for the new
 * position from the moment the clock is standing at, so resuming carries on
 * from here.
 */
function scrub(delta) {
  if (!run || !chart) return;
  const perBar = CH.beatsPerBar(chart);
  /*
   * COUNT IN UNITS, NOT IN BEATS. Adding perBar/36 per click accumulates
   * binary error: 72 clicks of 4/36 lands on 7.999999999999998, so two full
   * bars of turning would read bar 2 beat 4 and the counter would sit an
   * epsilon behind the hand for the rest of the drill. Multiplying once is
   * exact, and the round also snaps a playhead left off-grid back onto it.
   *
   * The base is floored at zero because the count-in sits below zero until
   * the run starts; without it the first click is spent climbing out.
   */
  const base = Math.max(0, tp.songBeats);
  const units = Math.round((base * SCRUB_UNITS_PER_BAR) / perBar) + delta;
  let limit = Number.isFinite(run.endBeat) ? run.endBeat : base + perBar;
  /* L0 starts on a stack, so its scrub stops at the last bar that holds one:
   * an empty last bar has nothing to start on. */
  if (isUntimed() && run.entries.length) {
    const last = run.entries[run.entries.length - 1].beat;
    limit = Math.min(limit, (Math.floor(last / perBar) + 1) * perBar);
  }
  let to = (units * perBar) / SCRUB_UNITS_PER_BAR;
  to = Math.max(0, Math.min(Math.max(0, limit - perBar), to));
  tp.scrubCue = true;
  if (Math.abs(to - tp.songBeats) < 1e-9) return;
  T.seek(tp, to, now(), chart.bpm);
  SC.ensureEntries(run, to + 8);
  SC.seekTo(run, to);
  panicDsp();
}

/*
 * The run is over. Recorded only when it was a whole attempt: practised, from
 * the top, never scrubbed — a passage worked on from a chosen bar is practice
 * on that passage, and its numbers do not belong on the drill's chart. A
 * Ladder records itself (serviceLadder), once.
 */
function stop() {
  panicDsp();
  summaryIsBest = false;
  if (!ladder) progressNote = null;
  if (ladder) {
    ladderBarsDone = Math.max(0, Math.min(ladder.bars,
      Math.floor((tp.songBeats - ladder.windowStart) / CH.beatsPerBar(chart))));
  }
  const whole = tp.mode === C.MODE_PRACTICE && !tp.scrubbed && run && run.hits > 0;
  takeLearned = false;
  const judged = judgeRun();
  if (whole && !ladder) recordRun(judged);
  summaryInfo = resultOf(whole, judged);
  const endAt = Number.isFinite(run.endBeat) ? Math.min(run.endBeat, Math.max(0, tp.songBeats))
    : Math.max(0, tp.songBeats);
  review = { run: SC.reviewOf(run), end: endAt, at: null };
  T.home(tp);
  screen = ladder ? LADDER : SUMMARY;
}

/*
 * An L0 take is through: its own verdict (progress.mjs untimedVerdictOf), its
 * own record, its own result — with the result screen's layout. Study does
 * not ease it: L0 already waits for you. Kept only when whole — never
 * started from a scrubbed bar.
 */
function stopUntimed() {
  panicDsp();
  clearPrompt();
  summaryIsBest = false;
  progressNote = null;
  takeLearned = false;
  const c = UT.counts(untimed);
  const judged = {
    c,
    verdict: PROG.untimedVerdictOf(c),
    eased: PROG.easedBy({ ...judgingContext(), study: false }),
    pace: untimed.pace,
    dyn: PROG.dynamicsScore(c),
  };
  const whole = !tp.scrubbed && c.stacks > 0;
  if (whole) recordUntimed(judged);
  summaryInfo = untimedResultOf(whole, judged);
  review = { run: SC.reviewOf(run), end: run.endBeat, at: null, untimed: true };
  untimed = null;
  T.home(tp);
  screen = SUMMARY;
}

function recordUntimed({ c, verdict, eased, pace, dyn }) {
  const rec = ST.makeRecord({
    drill: ST.drillId('untimed', recordIdOf(chart), settings),
    bpm: pace,
    n: c.firstTry,
    err: c.stacks - c.firstTry,
    at: Date.now() / 1000,
    context: attemptContext(),
    total: c.stacks,
    clean: verdict.clean && !eased,
    breakdown: { strays: c.wrong, stickErrors: c.hand, dynErrors: c.dynErrors,
      softAccents: c.softAccents, loudGhosts: c.loudGhosts },
    dyn: dyn.score,
  });
  stats = ST.addRecord(stats, rec);
  summaryIsBest = ST.forDrill(stats, rec.d).length > 1 && ST.isPersonalBest(stats, rec);
  saveStats();
  const r = PROG.recordUntimed(progress, armedItemId(), {
    pace: PROG.speedOf(pace, armedWrittenBpm()), accuracy: verdict.accuracy,
    clean: verdict.clean, eased, bpm: pace, dyn: dyn.score, at: Date.now(),
  });
  saveProgress();
  takeLearned = r.learned;
  if (r.learned) announce('learned');
}

/*
 * The result of an L0 take, in the timed result's layout. The headline is the
 * PACE when the take counted — as a share of the written tempo, so the list,
 * the chart and the result all read the same number — and how much was right
 * first time when it did not. Beside it: right first time, and the pace in
 * beats a minute against the tempo it is written at.
 */
function untimedResultOf(whole, { c, verdict, eased, pace, dyn }) {
  const clean = verdict.clean;
  const counted = whole;
  const share = Math.round(PROG.CLEAN_SHARE * 100);
  const right = Math.floor(verdict.accuracy * 100);
  const failAcc = counted && !clean && c.stacks > 0;
  let cause = '';
  if (counted && !clean) cause = verdict.reason;
  else if (counted && clean && eased) cause = `not counted: ${eased}`;
  const it = PROG.item(progress, armedItemId());
  const box = V.SUMMARY_PLOT;
  return {
    name: chart.name,
    clean: !counted || clean,
    speed: PROG.speedOf(pace, armedWrittenBpm()),
    accuracy: verdict.accuracy,
    share,
    failAcc,
    failSd: false,
    status: PROG.takeStatus({ whole, study: false, learned: takeLearned, clean,
      best: summaryIsBest, eased }),
    mark: takeLearned ? PROG.MARK_DONE : null,
    cause,
    sideA: !counted || clean ? `${right}% 1st try` : (failAcc ? `1st try, need ${share}` : '1st try'),
    sideB: pace > 0 ? `${Math.round(pace)} of ${armedWrittenBpm()}bpm` : 'pace --',
    rowLeft: `${c.stacks} stacks`,
    limb: '',
    dyn: dyn.score,
    dynAdvice: dyn.score >= 0 && dyn.score < PROG.DYN_GOOD ? PROG.dynamicsAdvice(c) : '',
    series: PROG.percentSeries(it ? it.h : [], box.w - 2, box.h - 2, PROG.UNTIMED_SCALE),
  };
}

/*
 * The verdict on the run, worked out once when it ends (progress.mjs
 * verdictOf). The record, the progress and the result screen all read this
 * one: they each used to judge the take for themselves, and disagreed.
 */
function judgeRun() {
  const t = timingStats(run.timing);
  const st = SC.runStats(run);
  const verdict = PROG.verdictOf(st, t.sdMs, { spreadMs: SC.WINDOWS[settings.strictness].goodMs });
  return { t, st, verdict, eased: PROG.easedBy(judgingContext()), dyn: PROG.dynamicsScore(st) };
}

/* What the take was judged WITH, for easedBy. */
function judgingContext() {
  return {
    strictness: settings.strictness,
    guide: settings.guide,
    study: settings.study,
  };
}

/*
 * Everything the result screen shows, worked out once when the take ends: the
 * draw only reads it. The chart is the drill's history after this take, so
 * the take is its last point — or, when it was not kept, the history it was
 * not added to.
 *
 * The headline is the number that DECIDED the take. A clean take is measured
 * by its speed, so that is its number. A take that did not count headlines
 * how much of it was right, with what cost the most under it: it used to
 * headline the speed — 100 for every take at the written tempo — and a failed
 * take read like a perfect one.
 */
function resultOf(whole, { t, st, verdict, eased, dyn }) {
  const counted = whole && !settings.study;
  const clean = verdict.clean;
  const status = PROG.takeStatus({ whole, study: settings.study, learned: takeLearned, clean,
    best: summaryIsBest, eased });
  const loosest = voicesBySpread(run.timing)[0];
  let limb = '';
  if (loosest) {
    const v = perVoice(run.timing)[loosest];
    const k = KIT.voiceById(loosest);
    const mean = Math.round(v.meanMs);
    limb = `${k ? k.short : loosest} ${mean >= 0 ? '+' : ''}${mean} s${Math.round(v.sdMs)}`;
  }
  /* The cause, when it is not the spread: the spread is already on the side,
   * and then the loosest limb is the line worth reading. */
  let cause = '';
  if (counted && !clean && verdict.cause !== 'spread') cause = verdict.reason;
  else if (counted && clean && eased) cause = `not counted: ${eased}`;
  const it = PROG.item(progress, armedItemId());
  const box = V.SUMMARY_PLOT;
  return {
    name: chart.name,
    bpm: chart.bpm,
    clean: !counted || clean,
    speed: PROG.speedOf(chart.bpm, armedWrittenBpm()),
    accuracy: verdict.accuracy,
    share: Math.round(PROG.CLEAN_SHARE * 100),
    sdMs: t.sdMs,
    meanMs: t.meanMs,
    failAcc: counted && verdict.cause !== '' && verdict.cause !== 'spread' && st.hits > 0,
    failSd: counted && verdict.cause === 'spread',
    status,
    mark: takeLearned ? PROG.MARK_DONE : null,
    cause,
    limb,
    dyn: dyn.score,
    dynAdvice: dyn.score >= 0 && dyn.score < PROG.DYN_GOOD ? PROG.dynamicsAdvice(st) : '',
    series: PROG.percentSeries(it ? it.h : [], box.w - 2, box.h - 2),
  };
}

function recordRun({ t, st, verdict, eased, dyn }) {
  const rec = ST.makeRecord({
    drill: ST.drillId(clockMode ? 'clock' : 'drill', recordIdOf(chart), settings),
    bpm: chart.bpm,
    sd: t.sdMs,
    mean: t.meanMs,
    n: t.n,
    err: st.misses + st.stickErrors,
    at: Date.now() / 1000,
    context: attemptContext(),
    total: st.asked,
    clean: verdict.clean && !eased,
    breakdown: st,
    dyn: dyn.score,
  });
  stats = ST.addRecord(stats, rec);
  summaryIsBest = ST.forDrill(stats, rec.d).length > 1 && ST.isPersonalBest(stats, rec);
  saveStats();
  recordProgress({ clean: verdict.clean, reason: verdict.reason, accuracy: verdict.accuracy,
    sd: t.sdMs, bpm: chart.bpm, eased, dyn: dyn.score });
}

/* The item the armed drill's takes are filed under. */
function armedItemId() {
  return clockMode ? CAT.CLOCK_ID : recordIdOf(chart);
}

/* The tempo the armed drill is written at: its file's, or its target on the
 * path for a generated one. A Clock is measured on the drill it wraps. */
function armedWrittenBpm() {
  const src = armedSource || chart;
  if (!src.generated) return src.bpm;
  return PLAN.targetBpm(recordIdOf(src)) || settings.bpm;
}

/*
 * One take into the drill's progress, and a line for the result screen that
 * says what it did — or why it did not count. A Study take is never counted:
 * Study waits for you, and a take that waited has no timing to judge.
 */
function recordProgress(take) {
  if (settings.study) {
    progressNote = { text: 'Study: not counted' };
    return;
  }
  const speed = PROG.speedOf(take.bpm, armedWrittenBpm());
  const r = PROG.recordTake(progress, armedItemId(), {
    speed, accuracy: take.accuracy, sd: take.sd, clean: take.clean, eased: take.eased,
    bpm: take.bpm, dyn: take.dyn, at: Date.now(),
  });
  saveProgress();
  takeLearned = r.learned;
  progressNote = noteFor(r, take.clean ? speed : null, take.reason, take.eased);
  noteStuck();
}

/*
 * Stuck on a step of the path: after a few takes that did not count the
 * result suggests the easier way in, and after more the path parks the step
 * for a day and Continue offers something else — a plateau is met by coming
 * back tomorrow, not by a seventh take tonight.
 */
function noteStuck() {
  stuckNow = 0;
  if (!pathStep || pathStep.id !== armedItemId()) return;
  stuckNow = PLAN.stuckLevel(PROG.failStreak(progress, pathStep.id));
  if (stuckNow === 2 && !PROG.isParked(progress, pathStep.id, Date.now())) {
    PROG.parkItem(progress, pathStep.id, Date.now());
    saveProgress();
  }
}

function stuckFooter() {
  if (stuckNow === 2) return 'parked: CLICK other';
  if (stuckNow === 1) return pathStep && pathStep.rung > 0 ? 'stuck? try L0' : 'stuck? knob 8 slower';
  return '';
}

function noteFor(r, value, reason, eased) {
  if (r.learned) {
    announce('learned');
    return { mark: PROG.MARK_DONE, text: `learned at ${value}%` };
  }
  if (value === null) return { text: reason };
  if (eased) return { text: `clean ${value}%, not counted: ${eased}` };
  const done = PROG.isDone(progress, armedItemId());
  return { mark: done ? PROG.MARK_DONE : null, text: `clean ${value}%  best ${r.best}%` };
}

/*
 * The id a drill's history is kept under. A random drill is a new chart every
 * time it is opened, and its seed is part of its chart id — so every take
 * used to become a drill of its own, and they pushed the real history out.
 */
function recordIdOf(c) {
  return c.family || c.id;
}

/* What helped, and how fast: so a slow, guided take is not compared with a
 * full-speed one as if they were the same thing. */
function attemptContext() {
  return { speed: settings.speed, guide: settings.guide, study: settings.study };
}

/*
 * A step through the finished take: back from the result into it, forward out
 * of it. The jog moves a beat a detent; knob 1 moves as the scrub does, in
 * fractions of a bar.
 */
function reviewStep(beats) {
  if (!review || review.end <= 0) return;
  const from = review.at === null ? review.end : review.at;
  const to = Math.max(0, from + beats);
  if (to >= review.end) {
    if (review.at !== null) announce('result');
    review.at = null;
    return;
  }
  if (review.at === null) announce('review');
  review.at = to;
}

function reviewing() {
  return Boolean(review && review.at !== null && (screen === SUMMARY || screen === LADDER));
}

/* ---- the clock ---------------------------------------------------------- */
function advanceClock() {
  const study = settings.study && tp.mode === C.MODE_PRACTICE;
  beatFlash = T.advance(tp, now(), chart.bpm, study, study ? SC.blockingBeat(run) : null);
}

function clockMuted() {
  return clockMode && C.clickMuted(tp.songBeats, settings.clockBars, CH.beatsPerBar(chart));
}

function serviceClick() {
  if (!settings.click) return;
  /* In the Clock drill the metronome drops out and you keep the time. The
   * chart's beats are still the truth, so the drift is simply the mean offset
   * over the silent stretch — nothing else has to change to measure it. */
  if (clockMuted()) return;
  const hit = C.clickAt(tp.prevBeats, tp.songBeats, settings.clickSubdiv, CH.beatsPerBar(chart));
  /* Into the tick's one write, with its hits: the parameter channel is a
   * single-slot mailbox, and a separate 'c' write lost either the click or
   * the hits whenever a stroke landed on the beat. */
  if (hit) dspNotes = (dspNotes ? dspNotes + ',' : '') + (hit.downbeat ? 'c:1' : 'c:0');
}

/* Listen mode plays the drill so you can watch it before trying it. */
function serviceReference() {
  if (tp.mode !== C.MODE_LISTEN) return;
  /* SC.takeDue settles each entry and moves the cursors; doing it here by
   * hand left the cursor at zero, so nothing pruned and the run never ended. */
  for (const e of SC.takeDue(run, tp.songBeats)) {
    listenLit = [];
    for (const n of e.notes) {
      sound(n.voice, n.wantDyn === 'accent' ? 115 : n.wantDyn === 'ghost' ? 45 : 90);
      listenLit.push(n.voice);
    }
    listenLitUntil = now() + LISTEN_LIT_MS;
  }
}

function serviceLadder() {
  if (!ladder || tp.mode !== C.MODE_PRACTICE || ladder.failed) return;
  if (!ladder.started) {
    if (tp.songBeats < 0) return;
    LAD.beginRung(ladder, run, 0);
    ladder.started = true;
    return;
  }
  const end = LAD.rungEnd(ladder, CH.beatsPerBar(chart));
  if (tp.songBeats < end) return;
  const verdict = LAD.judgeRung(ladder, run, tp.songBeats);
  LAD.applyVerdict(ladder, verdict);
  ladderReason = verdict.reason;
  if (ladder.failed) {
    /* Recorded here, once: stop() records nothing for a Ladder, which used to
     * add a second, drill-shaped record at the failed tempo. */
    if (ladder.topClean > 0 && !tp.scrubbed) {
      stats = ST.addRecord(stats, ST.makeRecord({
        drill: ST.drillId('ladder', recordIdOf(chart), settings),
        bpm: ladder.topClean, sd: ladder.topSd, mean: ladder.topMean,
        n: run.hits, err: 0, at: Date.now() / 1000, context: attemptContext(), clean: true,
      }));
      saveStats();
    }
    /* Every rung below the top was clean — the Ladder's rule is stricter than
     * a take's — so its top clean tempo is a clean speed. A climb that never
     * held a rung is a take that was not. */
    if (!tp.scrubbed) {
      recordProgress(ladder.topClean > 0
        ? { clean: true, accuracy: 1, sd: ladder.topSd, bpm: ladder.topClean,
          eased: PROG.easedBy(judgingContext()) }
        : { clean: false, reason: verdict.reason, accuracy: 0, sd: verdict.sdMs, bpm: ladder.startBpm,
          eased: PROG.easedBy(judgingContext()) });
    } else {
      progressNote = null;
    }
    stop();
    return;
  }
  if (ladder.again) announce(`again at ${ladder.bpm}`);
  /* Climb: the tempo, the run's windows and the clock all move together. */
  if (ladder.bpm !== chart.bpm) setTempo(ladder.bpm);
  LAD.beginRung(ladder, run, tp.songBeats);
}

/*
 * The footer's fraction for the runs that are endless under the hood: how far
 * through the current rung of a Ladder, how far through the Clock's rounds.
 * Undefined for everything else, which the reading view works out itself.
 */
function endlessProgress() {
  if (ladder && ladder.started) {
    const span = ladder.bars * CH.beatsPerBar(chart);
    return span > 0 ? Math.max(0, Math.min(1, (tp.songBeats - ladder.windowStart) / span)) : 0;
  }
  if (ladder) return 0;
  if (clockMode) return Math.max(0, Math.min(1, tp.songBeats / clockEnd()));
  return undefined;
}

/* How long the Clock runs: this many rounds of click-on then click-off. It
 * stops a late window past the end, so the last notes are judged — not left
 * pending, where they would count neither way. */
const CLOCK_ROUNDS = 4;

function clockEnd() {
  return CLOCK_ROUNDS * 2 * settings.clockBars * CH.beatsPerBar(chart);
}

/* ---- the quiz prompt ----------------------------------------------------- */
/*
 * A hearing drill has to make a sound, and this one did not.
 *
 * `Hear: drum`, `Hear: subdivision` and `Pick: groove` all ask you to identify
 * something you have just heard, and nothing was ever playing it — three of
 * the five drills asked a question they never posed. The prompt is scheduled
 * here and emptied a tick at a time, because two of the three are RHYTHMS and
 * cannot be sounded in one call.
 */
const QUIZ_ADVANCE_MS = 500;
const PROMPT_BPM = 96;
let promptQueue = [];       /* { atMs, voice, vel }, soonest first */
let quizSolvedAt = 0;

function clearPrompt() {
  promptQueue.length = 0;
}

/* Lay out the prompt on the wall clock. The quiz has no musical clock of its
 * own — there is nothing to keep time WITH yet — so it runs on milliseconds. */
function schedulePrompt() {
  clearPrompt();
  if (!quiz || !quiz.prompt) return;
  const t = now();

  if (quiz.kind === 'voice') {
    promptQueue.push({ atMs: t, voice: quiz.prompt, vel: 105 });
    return;
  }

  if (quiz.kind === 'subdiv') {
    /* Two beats of it, accented on the beat: one beat is not enough to hear a
     * subdivision as a group, and the accent is what makes the grouping
     * audible rather than a stream. */
    const spec = GEN.SUBDIVISIONS[quiz.prompt];
    const per = spec ? spec.per : 2;
    const beatMs = 60000 / PROMPT_BPM;
    for (let b = 0; b < 2; b++) {
      for (let k = 0; k < per; k++) {
        promptQueue.push({
          atMs: t + (b + k / per) * beatMs,
          voice: 'HH',
          vel: k === 0 ? 115 : 75,
        });
      }
    }
    return;
  }

  if (quiz.kind === 'groove') {
    const c = quiz.charts.find((x) => x.id === quiz.prompt);
    if (!c) return;
    const beatMs = 60000 / (c.bpm || PROMPT_BPM);
    for (const e of c.events) {
      for (const v of e.voices) {
        const d = dynOf(e, v);
        promptQueue.push({
          atMs: t + e.beat * beatMs,
          voice: v,
          vel: d === 'accent' ? 115 : d === 'ghost' ? 45 : 92,
        });
      }
    }
  }
}

let litAt = -1;

function servicePrompt() {
  if (!promptQueue.length) return;
  const t = now();
  while (promptQueue.length && promptQueue[0].atMs <= t) {
    const e = promptQueue.shift();
    sound(e.voice, e.vel);
    /* L0's bar lights its pads as it sounds, a stack at a time. */
    if (e.lit) {
      if (e.atMs !== litAt) { listenLit = []; litAt = e.atMs; }
      listenLit.push(e.voice);
      listenLitUntil = t + LISTEN_LIT_MS;
    }
  }
}

/* Whether this drill withholds the answer until you have heard it. */
function promptIsAudible() {
  return quiz && (quiz.mode === 'hear' || quiz.mode === 'pick');
}

/*
 * Move on, a beat after the answer lands.
 *
 * Not instantly: in `hear` the notation is revealed only once you get it
 * right, and that reveal IS the teaching. Advancing on the same frame would
 * take it away before it could be read.
 */
function serviceQuiz() {
  if (!quizSolvedAt || now() - quizSolvedAt < QUIZ_ADVANCE_MS) return;
  quizSolvedAt = 0;
  if (Q.roundComplete(quiz)) {
    finishQuiz();
    return;
  }
  Q.advance(quiz);
  if (promptIsAudible()) {
    schedulePrompt();
    announce('listen');
  } else {
    announce(Q.labelFor(quiz, quiz.prompt));
  }
}

/* ---- input -------------------------------------------------------------- */
function padDown(pad, vel) {
  /* In a multiple-choice drill the bottom row is answer buttons. They sound
   * nothing: a press there is a choice, not a drum. */
  if (answerBarActive() && AP.inAnswerBar(quiz.options.length, pad)) {
    const r = Q.pickAt(quiz, AP.answerAt(quiz.options.length, pad), now());
    if (r === 'ignored') return;
    setFlash([pad], r === 'right' ? PAD.LED_HIT : PAD.LED_MISS);
    if (r === 'right') quizSolvedAt = now();
    return;
  }
  held.add(pad);
  if (screen === PADMAP) {
    padMapPress(pad, vel);
    return;
  }
  const voice = PAD.padVoice(pad, layoutNow());
  if (!voice) return;
  const hand = PAD.padHand(pad);
  sound(voice, vel || 100);

  if (screen === QUIZ && quiz) {
    if (quiz.mode !== 'pick') {
      const r = Q.pressVoice(quiz, voice, now());
      setFlash([pad], r === 'right' ? PAD.LED_HIT : PAD.LED_MISS);
      /* The prompt moves on a beat later, not on this frame — see
       * serviceQuiz. Without it the drill asked one question for ever. */
      if (r === 'right') quizSolvedAt = now();
    }
    return;
  }

  /* Not while paused: a pad pressed to find your place after a scrub would be
   * scored as a perfect hit on the note under the playhead. */
  if (screen !== RUNNING || !T.judging(tp)) return;
  if (untimed) {
    const j = UT.press(untimed, { voice, hand, velocity: vel }, now());
    if (j) setFlash(PAD.padsForVoice(voice, layoutNow(), hand), flashColor(j));
    return;
  }
  /* The marker goes where the press was SEEN (songBeats); the judgement is
   * about TIME, so it keeps the honest clock — and is told the frozen one, so
   * a note the scroll has not reached is only as near as it looks. */
  const j = SC.judgeHit(run, { voice, hand, velocity: vel }, tp.scoreBeats, tp.songBeats);
  SC.addMarker(run, voice, tp.songBeats, hand);
  setFlash(PAD.padsForVoice(voice, layoutNow(), hand), flashColor(j));
}

function padUp(pad) {
  held.delete(pad);
}

function padsOfVoices(voices) {
  const out = [];
  for (const v of voices) out.push(...PAD.padsForVoice(v, layoutNow()));
  return out;
}

function setFlash(pads, color) {
  flash = { pads, color };
  flashUntil = now() + FLASH_MS;
}

function finishQuiz() {
  const rec = ST.makeRecord({
    drill: Q.quizDrillId(quiz),
    bpm: Q.ratePerMinute(quiz, now()),
    sd: 0, mean: 0, n: quiz.correct,
    err: quiz.wrong, at: Date.now() / 1000,
  });
  const round = PROG.recordRound(progress, quizItemOf(quiz), {
    correct: quiz.correct, wrong: quiz.wrong, hinted: quiz.hinted, at: Date.now(),
  });
  saveProgress();
  const score = PROG.roundScore(quiz.correct, quiz.wrong, quiz.hinted);
  stats = ST.addRecord(stats, rec);
  /* Asked after the append and only with a history to beat: the first round
   * of a drill is not a best, it is a start. */
  const isBest = ST.forDrill(stats, rec.d).length > 1 && ST.isPersonalBest(stats, rec);
  saveStats();
  /* The round is over, so the numbers are final: work them out once here
   * rather than rescanning the whole history on every frame of the result. */
  const series = ST.forDrill(stats, Q.quizDrillId(quiz));
  resultCache = {
    rate: Q.ratePerMinute(quiz, now()),
    best: ST.summarise(series).best,
    errorRate: Q.errorFraction(quiz),
    hints: quiz.hintsTaken,
    series,
    isBest,
    note: round.learned ? { mark: PROG.MARK_DONE, text: `learned ${score}%` }
      : { mark: PROG.isDone(progress, quizItemOf(quiz)) ? PROG.MARK_DONE : null,
        text: `score ${score}%` },
  };
  screen = RESULT;
  announce(`round done, ${Math.round(resultCache.rate)} per minute`);
}

/* Open the highlighted row: into a folder, or do what the row holds. */
function openRow() {
  const item = CAT.navCurrent(nav);
  if (!item) return;
  fromContinue = false;
  if (CAT.navPush(nav)) {
    announce(`${item.label}.`);
    return;
  }
  if (item.continueRow) {
    continueOpen();
    return;
  }
  if (item.lessonsRow) {
    showLessons(item.stage);
    return;
  }
  if (item.prefRow) {
    turnPref(item);
    return;
  }
  if (item.settingsGroup) {
    openSettingsGroup(item);
    return;
  }
  if (item.helpAction) {
    helpAction(item.helpAction);
    return;
  }
  if (item.step) {
    openPathStep(item.step);
    return;
  }
  pathStep = null;
  leavePath();
  if (item.repId) {
    if (leafIdx.get(item.repId)) openLeaf(leafIdx.get(item.repId));
    return;
  }
  openLeaf(item);
}

/*
 * Continue: a review that is due, or the next step of the path — one of each
 * in turn while reviews are due (path_rows.mjs continuePick).
 */
function continueOpen() {
  const pick = ROWS.continuePick(progress, program, Date.now(), continueTurn);
  if (!pick) {
    announce('Everything on the path is learned.');
    return;
  }
  if (pick.kind === 'step') {
    continueTurn = 'review';
    openPathStep(pick.step);
    return;
  }
  continueTurn = 'step';
  const node = leafIdx.get(pick.id);
  if (!node) return;
  pathStep = null;
  leavePath();
  announce(`Review: ${itemTitle(pick.id)}`);
  openLeaf(node);
  fromContinue = true;
}

/* A stage's lesson cards, to read again. */
function showLessons(st) {
  const ids = LES.stageCards(lessons, st, PLAN.coreSteps(st).concat(PLAN.checkpointSteps(st)));
  if (ids.length) showCards(ids, null);
}

function stageHasCards(st) {
  return LES.stageCards(lessons, st, PLAN.coreSteps(st).concat(PLAN.checkpointSteps(st))).length > 0;
}

/* A row of Settings › Path, turned on by a click. */
function turnPref(row) {
  const change = ROWS.prefChange(row, progress.path, program.stages.length);
  if (change.toggle && !PROG.togglePath(progress, ...change.toggle)) announce('One track stays on');
  if (change.set) PROG.setPath(progress, ...change.set);
  saveProgress();
}

/* Settings › Help: the tips shown again, or the welcome. */
function helpAction(what) {
  if (what === 'tips') {
    PROG.clearTips(progress);
    saveProgress();
    announce('The tips will show again.');
    return;
  }
  startWelcome();
}

/* ---- the action sheet ---------------------------------------------------- */
/*
 * Shift + jog-click on a row: what can be done to it besides opening it
 * (row_sheet.mjs). Drawn as a list of its own over the row's label; Click
 * does the action and closes it, Back closes it.
 */
function openSheet() {
  const top = CAT.navTop(nav);
  const row = CAT.navCurrent(nav);
  const shown = row ? menuRows(top.node)[top.cursor] : null;
  sheet = {
    title: shown ? shown.label : 'OPTIONS',
    items: SH.sheetFor(row, {
      progress,
      pick: ROWS.continuePick(progress, program, Date.now(), continueTurn),
      hasCards: stageHasCards,
      leafOf: (id) => leafIdx.get(id),
    }),
    sel: 0,
  };
  screen = SHEET;
  announce(`Options: ${sheet.items.map((a) => a.label).join(', ')}`);
}

function sheetDo() {
  const a = sheet && sheet.items[sheet.sel];
  sheet = null;
  screen = MENU;
  if (!a) return;
  const at = Date.now();
  switch (a.act) {
    case 'skip':
      PROG.skipItem(progress, a.step.id, at);
      saveProgress();
      announce(`Skipped ${PLAN.stepTitle(a.step)}`);
      return;
    case 'skipAll':
      for (const id of a.ids) PROG.skipItem(progress, id, at);
      saveProgress();
      announce(`Skipped ${a.ids.length}`);
      return;
    case 'unskip':
      for (const id of a.ids) PROG.unskipItem(progress, id);
      saveProgress();
      announce('Skips taken back');
      return;
    case 'start':
      PROG.setPath(progress, 'start', a.index);
      saveProgress();
      announce(`The path starts at stage ${a.index}`);
      return;
    case 'testOut':
      pathStep = null;
      openPathStep(a.step);
      return;
    case 'lessons':
      showLessons(a.stage);
      return;
    case 'ladder':
    case 'clock':
      practiseWrapped(a.leaf, a.act);
      return;
    default:
      openSettingsFolder();
  }
}

/* The sheet's Settings...: the Settings folder, on top of where you are, so
 * Back comes back here. */
function openSettingsFolder() {
  if (!settingsNode) return;
  const at = nav.findIndex((n) => n.node === settingsNode);
  if (at >= 0) nav.length = at + 1;
  else nav.push({ node: settingsNode, cursor: 0 });
  announce('Settings.');
}

/*
 * Practise: Ladder or Practise: Clock on a drill's row. Both WRAP a drill —
 * climb its tempo, take its click away — so the drill is armed as if opened,
 * then wrapped. They need a tempo, which L0 has not; the sheet only offers
 * them on a timed drill.
 */
function practiseWrapped(leaf, kind) {
  pathStep = null;
  leavePath();
  openLeaf(leaf);
  if (screen !== READY || !chart || chart.untimed) return;
  if (kind === 'ladder') {
    /* From 70% of the tempo the drill is played at — its own times Speed —
     * climbing through it. */
    beginActivity('ladder');
    ladder = newLadder();
    ladderReason = '';
    enterReady();
    announce(`Ladder: ${chart.name}, from ${ladder.bpm}`);
    return;
  }
  /* The Clock files its takes under one item of its own (CLOCK_ID): keeping
   * time without the click is the skill, whichever drill it wraps. */
  beginActivity('clock');
  clockMode = true;
  enterReady();
  announce(`Clock: ${chart.name}`);
}

/*
 * A step of the Path: the row of the tree it points at, opened as if
 * picked there — with a generated drill's Tempo set to its target, so 100%
 * Speed is what the step asks for, and the Clock wrapped round its drill.
 */
function openStep(step) {
  stuckNow = 0;
  if (step.quiz) {
    openQuiz(step.quiz, step);
    pathStep = step;
    return;
  }
  const id = step.wrap || step.id;
  const node = leafIdx.get(id);
  if (!node) {
    announce(`${PLAN.stepTitle(step)} is not installed.`);
    return;
  }
  const target = PLAN.targetBpm(id);
  /* The step's target is the Speed it is played at, so 100% of what it asks
   * is what the take is armed at. L0 has no clock to set. */
  const speed = isUntimedId(step.id) ? settings.speed : speedFor(step.target);
  if (speedBeforePath === null) speedBeforePath = settings.speed;
  if ((target && settings.bpm !== target) || settings.speed !== speed) {
    if (target) settings.bpm = target;
    settings.speed = speed;
    refreshSettingsRows();
    saveSettings();
  }
  openLeaf(node);
  if (step.wrap && chart) {
    beginActivity('clock');
    clockMode = true;
    enterReady();
    announce(`Clock: ${chart.name}`);
  }
  pathStep = step;
}

/*
 * A step of the path, with the lesson cards it is due first: its stage's
 * card the first time the stage is entered, then its own. Click on the last
 * one opens the step, so the cards cost one press, read or not.
 */
function openPathStep(step) {
  const stage = program.stages.find((s) => s.key === step.stage);
  const due = LES.dueCards(lessons, progress.path, step, stage);
  if (due.length) showCards(due, () => openStep(step));
  else openStep(step);
}

function showCards(ids, then) {
  beginActivity('cards');
  card = { deck: LES.createDeck(lessons, ids, { guided: Boolean(then), width: L.SCREEN_W - 2,
    measure: (t) => ctx.textWidth(t) }), then };
  screen = CARD;
}

/* The cards read, into progress, so each shows once (Intros `new`). */
function markRead(ids) {
  for (const id of ids) PROG.markSeen(progress, id);
  if (ids.length) saveProgress();
}

/* What the deck stood before, once its last card is through. */
function leaveCards(r) {
  markRead(r.read);
  if (!r.done) return;
  const then = card.then;
  card = null;
  screen = MENU;
  if (then) then();
}

/* Click: this card is read; on to the next, or to what the cards stood before. */
function nextCard() {
  leaveCards(LES.advance(card.deck));
}

/* Play: the cards are taken as read and the practice is heard at once. */
function hearFromCard() {
  const r = LES.skipToEnd(card.deck);
  if (!r.done) return;
  leaveCards(r);
  if (screen === READY) start(false);
}

/*
 * The Speed a path step set is the step's, not yours: leaving the path for a
 * drill of the library gives back the Speed you had before it — a library
 * drill opened after a 60% step used to open at 60% as well.
 */
let speedBeforePath = null;
function leavePath() {
  if (speedBeforePath === null) return;
  if (settings.speed !== speedBeforePath) {
    settings.speed = speedBeforePath;
    refreshSettingsRows();
    saveSettings();
  }
  speedBeforePath = null;
}

/* A step's target as a Speed the setting offers: its nearest step of five,
 * inside the setting's range. */
function speedFor(target) {
  const v = Math.round((target || 100) / 5) * 5;
  return Math.max(50, Math.min(120, v));
}

/* On from a result along the path: the next open step after this one. */
function goNext() {
  const next = PLAN.stepAfter(progress, program, pathStep);
  quiz = null;
  resultCache = null;
  if (next) {
    openPathStep(next);
    return;
  }
  ladder = null;
  clockMode = false;
  screen = MENU;
}

/*
 * What the module is doing beyond showing a screen is ONE of: a quiz round, a
 * Ladder, the Clock, an L0 take, or a deck of lesson cards — each held in its
 * own variable (quiz, ladder, clockMode, untimed, card). They are exclusive,
 * and every place that starts one comes through here, which ends the others:
 * a Clock left armed under a quiz, or a quiz under a deck of cards, is the
 * kind of state the scattered flags used to allow.
 */
function beginActivity(kind) {
  if (kind !== 'quiz') quiz = null;
  if (kind !== 'ladder') ladder = null;
  if (kind !== 'clock') clockMode = false;
  if (kind !== 'untimed') untimed = null;
  if (kind !== 'cards') card = null;
}

function openQuiz(drill, step = null) {
  /* Nothing a quiz could be wrapped in: a Clock step before it on the path
   * must not still be armed when the round is over. */
  beginActivity('quiz');
  /* A step of the path asks about what its stage has taught: three drums,
   * two subdivisions, the grooves you have played. From the Quiz folder, all. */
  const pool = step && step.pool;
  quiz = Q.createQuiz({
    kind: drill.kind, mode: drill.mode,
    roundSize: settings.roundSize, charts: step ? pathGrooves() : grooveCharts(),
    pool: pool && pool.voices ? pool.voices : undefined,
    subdivs: pool && pool.subdivs ? pool.subdivs : undefined,
    variant: step ? step.variant || '' : '',
    seed: (Date.now() & 0xffff) || 1,
  });
  quizTitle = (drill.name || '').toUpperCase();
  quizSolvedAt = 0;
  screen = QUIZ;
  if (promptIsAudible()) schedulePrompt();
}

/* Do what a leaf of the tree holds. */
function openLeaf(item) {
  if (item.kind === 'progress') {
    openProgress();
    return;
  }
  if (item.kind === 'quiz') {
    openQuiz(item.quiz);
    return;
  }
  /* A drill. Whatever the Ladder or the Clock was wrapping before, this is not
   * it. A row that holds nothing — "Nothing due today" — does nothing. */
  if (typeof item.build !== 'function') return;
  ladder = null;
  clockMode = false;
  const built = item.build();
  if (!built) return;
  armedSource = built;
  armChart(built);
}

/*
 * The grooves, for Pick: groove — not every file. The rudiments were in the
 * pool, and a single stroke roll and a paradiddle are the same notes on one
 * snare at a glance of the ear: questions with two right answers.
 */
function grooveCharts() {
  const out = [];
  for (const e of fileEntries) {
    const cat = fileCategories.find((c) => c.id === e.category);
    if (cat && cat.folder === 'Grooves') out.push(e.chart);
  }
  return out;
}

/*
 * Pick: groove on the Learning Path asks only about grooves you have played,
 * in the styles you have on: naming a groove you have never heard is a guess,
 * not ear training. With fewer than three of those there is no fair question,
 * so it falls back to the styles you have on.
 */
const MIN_GROOVE_POOL = 3;
function pathGrooves() {
  const styles = progress.path.styles;
  const all = new Set(grooveCharts());
  const on = fileEntries.filter((e) => all.has(e.chart) && styles[e.category] !== false);
  const ids = Object.keys(progress.items).filter((id) => progress.items[id].plays > 0);
  const played = on.filter((e) => ids.some((id) => id === e.chart.id || id.indexOf(`${e.chart.id}:`) === 0));
  const use = played.length >= MIN_GROOVE_POOL ? played : on;
  return use.length >= MIN_GROOVE_POOL ? use.map((e) => e.chart) : grooveCharts();
}

/* The item a quiz round is filed under: its pooled variant's, when it has one. */
function quizItemOf(q) {
  return IDS.quizItemId(q.mode, q.kind, q.variant);
}

/* The pad layout a press is read in. A drum quiz always uses the kit: in the
 * sticking layout every pad is the snare, and eight of nine prompts could not
 * be answered at all. */
function layoutNow() {
  return screen === QUIZ ? quizLayout : padLayout;
}

/*
 * The pads in force, resolved once (padmap.resolveLayout): the chosen layout,
 * flipped or not, Custom from pads.json. A drum quiz asks about drums, so it
 * plays on the chosen layout — or MPC Classic when that is Sticking, where
 * every pad is the snare and eight of nine prompts could not be answered.
 */
let customPads = null;
/* The Pad map screen's state (padmap_screen.mjs). */
const pm = PMS.createPadMap();
let padLayout = PAD.resolveLayout(PAD.DEFAULT_LAYOUT);
let quizLayout = padLayout;
function refreshLayout() {
  padLayout = PAD.resolveLayout(settings.layout, { flip: settings.flip, custom: customPads });
  quizLayout = settings.layout === 'sticking'
    ? PAD.resolveLayout(PAD.DEFAULT_LAYOUT, { flip: settings.flip }) : padLayout;
  if (chart) chartWarning = warningFor(chart);
}

/* ---- the Pad map screen ------------------------------------------------- */
/*
 * Its rules are padmap_screen.mjs's; what is done here is what only the host
 * can do: sound a pad, change and save the settings, save pads.json.
 */
function padMapView() {
  return { layout: padLayout, custom: settings.layout === PAD.CUSTOM,
    sticking: settings.layout === 'sticking', flip: settings.flip };
}

function openPadMap() {
  PMS.reset(pm);
  screen = PADMAP;
  announce(`Pad map: ${padLayout.name}`);
}

function padMapPress(pad, vel) {
  const r = PMS.press(pm, padMapView(), pad, now());
  if (r.voice) sound(r.voice, vel || 100);
  announce(r.note);
}

function padMapJog(delta) {
  const r = PMS.jog(pm, padMapView(), delta, customPads || PIO.copyPreset(PAD.DEFAULT_LAYOUT), now());
  if (r.custom) {
    customPads = r.custom;
    refreshLayout();
  } else {
    editSetting('layout', r.layoutDelta);
  }
}

/* Click on a preset: Custom becomes a copy of it, to edit. */
function padMapClick() {
  if (!PMS.click(pm, padMapView()).copy) return;
  const from = padLayout.name;
  customPads = PIO.copyPreset(settings.layout);
  settings.layout = PAD.CUSTOM;
  refreshSettingsRows();
  saveSettings();
  refreshLayout();
  announce(`Custom: a copy of ${from}. Pick a pad, turn the jog to give it a sound.`);
}

function savePads() {
  if (!pm.edited || !customPads) return;
  const text = PIO.serialisePads(customPads);
  if (!writeFile(PADS_PATH, text)) return;
  pm.edited = false;
  writeFile(PADS_BAK_PATH, text);
}

function padMapSelected() {
  return screen === PADMAP ? PMS.selectedPads(pm, padMapView()) : null;
}

/* The Custom layout from pads.json or, when that is empty or will not read —
 * a save cut short — from its backup. */
function loadPads() {
  const main = PIO.readPads(readFile(PADS_PATH));
  const r = main.custom ? main : PIO.readPads(readFile(PADS_BAK_PATH));
  customPads = r.custom || main.custom;
  if (!r.custom && !(main.ok && r.ok)) {
    menuNote = 'BAD PADS.JSON';
    menuNoteUntil = now() + 8000;
    announce('pads.json would not read: Custom is MPC Classic until it is saved again.');
  }
}

/*
 * PROGRESS, as Piano Practice lays it out: the overview first, then each
 * track, then every drill you have played, most recent first. The first five
 * open a chart of drills learned over time; a drill opens the chart of its
 * takes. Made when the screen opens — it cannot change while it is up.
 */
function openProgress() {
  const all = PROG.summariseIds(progress, overviewIds(null));
  const rows = [{ label: 'Overall', value: `${all.done}/${all.count}`, overview: true, track: null }];
  for (const t of program.tracks) {
    const sum = PROG.summariseIds(progress, overviewIds(t));
    rows.push({ label: t.name, value: `${sum.done}/${sum.count}`, overview: true, track: t });
  }
  for (const id of PROG.recentIds(progress)) {
    rows.push({ label: itemTitle(id), value: PROG.itemValue(progress, id),
      mark: PROG.itemMark(progress, id), id });
  }
  progressRows = rows;
  progressSel = Math.max(0, Math.min(progressSel, rows.length - 1));
  progressRight = `${all.done}/${all.count}`;
  screen = PROGRESS;
}

/* The steps an overview counts: one track's, or the whole path's. */
function overviewIds(track) {
  return track ? PLAN.trackIds(program, track.key) : PROG.leafIds(agg, pathNode);
}

function openProgressRow() {
  if (!progressRows[progressSel]) return;
  progressItem = progressDetail(progressSel);
  screen = PROGRESS_ITEM;
}

/* The chart a row of the list opens, worked out once: when it opens, or when
 * the jog moves on to the next row. */
function progressDetail(index) {
  const row = progressRows[index];
  const footer = progressRows.length > 1 ? `JOG ${index + 1}/${progressRows.length}` : '';
  const box = L.PROGRESS_PLOT;
  if (row.overview) {
    const ids = overviewIds(row.track);
    const sum = PROG.summariseIds(progress, ids);
    return {
      overview: true,
      title: row.track ? row.track.name : 'Overall',
      done: sum.done,
      count: sum.count,
      timeline: PROG.learnedTimeline(progress, ids, box.w, box.h, Date.now()),
      footer,
    };
  }
  const id = row.id;
  const it = PROG.item(progress, id) || { h: [], best: 0, bpm: 0, plays: 0 };
  const isQuiz = IDS.isQuizItemId(id);
  /* The best dynamics beside where the jog is: the chart's dotted line. */
  const dyn = it.dyn >= 0 ? `dyn ${it.dyn}%` : '';
  return {
    title: itemTitle(id),
    best: it.best,
    bpm: it.bpm,
    plays: it.plays,
    done: PROG.isDone(progress, id),
    isQuiz,
    series: PROG.percentSeries(it.h, box.w - 2, box.h - 2,
      isQuiz ? { lo: 0, hi: 100, line: PROG.QUIZ_PASS } : isUntimedId(id) ? PROG.UNTIMED_SCALE : {}),
    footer: [dyn, footer].filter(Boolean).join('  '),
  };
}

/* Settings opens over whatever is on screen, pausing a run, and goes back to
 * it — every row of it, as it always has. */
function openSettings() {
  settingsFrom = screen;
  if (screen === RUNNING && !tp.paused) pause();
  useSettingsRows(null);
  screen = SETTINGS;
  settingsEditing = false;
}

/* A group of the Settings folder: the editor with that group's rows. */
function openSettingsGroup(row) {
  settingsFrom = MENU;
  useSettingsRows(row.settingsGroup);
  settingsSel = 0;
  screen = SETTINGS;
  settingsEditing = false;
  announce(`${row.label} settings.`);
}

function useSettingsRows(group) {
  settingsGroup = group;
  settingsDefs = SET.rowsIn(group);
  refreshSettingsRows();
  settingsSel = Math.max(0, Math.min(settingsSel, settingsDefs.length - 1));
}

/* The editor's rows as the list shows them, made when a value changes. */
function refreshSettingsRows() {
  settingsRowsCache = SET.settingsRows(settings, settingsDefs);
}

function leaveSettings() {
  settingsEditing = false;
  let to = settingsFrom;
  if ((to === READY || to === RUNNING) && !chart) to = MENU;
  if (to === SETTINGS || to === ERROR) to = MENU;
  screen = to;
}

/* ---- MENU: help for this screen ----------------------------------------- */
/*
 * MENU opens the help page of the screen on it (help.mjs): what it is, its
 * keys, the topics that explain it, and on a row of the Path the lesson card
 * behind it. A take is paused first, as Settings pauses it. MENU or BACK
 * closes it, back to where it was opened.
 */
function openHelp() {
  /* The keys as they were: a take is paused only once they are read. */
  const st = hintState(false);
  if (screen === RUNNING && !tp.paused) pause();
  if (screen === MENU) st.section = nav.length > 1 ? nav[1].node.label : (CAT.navCurrent(nav) || {}).label;
  if (screen === SETTINGS) st.group = settingsGroup;
  const page = HP.helpPage(screen, { st, topics: helpTopics, extra: screen === MENU ? rowCardLines() : [] });
  /* Opened at its first line: what this screen is comes first. */
  help = { title: page.title, lines: HP.fitPage(page.lines, measure), top: 0, back: screen };
  screen = HELP;
  announce(help.lines.join(' '));
}

function closeHelp() {
  screen = help ? help.back : MENU;
  help = null;
}

/* The lesson card behind the highlighted row of the Path: a step's own
 * cards, else its stage's. */
function rowCardLines() {
  const row = CAT.navCurrent(nav);
  if (!row) return [];
  let step = row.step || (row.steps && row.steps[0]) || null;
  if (row.continueRow) {
    const pick = ROWS.continuePick(progress, program, Date.now(), continueTurn);
    step = pick && pick.kind === 'step' ? pick.step : null;
  }
  const stage = row.stage || (step && program.stages.find((x) => x.key === step.stage)) || null;
  const own = row.step ? (step.cards || []) : [];
  const ids = own.filter((id) => lessons.has(id));
  if (!ids.length && stage && lessons.has(stage.card)) ids.push(stage.card);
  return HP.cardLines(ids.map((id) => lessons.get(id)));
}

/* ---- the welcome and the tips -------------------------------------------- */
/*
 * The first launch (tips.mjs): what the module is, its keys, and new or
 * already playing. "From the start" puts the path at its first stage and the
 * cursor on Continue; "I already play" opens the Path with a tip on testing
 * out. Back at any page ends it; either way it is marked seen.
 */
function startWelcome() {
  welcome = TIPS.createWelcome();
  welcomeLines = WELCOME_PAGES.map((p) => (p.items ? HP.fitPage(p.items, measure) : null));
  sheet = null;
  help = null;
  screen = WELCOME;
  announce(`Welcome. ${welcomeLines[0].join(' ')}`);
}

function finishWelcome() {
  welcome = null;
  PROG.addTip(progress, 'welcome');
  saveProgress();
  screen = MENU;
}

function welcomeClick() {
  const answer = TIPS.welcomeClick(welcome);
  if (!answer) {
    const page = WELCOME_PAGES[welcome.page];
    announce(page.choices ? `${page.title} ${page.choices.join(', ')}` : welcomeLines[welcome.page].join(' '));
    return;
  }
  finishWelcome();
  nav = CAT.navStart(catalog);
  if (answer === 'start') {
    PROG.setPath(progress, 'start', 0);
    saveProgress();
    announce('Continue.');
    return;
  }
  const at = catalog.children.indexOf(pathNode);
  if (at >= 0) {
    nav[0].cursor = at;
    CAT.navPush(nav);
  }
  showTip('placement', MENU);
}

/* A tip, the first time its screen comes up (tips.mjs tipDue). */
function serviceTips() {
  const key = screen === SHEET ? 'sheet' : screen === READY ? 'practice' : screen === QUIZ ? 'quiz' : null;
  const due = key && TIPS.tipDue(progress, key);
  if (due) showTip(due, screen);
}

function showTip(key, back) {
  if (key !== 'placement') {
    PROG.addTip(progress, key);
    saveProgress();
  }
  /* A quiz asks again once the tip is read: its question would be lost. */
  if (back === QUIZ) clearPrompt();
  tipCard = { key, back, top: 0, lines: HP.fitPage(TIPS.tipItems(key), measure) };
  screen = TIP;
  announce(`Tip: ${TIPS.TIPS[key].join(' ')}`);
}

function closeTip() {
  const back = tipCard ? tipCard.back : MENU;
  tipCard = null;
  screen = back;
  if (screen === QUIZ && quiz && promptIsAudible()) schedulePrompt();
}

/*
 * What the hint line is told about the screen on it (hints.mjs). `shift` is
 * whether Shift's layer shows.
 */
function hintState(shift = shiftHeld) {
  const st = { shift, depth: nav.length };
  if (screen === RUNNING || screen === READY) {
    st.mode = tp.mode;
    st.paused = tp.paused;
    st.untimed = isUntimed();
    st.ladder = Boolean(ladder);
    st.clock = clockMode;
  } else if (screen === SUMMARY) {
    st.clock = clockMode && !pathStep && !fromContinue;
  } else if (screen === QUIZ && quiz) {
    st.pick = quiz.mode === 'pick';
    st.audible = promptIsAudible();
    st.hintsLeft = Q.hintsLeft(quiz);
  } else if (screen === RESULT) {
    st.path = Boolean(pathStep) || fromContinue;
  } else if (screen === CARD && card) {
    st.guided = card.deck.guided;
    st.more = card.deck.at + 1 < card.deck.ids.length;
    st.pages = card.deck.pages.length;
  } else if (screen === WELCOME && welcome) {
    st.asks = TIPS.welcomeAsks(welcome);
  } else if (screen === TIP && tipCard) {
    st.scrolls = tipCard.lines.length > L.PAGE_ROWS;
  } else if (screen === SETTINGS) {
    st.editing = settingsEditing;
  }
  return st;
}

/* The hint line's part on screen now: the parts are made when what they
 * depend on changes, and only picked from on a frame. */
let hintKey = '';
let hintParts = [];
function hintLine() {
  const st = hintState();
  const key = `${screen}|${st.shift}|${st.depth > 1}|${st.mode}|${st.paused}|${st.untimed}|${st.clock}|`
    + `${st.pick}|${st.audible}|${st.hintsLeft > 0}|${st.path}|${st.guided}|${st.more}|${st.pages > 1}|`
    + `${st.asks}|${st.scrolls}|${st.editing}`;
  if (key !== hintKey) {
    hintKey = key;
    hintParts = H.hintFor(screen, st);
  }
  return H.hintAt(hintParts, now());
}

/*
 * Back to the list, from the error screen: MENU's old job everywhere, which
 * BACK has taken over now that MENU is help. Whatever was running is stopped
 * properly on the way — the kit silenced, the transport home, nothing
 * half-recorded and no Record light left burning over the list.
 */
function leaveToMenu() {
  if (tp.mode !== C.MODE_IDLE) {
    panicDsp();
    T.home(tp);
  }
  untimed = null;
  card = null;
  if (screen === PADMAP) savePads();
  screen = MENU;
  settingsEditing = false;
  quiz = null;
  clearPrompt();
  quizSolvedAt = 0;
  ladder = null;
  clockMode = false;
}

function back() {
  /* From the error screen BACK always closes. Whatever state the module is
   * in, one press of the button the player already knows has to end it. */
  if (screen === ERROR || safeMode) return false;
  if (screen === SETTINGS && settingsEditing) { settingsEditing = false; return true; }
  if (screen === SETTINGS) { leaveSettings(); return true; }
  if (screen === HELP) { closeHelp(); return true; }
  if (screen === TIP) { closeTip(); return true; }
  if (screen === SHEET) { sheet = null; screen = MENU; return true; }
  if (screen === WELCOME) { finishWelcome(); return true; }
  /* Back from looking over a take is the result again. */
  if (reviewing()) { review.at = null; return true; }
  /* Back from a result is another go from the top; Back again is the list. */
  if ((screen === SUMMARY || screen === LADDER) && chart) { restart(); return true; }
  /* Up one folder; only the top of the tree is left by Back. */
  if (screen === MENU) return CAT.navPop(nav);
  if (screen === CARD) { card = null; screen = MENU; return true; }
  if (screen === PADMAP) { savePads(); screen = SETTINGS; return true; }
  if (screen === PROGRESS_ITEM) { screen = PROGRESS; return true; }
  /* Back from a run RESTARTS it. Back again lands on READY, whose own Back
   * goes to the list — so leaving needs no gesture of its own. */
  if (screen === RUNNING) { restart(); return true; }
  screen = MENU;
  quiz = null;
  ladder = null;
  clockMode = false;
  clearPrompt();
  quizSolvedAt = 0;
  return true;
}

/*
 * CLOSING IS A TWO-STEP, AND IT HAS TO BE.
 *
 * Note-offs leave through move_midi_inject_to_move, which the shim holds back
 * until two consecutive quiet SPI frames and for three more frames after
 * overtake ends. Calling host_exit_module() on the same tick that queues them
 * races the teardown and the offs are dropped — which leaves notes sounding
 * on a Move track after the module has gone, with nothing left running that
 * could stop them.
 *
 * So: silence, sweep every channel at a pace the ring can take, let it drain,
 * then leave. The internal kit is cut immediately because that path is a
 * direct parameter write and does not go near the ring.
 */
const EXIT_DRAIN_MS = 120;
/* The inject ring holds ~64 packets and drains 31 per audio block. Two
 * channels is four packets a tick, which it never has to queue behind. */
const PANIC_CH_PER_TICK = 2;
let pendingExitAt = 0;
let panicChannelNext = 16;   /* 16 = the sweep has finished */
/*
 * Set once we have gone. The host does not necessarily stop calling tick()
 * the instant host_exit_module returns, and without this the next tick
 * repaints the pads we just darkened — so the grid lights back up behind a
 * module that has closed, with nothing on screen to explain it.
 */
let exited = false;

function closeModule() {
  if (pendingExitAt || exited) return;
  guard('close:panic', () => dspSet('panic', '1'));
  /* A Custom layout edited on the Pad map is saved on Back; Shift+Back from
   * there closes without passing it. */
  guard('close:pads', savePads);
  tp.mode = C.MODE_IDLE;
  tp.paused = false;
  /*
   * Sweep EVERY channel, not just the one in settings: it may have been
   * changed during the session, and a note can be sounding on one this module
   * is no longer addressing. But only down the routes this session ever sent
   * on — sweeping a route it never used cut Move's own notes and sent USB
   * gear sixteen channels of CCs it had no reason to receive.
   */
  clearOutbox();
  panicChannelNext = routesUsed ? 0 : 16;
  pendingExitAt = now() + EXIT_DRAIN_MS;
}

function serviceExit() {
  if (!pendingExitAt) return;
  if (panicChannelNext < 16) {
    for (let n = 0; n < PANIC_CH_PER_TICK && panicChannelNext < 16; n++) {
      const chn = panicChannelNext++;
      queue(routesUsed, 0xB0 | chn, 120, 0);
      queue(routesUsed, 0xB0 | chn, 123, 0);
    }
    return;
  }
  if (now() < pendingExitAt) return;   /* let the ring finish draining */
  pendingExitAt = 0;
  exited = true;
  guard('exit:leds', () => {
    darkenPads();
    setButtonLED(C.CC_PLAY, 0);
    setButtonLED(C.CC_RECORD, 0);
  });
  guard('exit:files', () => flushFiles(true));
  if (typeof host_exit_module === 'function') host_exit_module();
}

/* ---- drawing ------------------------------------------------------------ */
/*
 * EVERY path through this function draws something.
 *
 * It used to end with `if (screen === RUNNING && run)`, so any state whose
 * data was missing — a READY with no chart, a SUMMARY with no run — drew
 * nothing at all and the OLED kept its last frame. That is indistinguishable
 * from a hang, and it is what the first hardware run looked like. The
 * fallback at the bottom makes a stale screen impossible.
 */
/*
 * The rows of the open folder, made once per folder rather than per frame:
 * the list is drawn at 50Hz and its rows only change when the folder does,
 * when a take moves your progress on, when the day turns (Review), or when
 * Continue turns from a review to a new step.
 */
let rowsNode = null;
let rowsCache = null;
let rowsRev = -1;
let rowsDay = -1;
let rowsTurn = '';
function menuRows(node) {
  const day = Math.floor(Date.now() / 86400000);
  if (node !== rowsNode || progress.rev !== rowsRev || day !== rowsDay || continueTurn !== rowsTurn) {
    rowsNode = node;
    rowsRev = progress.rev;
    rowsDay = day;
    rowsTurn = continueTurn;
    rowsCache = decoratedRows(node);
  }
  return rowsCache;
}

function decoratedRows(node) {
  /* The Path's rows, Continue and Settings › Path speak for themselves
   * (path_rows.mjs); the rest are decorated as the library is. */
  const pc = ROWS.pathContext(progress, program, Date.now(), { turn: continueTurn, titleOf: itemTitle });
  const kids = node.children;
  const out = new Array(kids.length);
  for (let i = 0; i < kids.length; i++) out[i] = ROWS.pathRow(kids[i], pc) || decorateRow(kids[i]);
  return out;
}

/*
 * What a row of the library says about your progress, decided here rather
 * than in the tree: the tree holds what the drills ARE, not how far you have
 * got with them.
 */
function decorateRow(row) {
  const plain = { label: row.label, value: row.value || '', mark: row.mark || null };
  if (row.review) {
    const due = PROG.dueCount(PROG.repetitionSession(progress, Date.now()));
    return { label: row.label, value: due ? `${due} due` : '>' };
  }
  if (row.kind === 'progress') {
    const sum = PROG.folderSummary(agg, progress, pathNode);
    return { label: row.label, value: sum.played ? `${sum.done}/${sum.count}` : '' };
  }
  if (CAT.isFolder(row)) {
    if (row.untracked) return plain;
    const sum = PROG.folderSummary(agg, progress, row);
    if (!sum.count || !sum.played) return plain;
    return { label: row.label, value: `${sum.done}/${sum.count}` };
  }
  if (!row.id) return plain;
  return { label: row.label, value: PROG.itemValue(progress, row.id) || plain.value,
    mark: PROG.itemMark(progress, row.id) };
}

function draw() {
  if (screen === ERROR || safeMode) {
    V.drawError(ctx, {
      where: lastError ? lastError.where : '?',
      message: lastError ? lastError.message : 'unknown',
      count: errCount,
      safeMode,
    });
    return;
  }
  /* Every screen's bottom line names its keys (hints.mjs); while Shift is
   * held it names what Shift does there instead. */
  const hint = hintLine();
  if (screen === PADMAP) {
    V.drawPadMap(ctx, PMS.screenOf(pm, padMapView(), now()));
    if (shiftHeld) V.drawHint(ctx, hint);
    return;
  }
  if (screen === CARD && card) {
    const deck = LES.deckScreen(card.deck);
    deck.footer = hint;
    V.drawCard(ctx, deck);
    return;
  }
  if (screen === TIP && tipCard) {
    V.drawPage(ctx, { title: TIPS.TIP_TITLE, lines: tipCard.lines, top: tipCard.top, footer: hint });
    return;
  }
  if (screen === WELCOME && welcome) {
    const page = WELCOME_PAGES[welcome.page];
    if (page.choices) {
      V.drawList(ctx, { title: page.title, items: page.choices, selected: welcome.choice, footer: hint });
    } else {
      V.drawPage(ctx, { title: page.title, lines: welcomeLines[welcome.page], right: `${welcome.page + 1}/${WELCOME_PAGES.length}`,
        footer: hint });
    }
    return;
  }
  if (screen === HELP && help) {
    V.drawPage(ctx, { title: help.title, lines: help.lines, top: help.top, footer: hint });
    return;
  }
  if (screen === SHEET && sheet) {
    V.drawList(ctx, { title: sheet.title.toUpperCase().slice(0, 21), items: sheet.items, selected: sheet.sel,
      footer: hint });
    return;
  }
  if (screen === MENU) {
    const top = CAT.navTop(nav);
    const rows = menuRows(top.node);
    /* A folder whose rows depend on the day — the Path's Review — can lose
     * the row the highlight was on. */
    if (top.cursor >= rows.length) top.cursor = Math.max(0, rows.length - 1);
    const title = menuNote && now() < menuNoteUntil ? menuNote : top.node.label.toUpperCase();
    V.drawList(ctx, { title: title.slice(0, 16), items: rows, selected: top.cursor, footer: hint });
    return;
  }
  if (screen === SETTINGS) {
    const group = settingsGroup ? SET.GROUPS.find((g) => g.key === settingsGroup) : null;
    V.drawList(ctx, {
      title: settingsEditing ? 'SET *' : group ? group.label.toUpperCase() : 'SETTINGS',
      items: settingsRowsCache, selected: settingsSel,
      top: V.pageTop(settingsRowsCache.length, settingsSel),
      footer: hint,
    });
    return;
  }
  if (screen === PROGRESS) {
    V.drawList(ctx, { title: 'PROGRESS', right: progressRight, items: progressRows, selected: progressSel,
      footer: hint });
    return;
  }
  if (screen === PROGRESS_ITEM && progressItem) {
    if (progressItem.overview) V.drawOverview(ctx, progressItem);
    else V.drawProgress(ctx, progressItem);
    if (shiftHeld) V.drawHint(ctx, hint);
    return;
  }
  if (screen === QUIZ && quiz) {
    V.drawQuiz(ctx, {
      quiz, title: quizTitle, progress: Q.roundProgress(quiz),
      colours: answerBarActive() ? AP.COLOUR_NAMES : null,
      labelFor: (id) => Q.labelFor(quiz, id),
      isEliminated: (i) => Q.isEliminated(quiz, i),
      hintsLeft: Q.hintsLeft(quiz),
      footer: hint,
    });
    return;
  }
  if (screen === RESULT && resultCache) {
    resultCache.footer = hint;
    V.drawResult(ctx, resultCache);
    return;
  }
  if (reviewing() && chart && review.untimed) {
    const at = SC.nextEntryIndex(review.run, review.at);
    V.drawUntimedView(ctx, {
      run: review.run, chart, view: settings.view, lanes: chartLanes, dynamics: settings.dynamics,
      cursor: at < 0 ? review.run.entries.length : at, done: at < 0,
      title: chart.name, rightLabel: 'REVIEW', footerRight: '',
      progress: review.end > 0 ? review.at / review.end : 0,
    });
    return;
  }
  if (reviewing() && chart) {
    V.drawReadingView(ctx, {
      run: review.run, chart, songBeats: review.at, pxPerBeat: settings.pxPerBeat,
      view: settings.view, title: chart.name, bpm: chart.bpm, lanes: chartLanes,
      dynamics: settings.dynamics, beatFlash: false, timing: review.run.timing,
      paused: false, blocked: false, rightLabel: 'REVIEW',
      progress: review.end > 0 ? review.at / review.end : 0,
    });
    return;
  }
  if (screen === LADDER && ladder) {
    V.drawLadder(ctx, { ladder, reason: ladderReason, barsDone: ladderBarsDone, note: progressNote });
    if (shiftHeld) V.drawHint(ctx, hint);
    return;
  }
  if (screen === SUMMARY && run) {
    if (summaryInfo) {
      /* Stuck on a step, the line says the way on instead — unless Shift. */
      summaryInfo.footer = (!shiftHeld && stuckFooter()) || hint;
      V.drawSummary(ctx, summaryInfo);
    }
    return;
  }
  if (screen === READY && chart && chart.untimed) {
    const at = Math.max(0, tp.songBeats);
    V.drawUntimedReady(ctx, {
      run, chart, view: settings.view, lanes: chartLanes, dynamics: settings.dynamics,
      cursor: Math.max(0, SC.nextEntryIndex(run, at)), title: chart.name,
      rightLabel: at > 0 ? `${CH.barBeatOf(chart, at).bar}/${CH.barBeatOf(chart, at).bars}` : chartLength,
      footerRight: '', progress: 0, warning: chartWarning, scrubbed: at > 0,
      hint: at > 0 && !shiftHeld ? '' : hint,
    });
    return;
  }
  if (screen === RUNNING && run && chart && untimed) {
    V.drawUntimedView(ctx, {
      run, chart, view: settings.view, lanes: chartLanes, dynamics: settings.dynamics,
      cursor: untimed.index, done: untimed.finished, title: chart.name,
      rightLabel: untimed.livePace > 0 ? `${Math.round(untimed.livePace)}bpm` : '--',
      footerRight: `${untimed.firstTry}/${untimed.stacks - untimed.firstTry}`,
      progress: UT.progress(untimed), paused: tp.paused,
      hint: tp.paused || shiftHeld ? hint : '',
    });
    return;
  }
  if (screen === READY && chart) {
    V.drawReady(ctx, {
      run, chart, bpm: chart.bpm, title: chart.name,
      songBeats: tp.songBeats, pxPerBeat: settings.pxPerBeat, view: settings.view,
      lanes: chartLanes, dynamics: settings.dynamics, warning: chartWarning,
      /*
       * The length before you start, the position once you are scrubbing —
       * while navigating "where am I" is the only question, and the scroll
       * alone cannot answer it in bars.
       */
      rightLabel: tp.songBeats > 0
        ? `${CH.barBeatOf(chart, tp.songBeats).bar}/${CH.barBeatOf(chart, tp.songBeats).bars || '?'}`
        : chartLength,
      /* At home the keys; scrubbed into the drill, how far through it is. */
      hint: tp.songBeats > 0 && !shiftHeld ? '' : hint,
    });
    return;
  }
  if (screen === RUNNING && run && chart) {
    V.drawReadingView(ctx, {
      run, chart, songBeats: tp.songBeats, pxPerBeat: settings.pxPerBeat, view: settings.view,
      title: chart.name, bpm: chart.bpm, lanes: chartLanes,
      dynamics: settings.dynamics, beatFlash, timing: run.timing, paused: tp.paused, blocked: tp.blocked,
      progress: endlessProgress(),
      /* While the music runs the bottom line is how far through; paused, or
       * with Shift held, it is the keys. */
      hint: tp.paused || shiftHeld ? hint : '',
    });
    if (clockMode) {
      const perBar = CH.beatsPerBar(chart);
      const from = C.silenceStart(tp.songBeats, settings.clockBars, perBar);
      const muted = from !== null;
      V.drawClockBanner(ctx, {
        muted,
        drift: muted ? statsSince(run.timing, from).meanMs : 0,
        barsLeft: muted ? 0
          : Math.max(0, settings.clockBars - Math.floor((tp.songBeats % (settings.clockBars * perBar)) / perBar)),
      });
    }
    const digit = C.countInDigit(tp.songBeats, settings.countIn);
    if (digit > 0) V.drawCountIn(ctx, digit);
    return;
  }

  /*
   * Nothing matched. That is a bug rather than a state, so say so on screen
   * instead of leaving the last frame up: a visibly wrong screen can be
   * reported, a frozen one cannot.
   */
  V.drawError(ctx, {
    where: 'draw',
    message: `no screen for "${screen}"`,
    count: errCount,
    safeMode,
  });
}

/* ---- lifecycle ---------------------------------------------------------- */
globalThis.init = function init() {
  guard('init', initInner);
};

function initInner() {
  /*
   * Cleared here as well as declared, because `exited` is a latch that stops
   * tick() dead. If shadow_ui ever reuses one JS context across two loads of
   * this module, a module opened after being closed would come up already
   * latched and never draw. It does not today — ui.js is re-evaluated per load
   * — which is the only reason this has never been visible.
   */
  exited = false;
  pendingExitAt = 0;
  const loaded = SET.loadSettings(readFile(SETTINGS_PATH));
  settings = loaded.settings;
  if (loaded.changed) saveSettings();
  loadPads();
  refreshLayout();
  stats = loadStats();
  manifestError = '';
  loadExercises();
  lessons = LES.parseLessons(readFile(`${MODULE_DIR}/lessons.json`)).cards;
  helpTopics = HP.parseHelp(readFile(`${MODULE_DIR}/help.json`));
  rebuildMenu();
  /* After the tree: reading takes in from stats.json needs its item ids. */
  progress = loadProgress();
  pathStep = null;
  progressNote = null;
  if (manifestError) {
    menuNote = 'BAD USER.JSON';
    if (manifestError.indexOf('index.json') >= 0) menuNote = 'BAD INDEX.JSON';
    menuNoteUntil = now() + 8000;
    announce(manifestError);
  }
  refreshSettingsRows();
  invalidateLedCache();
  darkenPads();
  dspSet('gain', '0.45');
  screen = MENU;
  sheet = null;
  help = null;
  tipCard = null;
  continueTurn = 'review';
  fromContinue = false;
  announce('Drums Practice');
  /* A newcomer is welcomed; someone who practised before the welcome
   * existed only has it noted as seen. */
  const w = TIPS.welcomeOnLoad(progress, Object.keys(progress.items).length + stats.records.length);
  if (w === 'silent') {
    PROG.addTip(progress, 'welcome');
    saveProgress();
  } else if (w === 'show') {
    startWelcome();
  }
}

globalThis.tick = function tick() {
  if (globalThis.overtakeParked) return;
  guard('tick', tickInner);
};

function tickInner() {
  /* Gone. Do nothing at all, least of all light the pads again. */
  if (exited) return;

  const t = now();

  /*
   * Leaving takes priority over everything, including safe mode: whatever
   * else is broken, the way out has to keep working. Nothing else runs while
   * the queue drains — it is a tenth of a second and the module is going.
   */
  if (pendingExitAt) {
    serviceExit();
    serviceOutbox(false);
    return;
  }

  /*
   * In safe mode the drill is not run at all — only the error is drawn. A
   * path that throws every frame, retried fifty times a second, is how a
   * fault stops being a fault and becomes a hang.
   */
  if (safeMode) {
    if (!drawDead && t - lastDraw >= DRAW_INTERVAL_MS) {
      lastDraw = t;
      try {
        draw();
      } catch (e) {
        /* The error screen cannot be drawn either, so the display is beyond
         * help. Stop touching it; Back still works. */
        drawDead = true;
      }
    }
    return;
  }

  if (screen === RUNNING && run && chart && untimed) {
    /* No clock: only the window of the stack being struck runs out — and
     * that is when the stack is judged. */
    if (!tp.paused) {
      const r = UT.settle(untimed, t);
      if (r && r.lapsed && r.lapsed.length) setFlash(padsOfVoices(r.lapsed), PAD.LED_MISS);
    }
    if (untimed.finished) stopUntimed();
  } else if (screen === RUNNING && run && chart && !tp.paused) {
    advanceClock();
    /*
     * Material is generated in EVERY mode, because it is pruned in every mode.
     * Growing it only while practising meant Listen ran out after the two
     * repeats created up front and then showed an empty chart for the rest of
     * the drill — the notes simply stopped appearing. Scoring stays
     * practice-only; having something to look at does not.
     */
    SC.ensureEntries(run, tp.songBeats + 8);
    serviceClick();
    serviceReference();
    if (tp.mode === C.MODE_PRACTICE) {
      SC.expireMissed(run, tp.scoreBeats, settings.study);
      serviceLadder();
    }
    SC.pruneEntries(run, CH.xToBeat(L.DESPAWN_X, tp.songBeats, settings.pxPerBeat) - 1);
    V.pruneMarkers(run, CH.xToBeat(L.DESPAWN_X, tp.songBeats, settings.pxPerBeat));
    if (SC.runFinished(run, tp.songBeats, tp.blocked)) stop();
    /* The Clock runs endless under the hood and ends here, after its rounds:
     * it used to have no end at all, so it never showed a result or recorded. */
    else if (clockMode && tp.mode === C.MODE_PRACTICE && tp.songBeats >= clockEnd() + run.late) stop();
  }

  /* The quiz's prompt, or L0's bar: either way a figure on the wall clock. */
  servicePrompt();
  if (screen === QUIZ && quiz) serviceQuiz();

  flushDsp();
  serviceOutbox(false);

  if (t - lastLed >= LED_INTERVAL_MS) {
    lastLed = t;
    paintLeds(t);
    transport();
  }
  serviceTips();
  if (t - lastDraw >= DRAW_INTERVAL_MS) {
    lastDraw = t;
    draw();
    /*
     * A frame this slow is not survivable at 50Hz — the screen will stutter
     * and the LED queue will back up — so stop the drill and say so rather
     * than limping. This cannot catch a true infinite loop (nothing inside
     * JavaScript can), which is why every loop in this module is bounded.
     */
    const spent = now() - t;
    if (spent > SLOW_FRAME_MS) {
      recordError('draw', new Error(`frame took ${Math.round(spent)}ms`));
    }
  }
  /* Not while the music runs: a settings change mid-take would otherwise put
   * an eMMC write in the middle of the playing. It goes when the run stops or
   * pauses, and on the way out regardless. */
  if (screen !== RUNNING || tp.paused) flushFiles(false);
}

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  guard('midi', () => midiInner(data));
};

/*
 * The host hands over a PLAIN THREE-BYTE MIDI MESSAGE: [status, d1, d2].
 *
 * Not a four-byte USB-MIDI packet. This module shipped once assuming the
 * latter, which made every press decode its data byte as the status: a Menu
 * press arrived as 0xB0,50,127 and was read as status 50, matched no branch,
 * and was dropped. The module drew its menu once and then ignored every
 * input — which on the device is indistinguishable from a freeze, and took a
 * rescue chord to escape.
 *
 * The four-byte form is what goes OUT (move_midi_inject_to_move takes a cable
 * nibble); nothing comes in that way. Do not "fix" this to handle both: a
 * status byte always has its high bit set, so a length-sniffing decoder would
 * silently misread a real message the day the host changed.
 */
function midiInner(data) {
  if (!data || data.length < 3) return;
  const status = data[0];
  const d1 = data[1];
  const d2 = data[2];
  const type = status & 0xF0;

  if (type === 0x90 || type === 0x80) {
    /*
     * Notes below 10 are capacitive KNOB TOUCH, not pads — a module that
     * treats them as pads gets phantom hits the moment a finger rests on a
     * knob. They are not noise, though: touching a knob in Settings moves the
     * cursor to the row that knob edits, which is what makes the mapping
     * something you can FIND rather than something you have to know.
     */
    if (d1 <= C.KNOB_TOUCH_MAX) {
      if (type === 0x90 && d2 > 0) knobTouched(d1);
      return;
    }
    if (!PAD.isPad(d1)) return;
    if (type === 0x90 && d2 > 0) padDown(d1, d2);
    else padUp(d1);
    return;
  }
  if (type !== 0xB0) return;

  /* Shift is a modifier, not an action: it is tracked and never consumed. */
  if (d1 === C.CC_SHIFT) {
    shiftHeld = d2 > 0;
    return;
  }

  switch (d1) {
    case C.CC_JOG_TURN: {
      const delta = decodeDelta(d2);
      if (!delta) return;
      jog(delta);
      return;
    }
    case C.CC_JOG_CLICK:
      /* Shift + jog click: on a row of the list, its options; elsewhere,
       * Settings over whatever is on screen, as it always was. */
      if (d2 > 0) {
        if (shiftHeld) shiftClick();
        else click();
      }
      return;
    case C.CC_MENU:
      /* Help for this screen, wherever you are; MENU again closes it. The
       * error screen keeps MENU as the way back to the list. */
      if (d2 <= 0) return;
      if (screen === ERROR) leaveToMenu();
      else if (screen === HELP) closeHelp();
      else openHelp();
      return;
    case C.CC_BACK:
      /* Shift + Back closes from anywhere, as the manual promises. */
      if (d2 <= 0) return;
      if (shiftHeld || !back()) closeModule();
      return;
    case C.CC_PLAY:
      if (d2 <= 0) return;
      /* In a hearing drill Play repeats the question — without it a prompt
       * you did not catch is a prompt you cannot answer. */
      if (screen === QUIZ && promptIsAudible()) { schedulePrompt(); return; }
      if (screen === CARD && card) { hearFromCard(); return; }
      if (screen === READY || ((screen === SUMMARY || screen === LADDER) && chart)) {
        if (screen !== READY) enterReady();
        start(false);
      } else if (screen === RUNNING) transportPress(C.MODE_LISTEN);
      return;
    case C.CC_RECORD:
      if (d2 <= 0) return;
      if (screen === QUIZ && quiz) {
        const hint = Q.takeHint(quiz);
        if (hint === 'sound' || hint === 'name') schedulePrompt();
        return;
      }
      /* From a result, Record is another take, straight away. */
      if (screen === READY || ((screen === SUMMARY || screen === LADDER) && chart)) {
        if (screen !== READY) enterReady();
        start(true);
      } else if (screen === RUNNING) transportPress(C.MODE_PRACTICE);
      return;
    default:
      break;
  }

  if (d1 >= C.CC_KNOB1 && d1 < C.CC_KNOB1 + C.KNOB_COUNT) {
    const k = d1 - C.CC_KNOB1;
    const delta = decodeDelta(d2);
    if (!delta) return;
    /*
     * THE KNOBS ARE CONTEXTUAL, and only Settings changes settings.
     *
     *   in a drill   1 scrubs while the music is stopped; 8 sets Speed
     *   Settings     the rows on screen, in order
     *   elsewhere    nothing
     *
     * They used to edit Tempo, Read ahead, Reps and Kit from any screen, with
     * nothing on it to say so — a quiz could be thrown away for the ready
     * screen by a knob brushed on the way past, and Kit switched the pad layout
     * in the middle of a run.
     */
    if ((screen === SUMMARY || screen === LADDER) && k === 0 && chart) {
      reviewStep((delta * CH.beatsPerBar(chart)) / REVIEW_UNITS_PER_BAR);
      return;
    }
    if (screen === READY || screen === RUNNING) {
      /* Not while an L0 take is paused: a seek would move the notes under a
       * cursor that only the pads move. */
      if (k === 0 && (screen === READY || (tp.paused && !untimed))) scrub(delta);
      else if (k === C.KNOB_COUNT - 1) changeSpeed(delta);
      return;
    }
    if (screen === PADMAP) {
      if (k === 0) PMS.toggleBoth(pm, padMapView());
      return;
    }
    if (screen === SETTINGS) {
      const i = settingsRowForKnob(k);
      if (i < 0) return;
      settingsSel = i;
      editSetting(settingsDefs[i].key, delta);
    }
  }
}

/*
 * Which settings row a knob addresses: the rows ON SCREEN, which Settings
 * shows a page of five at a time. The page only turns when the cursor leaves
 * it, so a knob keeps its row however far it is turned — the list used to
 * re-centre on every step, and one turn of knob 4 edited four settings. Knobs
 * past the fifth have no row on screen and do nothing.
 */
function settingsRowForKnob(k) {
  if (k < 0 || k >= V.LIST_ROWS) return -1;
  const i = V.pageTop(settingsDefs.length, settingsSel) + k;
  return i < settingsDefs.length ? i : -1;
}

function knobTouched(knob) {
  /* Notes 0-7 are the knobs; 8 is the volume knob and 9 the jog wheel, whose
   * touch used to move the cursor nine rows. */
  if (screen !== SETTINGS || knob >= C.KNOB_COUNT) return;
  const i = settingsRowForKnob(knob);
  if (i < 0) return;
  settingsSel = i;
}

function jog(delta) {
  const target = C.jogTarget(screen, settingsEditing);
  if (target === 'menu') {
    const top = CAT.navTop(nav);
    top.cursor = Math.max(0, Math.min(top.node.children.length - 1, top.cursor + delta));
  } else if (target === 'row') {
    settingsSel = Math.max(0, Math.min(settingsDefs.length - 1, settingsSel + delta));
  } else if (target === 'value') {
    editSetting(settingsDefs[settingsSel].key, delta);
  } else if (target === 'padmap') {
    padMapJog(delta);
  } else if (target === 'page' && card) {
    LES.turnPage(card.deck, delta);
  } else if (target === 'sheet' && sheet) {
    sheet.sel = Math.max(0, Math.min(sheet.items.length - 1, sheet.sel + delta));
  } else if (target === 'scroll' && (help || tipCard)) {
    HP.scrollPage(help || tipCard, delta);
  } else if (target === 'welcome' && welcome) {
    TIPS.welcomeJog(welcome, delta);
  } else if (target === 'choice' && quiz) {
    Q.moveChoice(quiz, delta);
  } else if ((screen === SUMMARY || screen === LADDER) && review) {
    reviewStep(delta);
  } else if (screen === PROGRESS_ITEM) {
    /* On through the list's charts without going back to it, as in piano. */
    const n = progressRows.length;
    const next = Math.max(0, Math.min(n - 1, progressSel + delta));
    if (next !== progressSel) {
      progressSel = next;
      progressItem = progressDetail(progressSel);
    }
  } else if (target === 'drill') {
    progressSel = Math.max(0, Math.min(progressRows.length - 1, progressSel + delta));
  }
}

function shiftClick() {
  if (screen === MENU) openSheet();
  else if (screen === SHEET) sheetDo();
  else if (screen === SETTINGS) leaveSettings();
  else if (screen !== HELP && screen !== TIP && screen !== WELCOME && screen !== ERROR) openSettings();
}

function click() {
  if (screen === MENU) { openRow(); return; }
  if (screen === SHEET) { sheetDo(); return; }
  if (screen === TIP) { closeTip(); return; }
  if (screen === WELCOME && welcome) { welcomeClick(); return; }
  if (screen === CARD && card) { nextCard(); return; }
  if (screen === SETTINGS) {
    const row = settingsDefs[settingsSel];
    if (row && row.type === 'action') {
      if (row.action === 'padmap') openPadMap();
      return;
    }
    settingsEditing = !settingsEditing;
    return;
  }
  if (screen === PADMAP) { padMapClick(); return; }
  if (screen === QUIZ && quiz && quiz.mode === 'pick') {
    const r = Q.pickChoice(quiz, now());
    if (r === 'right') quizSolvedAt = now();
    return;
  }
  if (screen === PROGRESS) { openProgressRow(); return; }
  /* On along the Path, when that is where the drill came from; on as
   * Continue would, after a review Continue opened. */
  if ((screen === RESULT || screen === SUMMARY || screen === LADDER) && pathStep) {
    goNext();
    return;
  }
  if ((screen === RESULT || screen === SUMMARY) && fromContinue) {
    quiz = null;
    resultCache = null;
    screen = MENU;
    continueOpen();
    return;
  }
  if (screen === RESULT) { screen = MENU; quiz = null; resultCache = null; return; }
  /* On from a result: the next drill in the folder it came from — the next
   * level of a groove, the next rudiment. From a Ladder or a Clock, another go. */
  if (screen === SUMMARY || screen === LADDER) {
    if (!chart) { screen = MENU; return; }
    if (ladder || clockMode) { restart(); return; }
    const top = CAT.navTop(nav);
    if (top.cursor + 1 < top.node.children.length) {
      top.cursor++;
      screen = MENU;
      openRow();
      if (screen !== MENU) return;
    }
    screen = MENU;
  }
}

/*
 * Changing tempo, loop length or the kit rebuilds the armed drill straight
 * away, so what is on screen is always what has been dialled in. A
 * hand-written drill keeps its own tempo — it is fixed material, not a recipe
 * to re-run at another speed.
 */
function editSetting(key, delta) {
  const wasStudying = settings.study;
  SET.applySetting(settings, key, delta);
  refreshSettingsRows();
  saveSettings();
  /* Study switched on mid-run would otherwise find the wait pointer parked on a
   * note from minutes ago and pin the clock there — a jump backwards. */
  if (key === 'study' && settings.study && !wasStudying && run && screen === RUNNING) {
    SC.resyncWait(run, tp.songBeats);
  }
  /* The pads do not rebuild the drill, but they decide what it can reach. */
  if (key === 'layout' || key === 'flip') refreshLayout();
  /* Re-armed from the chart it was built from, so a level, a random drill or a
   * drill wrapped by the Ladder or Clock is rebuilt too — and the Settings
   * screen you are editing in stays up. */
  if (SET.affectsChart(key) && armedSource && chart) {
    /* A run paused under Settings cannot carry on at another tempo or length:
     * it is put away, and leaving Settings lands on the ready screen. */
    if (tp.mode !== C.MODE_IDLE && settingsFrom === RUNNING) settingsFrom = READY;
    const keep = screen;
    armChart(armedSource);
    if (keep === SETTINGS) screen = SETTINGS;
  }
}

globalThis.onMidiMessageExternal = function onMidiMessageExternal(_data) {};

globalThis.onResume = function onResume() {
  guard('resume', () => {
    invalidateLedCache();
    for (let i = 0; i < PAD.PAD_COUNT; i++) ledPrev[i] = -1;
  });
};

/*
 * The HOST is tearing us down — there are no more ticks coming, so this is
 * the one place the work has to be synchronous and best-effort.
 *
 * It does NOT call host_exit_module: we are already being unloaded, and
 * asking again would be answering a question nobody asked. The deferred path
 * above is for when the PLAYER leaves, which is the case where the drain
 * matters and where there are still ticks to do it in.
 *
 * Not guarded as one block: closing has to get ALL the way through even if
 * part of it throws. A failure to write settings must not stop the panic, and
 * a failure to panic must not stop the LEDs going dark — the player is
 * leaving either way, and what they must not be left with is a lit grid and a
 * ringing kit.
 */
/*
 * What the list shows, for tests that walk the menu by name rather than by
 * counting jog turns (tests/ui_smoke.test.mjs goTo). Read-only: it hands out
 * labels and the cursor, never the tree, so nothing can be changed through it.
 */
globalThis.drumsPracticeMenu = function drumsPracticeMenu() {
  if (screen !== MENU) return null;
  const top = CAT.navTop(nav);
  return { title: top.node.label, cursor: top.cursor, labels: menuRows(top.node).map((r) => r.label) };
};

/* The screen on show and, on the action sheet, its rows: read-only too. */
globalThis.drumsPracticeScreen = function drumsPracticeScreen() {
  return { screen, sheet: sheet ? sheet.items.map((a) => a.label) : null, help: help ? help.lines.slice() : null };
};

globalThis.onUnload = function onUnload() {
  /*
   * ONCE, however many times we are asked.
   *
   * A device log of a real unload shows the host calling this 53 times in
   * 150ms — every 2.8ms, far faster than the tick. The module asks to leave
   * exactly once (closeModule guards on pendingExitAt||exited, serviceExit
   * calls host_exit_module once, and tickInner returns early once `exited`),
   * so the repetition is the host's and not something this side can stop.
   *
   * What it CAN stop is doing the whole teardown 53 times. Each pass forces 32
   * CC messages into a ring that holds about 64 and drains 31 per audio block
   * — and that ring is shared with Move's own output, the LED queue and the
   * shadow UI. Flooding it with ~1700 messages at the exact moment control
   * goes back to Move is a poor way to say goodbye. Each pass also rewrote the
   * stats and settings files.
   */
  if (exited) {
    pendingExitAt = 0;
    return;
  }
  pendingExitAt = 0;
  exited = true;
  guard('unload:panic', () => dspSet('panic', '1'));
  guard('unload:midi', () => {
    if (!routesUsed) return;
    clearOutbox();
    for (let chn = 0; chn < 16; chn++) {
      queue(routesUsed, 0xB0 | chn, 120, 0);
      queue(routesUsed, 0xB0 | chn, 123, 0);
    }
    serviceOutbox(true);
  });
  guard('unload:leds', () => {
    darkenPads();
    setButtonLED(C.CC_PLAY, 0);
    setButtonLED(C.CC_RECORD, 0);
  });
  guard('unload:files', () => {
    savePads();
    flushFiles(true);
  });
};
