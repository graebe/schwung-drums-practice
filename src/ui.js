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
import { paint, flashColor, guideTargets, FLASH_MS } from './led_paint.mjs';
import { stats as timingStats, statsSince } from './timing.mjs';

const MODULE_DIR = '/data/UserData/schwung/modules/tools/drums-practice';
const SETTINGS_PATH = `${MODULE_DIR}/settings.json`;
const STATS_PATH = `${MODULE_DIR}/stats.json`;
/* A second copy, written after the first: the host has no rename, so a save
 * cut short by the power going leaves one of the two whole. */
const STATS_BAK_PATH = `${MODULE_DIR}/stats.bak.json`;
/* A stats file that would not read, kept rather than overwritten. */
const STATS_BAD_PATH = `${MODULE_DIR}/stats.bad.json`;
const CRASH_PATH = `${MODULE_DIR}/crash.log`;
const EXERCISE_DIR = `${MODULE_DIR}/exercises`;

const DRAW_INTERVAL_MS = 20;
const LED_INTERVAL_MS = 20;
/* The MIDI out buffer holds ~64 packets and drains 31 per audio block, so
 * everything leaving here is paced. Flooding it drops notes silently. */
const OUTBOX_PER_TICK = 8;
const OUTBOX_MAX = 512;

/* Screens. */
const MENU = 'menu';
const READY = 'ready';
const RUNNING = 'running';
const SUMMARY = 'summary';
const LADDER = 'ladder';
const QUIZ = 'quiz';
const RESULT = 'result';
const PROGRESS = 'progress';
const SETTINGS = 'settings';
const ERROR = 'error';

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
/* A word for the list's title bar, briefly: "ARM A DRILL". */
let menuNote = '';
let menuNoteUntil = 0;
let settingsSel = 0;
let settingsEditing = false;
let progressSel = 0;

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
let progressCache = null;
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

function sound(voice, vel) {
  const i = KIT.voiceIndex(voice);
  if (i < 0) return;
  if (settings.midiOut & OUT_INTERNAL) {
    dspNotes = dspNotes ? `${dspNotes},${i}:${vel}` : `${i}:${vel}`;
  }
  const route = settings.midiOut & (OUT_TRACK | OUT_USB);
  /* Both halves or neither: a note-on whose note-off was dropped on a full
   * queue is a note left sounding downstream. */
  if (route && outboxRoom() >= 2) {
    const gm = GM_NOTES[i] || 38;
    queue(route, 0x90 | midiChannel(), gm, vel);
    queue(route, 0x80 | midiChannel(), gm, 0);
  }
}

/* General MIDI drum notes, so a Move drum rack answers something sane. Made
 * once: this ran on every hit. */
const GM_NOTES = [49, 42, 46, 51, 48, 38, 45, 36, 44];

function midiChannel() {
  return settings.midiCh > 0 ? settings.midiCh - 1 : 9; /* 10 is the drum channel */
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
  layout: 'kit', held: null, flash: null, targets: null, sounding: null,
  stuck: null, phase: 0, prompt: null, dark: false,
};
const promptBuf = [null];

function paintLeds(t) {
  const st = paintState;
  st.layout = layoutNow();
  st.held = held;
  st.flash = flash && t < flashUntil ? flash : null;
  st.targets = scrubTargets() || (settings.guide && run && screen === RUNNING
    ? guideTargets(run, tp.songBeats) : null);
  st.sounding = tp.mode === C.MODE_LISTEN && screen === RUNNING && t < listenLitUntil ? listenLit : null;
  st.stuck = stuckTargets();
  st.phase = Math.floor(t / 500) % 2;
  /* The second hint lights the pad. Only for the drills whose answer IS a
   * pad — naming a groove has no pad to light. */
  if (screen === QUIZ && quiz && quiz.kind === 'voice' && quiz.hints >= 2) {
    promptBuf[0] = quiz.prompt;
    st.prompt = promptBuf;
  } else {
    st.prompt = null;
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
 * THE FIRST THING IN THE LIST IS THE FIRST THING TO PLAY: Basics, then the
 * grooves and rudiments, and the things that are ABOUT practising rather than
 * practice itself — Training, Quiz, Progress — at the bottom. Each is a folder
 * now, so the top of the list is seven rows rather than forty-eight.
 *
 * Rebuilt whenever the material or the tempo changes; the open folders are
 * carried across by path.
 */
function rebuildMenu() {
  catalog = CAT.drumsTree({
    entries: fileEntries,
    categories: fileCategories,
    bpm: settings.bpm,
    drills: Q.DRILLS,
    newSeed: () => (Date.now() & 0x7fffffff) || 1,
  });
  nav = nav.length ? CAT.navRestore(catalog, CAT.navPath(nav)) : CAT.navStart(catalog);
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
  run = SC.createRun(chart, runOpts());
  /* Everything about the armed drill that the draw would otherwise work out
   * again fifty times a second. */
  chartWarning = IO.playabilityWarnings(chart)[0] || '';
  chartLanes = GR.lanes(KIT.voicesInChart(chart));
  chartLength = IO.practiceLength(chart);
  /* A newly armed drill starts at home, where the box is. */
  T.home(tp);
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
  settingsRowsCache = SET.settingsRows(settings);
  saveSettings();
  const base = armedSource && armedSource.generated ? settings.bpm : (armedSource ? armedSource.bpm : chart.bpm);
  armedBpm = Math.max(20, Math.round((base * settings.speed) / 100));
  if (screen === READY) {
    chart = { ...chart, bpm: armedBpm };
    run = SC.createRun(chart, runOpts());
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
    accentVel: settings.accentVel,
    ghostVel: settings.ghostVel,
    latencyMs: settings.latencyMs,
    /* The Ladder and the Clock outlast the drill they wrap and impose their
     * own ending, so they run it endless. Everything else ends when the
     * written practice does. */
    repeats: (ladder || clockMode) ? 0 : undefined,
  };
}

function start(practice) {
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

/* Hold the playhead. The clock stops; the panel does not. */
function pause() {
  if (!T.pause(tp, now())) return;
  dspSet('panic', '1');
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
  if (tp.mode === want) { togglePause(); return; }
  const at = T.switchMode(tp, want, now(), chart.bpm);
  if (want === C.MODE_PRACTICE) SC.seekTo(run, at);
  dspSet('panic', '1');
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
  dspSet('panic', '1');
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
  const limit = Number.isFinite(run.endBeat) ? run.endBeat : base + perBar;
  let to = (units * perBar) / SCRUB_UNITS_PER_BAR;
  to = Math.max(0, Math.min(Math.max(0, limit - perBar), to));
  tp.scrubCue = true;
  if (Math.abs(to - tp.songBeats) < 1e-9) return;
  T.seek(tp, to, now(), chart.bpm);
  SC.ensureEntries(run, to + 8);
  SC.seekTo(run, to);
  dspSet('panic', '1');
}

/*
 * The run is over. Recorded only when it was a whole attempt: practised, from
 * the top, never scrubbed — a passage worked on from a chosen bar is practice
 * on that passage, and its numbers do not belong on the drill's chart. A
 * Ladder records itself (serviceLadder), once.
 */
function stop() {
  dspSet('panic', '1');
  summaryIsBest = false;
  if (ladder) {
    ladderBarsDone = Math.max(0, Math.min(ladder.bars,
      Math.floor((tp.songBeats - ladder.windowStart) / CH.beatsPerBar(chart))));
  }
  const whole = tp.mode === C.MODE_PRACTICE && !tp.scrubbed && run && run.hits > 0;
  if (whole && !ladder) recordRun();
  summaryInfo = {
    name: chart.name,
    bpm: chart.bpm,
    history: ST.forDrill(stats, ST.drillId(clockMode ? 'clock' : 'drill', recordIdOf(chart), settings)),
    recorded: whole,
    footer: clockMode ? 'REC again  BACK start' : 'REC again  CLICK next',
  };
  T.home(tp);
  screen = ladder ? LADDER : SUMMARY;
}

function recordRun() {
  const t = timingStats(run.timing);
  const rec = ST.makeRecord({
    drill: ST.drillId(clockMode ? 'clock' : 'drill', recordIdOf(chart), settings),
    bpm: chart.bpm,
    sd: t.sdMs,
    mean: t.meanMs,
    n: t.n,
    err: run.misses + run.stickErrors + run.dynErrors,
    at: Date.now() / 1000,
    context: attemptContext(),
  });
  stats = ST.addRecord(stats, rec);
  summaryIsBest = ST.forDrill(stats, rec.d).length > 1 && ST.isPersonalBest(stats, rec);
  saveStats();
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
  if (hit) dspSet('c', hit.downbeat ? '1' : '0');
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
        n: run.hits, err: 0, at: Date.now() / 1000, context: attemptContext(),
      }));
      saveStats();
    }
    stop();
    return;
  }
  if (ladder.again) announce(`again at ${ladder.bpm}`);
  /* Climb: the tempo, the run's windows and the clock all move together. */
  if (ladder.bpm !== chart.bpm) setTempo(ladder.bpm);
  LAD.beginRung(ladder, run, tp.songBeats);
}

/* How long the Clock runs: this many rounds of click-on then click-off. */
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

function servicePrompt() {
  if (!promptQueue.length) return;
  const t = now();
  while (promptQueue.length && promptQueue[0].atMs <= t) {
    const e = promptQueue.shift();
    sound(e.voice, e.vel);
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
  held.add(pad);
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
  /* The marker goes where the press was SEEN (songBeats); the judgement is
   * about TIME, so it keeps the honest clock — and is told the frozen one, so
   * a note the scroll has not reached is only as near as it looks. */
  const j = SC.judgeHit(run, { voice, hand, velocity: vel }, tp.scoreBeats, tp.songBeats);
  SC.addMarker(run, voice, tp.songBeats, hand);
  setFlash(PAD.padsForVoice(voice, settings.layout, hand), flashColor(j));
}

function padUp(pad) {
  held.delete(pad);
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
  };
  screen = RESULT;
  announce(`round done, ${Math.round(resultCache.rate)} per minute`);
}

/* Open the highlighted row: into a folder, or do what the row holds. */
function openRow() {
  const item = CAT.navCurrent(nav);
  if (!item) return;
  if (CAT.navPush(nav)) {
    announce(`${item.label}.`);
    return;
  }
  if (item.kind === 'progress') {
    screen = PROGRESS;
    rebuildProgress();
    return;
  }
  if (item.kind === 'quiz') {
    quiz = Q.createQuiz({
      kind: item.quiz.kind, mode: item.quiz.mode,
      roundSize: settings.roundSize, charts: grooveCharts(),
      seed: (Date.now() & 0xffff) || 1,
    });
    quizTitle = (item.quiz.name || item.label || '').toUpperCase();
    quizSolvedAt = 0;
    screen = QUIZ;
    if (promptIsAudible()) schedulePrompt();
    return;
  }
  /*
   * The Ladder and the Clock WRAP the armed drill — climb its tempo, take its
   * click away. With nothing armed they used to grab the first drill in the
   * list, which was a single stroke roll nobody had picked; now they say so.
   */
  if ((item.kind === 'clock' || item.kind === 'ladder') && !chart) {
    menuNote = 'ARM A DRILL';
    menuNoteUntil = now() + 2000;
    announce('Arm a drill first, then open the ' + item.label + '.');
    return;
  }
  if (item.kind === 'clock') {
    clockMode = true;
    ladder = null;
    enterReady();
    announce(`Clock: ${chart.name}`);
    return;
  }
  if (item.kind === 'ladder') {
    /* From 70% of the tempo the drill is played at — its own times Speed —
     * climbing through it. */
    clockMode = false;
    ladder = newLadder();
    ladderReason = '';
    enterReady();
    announce(`Ladder: ${chart.name}, from ${ladder.bpm}`);
    return;
  }
  /* A drill. Whatever the Ladder or the Clock was wrapping before, this is not
   * it. */
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

/* The pad layout a press is read in. A drum quiz always uses the kit: in the
 * sticking layout every pad is the snare, and eight of nine prompts could not
 * be answered at all. */
function layoutNow() {
  return screen === QUIZ ? 'kit' : settings.layout;
}

/* The plot for whichever drill the jog is on. Scans the whole history, so it
 * runs when the selection changes and not once a frame. */
function rebuildProgress() {
  const drills = ST.drillsWithHistory(stats);
  const id = drills[progressSel % Math.max(1, drills.length)] || '';
  const recs = ST.forDrill(stats, id);
  progressCache = { drillLabel: ST.drillLabel(id, drillNames()), records: recs, summary: ST.summarise(recs) };
}

/* What Progress calls each drill: the list's own names, for charts and quizzes. */
function drillNames() {
  const names = {};
  for (const c of fileCharts) names[c.id] = c.name;
  for (const d of Q.DRILLS) names[`${d.mode}:${d.kind}`] = d.name;
  /* Random drills are recorded under their family, not their seed. */
  for (const c of GEN.builtins({})) names[c.family] = c.name;
  return names;
}

/* Settings opens over whatever is on screen, pausing a run, and goes back to it. */
function openSettings() {
  settingsFrom = screen;
  if (screen === RUNNING && !tp.paused) pause();
  screen = SETTINGS;
  settingsEditing = false;
}

function leaveSettings() {
  settingsEditing = false;
  let to = settingsFrom;
  if ((to === READY || to === RUNNING) && !chart) to = MENU;
  if (to === SETTINGS || to === ERROR) to = MENU;
  screen = to;
}

/*
 * Menu: back to the list from anywhere. A run is stopped properly on the way —
 * the kit silenced, the transport home, nothing half-recorded and no Record
 * light left burning over the list.
 */
function leaveToMenu() {
  if (tp.mode !== C.MODE_IDLE) {
    dspSet('panic', '1');
    T.home(tp);
  }
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
  /* Back from a result is another go from the top; Back again is the list. */
  if ((screen === SUMMARY || screen === LADDER) && chart) { restart(); return true; }
  /* Up one folder; only the top of the tree is left by Back. */
  if (screen === MENU) return CAT.navPop(nav);
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
/* The rows of the open folder, made once per folder rather than per frame:
 * the list is drawn at 50Hz and its rows only change when the folder does. */
let rowsNode = null;
let rowsCache = null;
function menuRows(node) {
  if (node !== rowsNode) {
    rowsNode = node;
    rowsCache = CAT.rowsOf(node);
  }
  return rowsCache;
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
  if (screen === MENU) {
    const top = CAT.navTop(nav);
    const title = menuNote && now() < menuNoteUntil ? menuNote : top.node.label.toUpperCase();
    V.drawList(ctx, { title: title.slice(0, 16), items: menuRows(top.node), selected: top.cursor });
    return;
  }
  if (screen === SETTINGS) {
    V.drawList(ctx, {
      title: settingsEditing ? 'SET *' : 'SETTINGS',
      items: settingsRowsCache, selected: settingsSel,
      top: V.pageTop(settingsRowsCache.length, settingsSel),
    });
    return;
  }
  if (screen === PROGRESS) {
    if (progressCache) V.drawProgress(ctx, progressCache);
    return;
  }
  if (screen === QUIZ && quiz) {
    V.drawQuiz(ctx, {
      quiz, title: quizTitle, progress: Q.roundProgress(quiz),
      labelFor: (id) => Q.labelFor(quiz, id),
      isEliminated: (i) => Q.isEliminated(quiz, i),
      hintsLeft: Q.hintsLeft(quiz),
    });
    return;
  }
  if (screen === RESULT && resultCache) {
    V.drawResult(ctx, resultCache);
    return;
  }
  if (screen === LADDER && ladder) {
    V.drawLadder(ctx, { ladder, reason: ladderReason, barsDone: ladderBarsDone });
    return;
  }
  if (screen === SUMMARY && run) {
    V.drawSummary(ctx, {
      run, tightMs: SC.WINDOWS[settings.strictness].perfectMs, isBest: summaryIsBest,
      ...(summaryInfo || {}),
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
    });
    return;
  }
  if (screen === RUNNING && run && chart) {
    V.drawReadingView(ctx, {
      run, chart, songBeats: tp.songBeats, pxPerBeat: settings.pxPerBeat, view: settings.view,
      title: chart.name, bpm: chart.bpm, lanes: chartLanes,
      dynamics: settings.dynamics, beatFlash, timing: run.timing, paused: tp.paused, blocked: tp.blocked,
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
  stats = loadStats();
  manifestError = '';
  loadExercises();
  rebuildMenu();
  if (manifestError) {
    menuNote = 'BAD USER.JSON';
    if (manifestError.indexOf('index.json') >= 0) menuNote = 'BAD INDEX.JSON';
    menuNoteUntil = now() + 8000;
    announce(manifestError);
  }
  settingsRowsCache = SET.settingsRows(settings);
  invalidateLedCache();
  darkenPads();
  dspSet('gain', '0.45');
  screen = MENU;
  announce('Drums Practice');
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

  if (screen === RUNNING && run && chart && !tp.paused) {
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
    else if (clockMode && tp.mode === C.MODE_PRACTICE && tp.songBeats >= clockEnd()) stop();
  }

  if (screen === QUIZ && quiz) {
    servicePrompt();
    serviceQuiz();
  }

  flushDsp();
  serviceOutbox(false);

  if (t - lastLed >= LED_INTERVAL_MS) {
    lastLed = t;
    paintLeds(t);
    transport();
  }
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
      /* Shift + jog click opens settings from anywhere — the one gesture that
       * has to work whatever screen you are on. */
      if (d2 > 0) {
        if (shiftHeld) {
          if (screen === SETTINGS) leaveSettings();
          else openSettings();
        } else {
          click();
        }
      }
      return;
    case C.CC_MENU:
      if (d2 > 0) leaveToMenu();
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
    if (screen === READY || screen === RUNNING) {
      if (k === 0 && (screen === READY || tp.paused)) scrub(delta);
      else if (k === C.KNOB_COUNT - 1) changeSpeed(delta);
      return;
    }
    if (screen === SETTINGS) {
      const i = settingsRowForKnob(k);
      if (i < 0) return;
      settingsSel = i;
      editSetting(SET.ROWS[i].key, delta);
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
  const i = V.pageTop(SET.ROWS.length, settingsSel) + k;
  return i < SET.ROWS.length ? i : -1;
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
    settingsSel = Math.max(0, Math.min(SET.ROWS.length - 1, settingsSel + delta));
  } else if (target === 'value') {
    editSetting(SET.ROWS[settingsSel].key, delta);
  } else if (target === 'choice' && quiz) {
    Q.moveChoice(quiz, delta);
  } else if (target === 'drill') {
    const n = Math.max(1, ST.drillsWithHistory(stats).length);
    progressSel = (((progressSel + delta) % n) + n) % n;
    rebuildProgress();
  }
}

function click() {
  if (screen === MENU) { openRow(); return; }
  if (screen === SETTINGS) { settingsEditing = !settingsEditing; return; }
  if (screen === QUIZ && quiz && quiz.mode === 'pick') {
    const r = Q.pickChoice(quiz, now());
    if (r === 'right') quizSolvedAt = now();
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
  settingsRowsCache = SET.settingsRows(settings);
  saveSettings();
  /* Study switched on mid-run would otherwise find the wait pointer parked on a
   * note from minutes ago and pin the clock there — a jump backwards. */
  if (key === 'study' && settings.study && !wasStudying && run && screen === RUNNING) {
    SC.resyncWait(run, tp.songBeats);
  }
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
  guard('unload:files', () => flushFiles(true));
};
