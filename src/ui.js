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
import * as IO from './exercise_io.mjs';
import * as ST from './stats.mjs';
import * as LAD from './ladder.mjs';
import * as Q from './guess.mjs';
import { paint, flashColor, FLASH_MS } from './led_paint.mjs';
import { stats as timingStats, statsSince } from './timing.mjs';

const MODULE_DIR = '/data/UserData/schwung/modules/tools/drums-practice';
const SETTINGS_PATH = `${MODULE_DIR}/settings.json`;
const STATS_PATH = `${MODULE_DIR}/stats.json`;
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

/* ---- state -------------------------------------------------------------- */
let settings = SET.coerceInto({}, null);
let stats = ST.emptyStats();
let statsDirty = false;
let settingsDirty = false;
let lastFlush = 0;

let screen = MENU;
let menuItems = [];
let menuSel = 0;
let settingsSel = 0;
let settingsEditing = false;
let progressSel = 0;

let chart = null;
let run = null;
let quiz = null;
let ladder = null;
let ladderReason = '';
let clockMode = false;
let mode = C.MODE_IDLE;

let startedAt = 0;
let songBeats = 0;
let prevBeats = 0;
let waitedBeats = 0;
let blocked = false;
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
  if (route) {
    /* General MIDI drum notes, so a Move drum rack answers something sane. */
    const gm = [49, 42, 46, 51, 48, 38, 45, 36, 44][i] || 38;
    queue(route, 0x90 | midiChannel(), gm, vel);
    queue(route, 0x80 | midiChannel(), gm, 0);
  }
}

function midiChannel() {
  return settings.midiCh > 0 ? settings.midiCh - 1 : 9; /* 10 is the drum channel */
}

function flushDsp() {
  if (!dspNotes) return;
  dspSet('n', dspNotes);
  dspNotes = '';
}

/* ---- MIDI out ----------------------------------------------------------- */
function queue(route, status, d1, d2) {
  if (outbox.length >= OUTBOX_MAX) return;
  outbox.push(route, status, d1, d2);
}

function serviceOutbox(all) {
  let n = all ? outbox.length >> 2 : OUTBOX_PER_TICK;
  while (n-- > 0 && outbox.length) {
    const route = outbox.shift();
    const status = outbox.shift();
    const d1 = outbox.shift();
    const d2 = outbox.shift();
    if ((route & OUT_TRACK) && typeof move_midi_inject_to_move === 'function') {
      move_midi_inject_to_move([(2 << 4) | (status >> 4), status, d1, d2]);
    }
    if ((route & OUT_USB) && typeof move_midi_external_send === 'function') {
      move_midi_external_send([status >> 4, status, d1, d2]);
    }
  }
}

/* ---- LEDs --------------------------------------------------------------- */
function paintLeds(t) {
  const targets = settings.guide && run && screen === RUNNING ? guideTargets() : null;
  paint(ledBuf, {
    layout: settings.layout,
    held,
    flash: flash && t < flashUntil ? flash : null,
    targets,
    prompt: screen === QUIZ && quiz && quiz.mode === 'pick' ? null : null,
    dark: false,
  });
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

/*
 * What the guide pads point at. Only the hand being asked for lights when the
 * drill enforces sticking — lighting both halves would answer the question.
 */
function guideTargets() {
  const out = [];
  const from = run.cursor;
  for (let i = from; i < run.entries.length && out.length < 6; i++) {
    const e = run.entries[i];
    const away = e.beat - songBeats;
    if (away > 1.5) break;
    if (away < -run.late) continue;
    for (const n of e.notes) {
      if (n.state !== SC.PENDING) continue;
      out.push({ voice: n.voice, hand: run.sticking !== 'off' ? n.wantHand : null, beatsAway: away });
    }
  }
  return out;
}

function transport() {
  const phase = (now() / 600) % 1;
  const colors = C.transportColors(mode, screen === READY || screen === RUNNING, phase);
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
    statsDirty = !writeFile(STATS_PATH, ST.serialiseStats(stats));
  }
}

/* ---- the drill list ----------------------------------------------------- */
let fileCharts = [];

function loadExercises() {
  fileCharts = [];
  const manText = readFile(`${EXERCISE_DIR}/index.json`);
  if (!manText) return;
  const { entries } = IO.parseManifest(manText);
  for (const e of entries) {
    const text = readFile(`${EXERCISE_DIR}/${e.file}`);
    if (!text) continue;
    const r = IO.parseExercise(text, e.id);
    /* A drill that does not validate simply does not appear. Loading it
     * half-formed would mean being marked down for someone else's typo. */
    if (r.chart) fileCharts.push({ ...r.chart, group: e.group });
  }
}

function rebuildMenu() {
  menuItems = [];
  menuItems.push({ kind: 'progress', label: 'Progress' });
  for (const d of Q.DRILLS) {
    menuItems.push({ kind: 'quiz', label: d.name, quiz: d });
  }
  menuItems.push({ kind: 'ladder', label: 'Ladder' });
  menuItems.push({ kind: 'clock', label: 'Clock' });
  for (const c of GEN.builtins({ bpm: settings.bpm })) {
    menuItems.push({ kind: 'chart', label: c.name, chart: c });
  }
  for (const c of fileCharts) {
    menuItems.push({ kind: 'chart', label: c.name, chart: c });
  }
  if (menuSel >= menuItems.length) menuSel = 0;
}

/* ---- arming and running ------------------------------------------------- */
function armChart(c) {
  chart = { ...c, bpm: c.generated ? settings.bpm : c.bpm };
  if (c.generated) chart.loopBars = settings.loopBars;
  run = SC.createRun(chart, runOpts());
  screen = READY;
  mode = C.MODE_IDLE;
  announce(`${chart.name} ready`);
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
    looping: settings.loop,
  };
}

function start(practice) {
  run = SC.createRun(chart, runOpts());
  mode = practice ? C.MODE_PRACTICE : C.MODE_LISTEN;
  startedAt = now();
  waitedBeats = 0;
  songBeats = C.countInStart(settings.countIn);
  prevBeats = songBeats;
  screen = RUNNING;
  if (ladder) LAD.beginRung(ladder, run, 0);
  announce(practice ? 'practising' : 'listening');
}

function stop() {
  dspSet('panic', '1');
  if (mode === C.MODE_PRACTICE && run && run.hits > 0) recordRun();
  mode = C.MODE_IDLE;
  screen = ladder ? LADDER : SUMMARY;
}

function recordRun() {
  const t = timingStats(run.timing);
  stats = ST.addRecord(stats, ST.makeRecord({
    drill: ST.drillId(clockMode ? 'clock' : 'drill', chart.id, settings),
    bpm: chart.bpm,
    sd: t.sdMs,
    mean: t.meanMs,
    n: t.n,
    err: run.misses + run.stickErrors + run.dynErrors,
    at: Date.now() / 1000,
  }));
  saveStats();
}

/* ---- the clock ---------------------------------------------------------- */
function advanceClock() {
  const raw = CH.msToBeats(now() - startedAt, chart.bpm) + C.countInStart(settings.countIn);
  prevBeats = songBeats;
  if (settings.study && mode === C.MODE_PRACTICE) {
    const block = SC.blockingBeat(run, 1);
    const r = CH.applyWait(raw, waitedBeats, block);
    songBeats = r.songBeats;
    waitedBeats = r.waitedBeats;
    blocked = r.blocked;
  } else {
    songBeats = raw - waitedBeats;
    blocked = false;
  }
  beatFlash = CH.isBeatEdge(prevBeats, songBeats);
}

function clockMuted() {
  return clockMode && C.clickMuted(songBeats, settings.clockBars, CH.beatsPerBar(chart));
}

function serviceClick() {
  if (!settings.click) return;
  /* In the Clock drill the metronome drops out and you keep the time. The
   * chart's beats are still the truth, so the drift is simply the mean offset
   * over the silent stretch — nothing else has to change to measure it. */
  if (clockMuted()) return;
  const hit = C.clickAt(prevBeats, songBeats, settings.clickSubdiv, CH.beatsPerBar(chart));
  if (hit) dspSet('c', hit.downbeat ? '1' : '0');
}

/* Listen mode plays the drill so you can watch it before trying it. */
function serviceReference() {
  if (mode !== C.MODE_LISTEN) return;
  for (let i = run.cursor; i < run.entries.length; i++) {
    const e = run.entries[i];
    if (e.beat > songBeats) break;
    if (e.sounded) continue;
    e.sounded = true;
    for (const n of e.notes) {
      sound(n.voice, n.wantDyn === 'accent' ? 115 : n.wantDyn === 'ghost' ? 45 : 90);
      n.state = SC.HIT;
      n.played = true;
    }
  }
}

function serviceLadder() {
  if (!ladder || mode !== C.MODE_PRACTICE || ladder.failed) return;
  const end = LAD.rungEnd(ladder, CH.beatsPerBar(chart));
  if (songBeats < end) return;
  const verdict = LAD.judgeRung(ladder, run, songBeats);
  LAD.applyVerdict(ladder, verdict);
  ladderReason = verdict.reason;
  if (ladder.failed) {
    if (ladder.topClean > 0) {
      stats = ST.addRecord(stats, ST.makeRecord({
        drill: ST.drillId('ladder', chart.id, settings),
        bpm: ladder.topClean, sd: ladder.topSd, mean: ladder.topMean,
        n: run.hits, err: 0, at: Date.now() / 1000,
      }));
      saveStats();
    }
    stop();
    return;
  }
  /* Climb: the tempo changes, so the clock has to be rebased or the playhead
   * would jump to wherever the new tempo puts the elapsed milliseconds. */
  chart = { ...chart, bpm: ladder.bpm };
  startedAt = now() - CH.beatsToMs(songBeats, ladder.bpm);
  run.bpm = ladder.bpm;
  LAD.beginRung(ladder, run, songBeats);
}

/* ---- input -------------------------------------------------------------- */
function padDown(pad, vel) {
  held.add(pad);
  const voice = PAD.padVoice(pad, settings.layout);
  if (!voice) return;
  const hand = PAD.padHand(pad);
  sound(voice, vel || 100);

  if (screen === QUIZ && quiz) {
    if (quiz.mode !== 'pick') {
      const r = Q.pressVoice(quiz, voice, now());
      setFlash([pad], r === 'right' ? PAD.LED_HIT : PAD.LED_MISS);
      if (r === 'right' && Q.roundComplete(quiz)) finishQuiz();
    }
    return;
  }

  if (screen !== RUNNING || mode !== C.MODE_PRACTICE) return;
  const j = SC.judgeHit(run, { voice, hand, velocity: vel }, songBeats);
  SC.addMarker(run, voice, songBeats, hand);
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
  const elapsed = Q.roundElapsed(quiz, now());
  stats = ST.addRecord(stats, ST.makeRecord({
    drill: Q.quizDrillId(quiz),
    bpm: Q.ratePerMinute(quiz, now()),
    sd: 0, mean: 0, n: quiz.correct,
    err: quiz.wrong, at: Date.now() / 1000,
  }));
  saveStats();
  screen = RESULT;
  announce(`round done, ${Math.round(Q.ratePerMinute(quiz, now()))} per minute`);
  return elapsed;
}

function openSelected() {
  const item = menuItems[menuSel];
  if (!item) return;
  if (item.kind === 'progress') {
    screen = PROGRESS;
    return;
  }
  if (item.kind === 'quiz') {
    quiz = Q.createQuiz({
      kind: item.quiz.kind, mode: item.quiz.mode,
      roundSize: settings.roundSize, charts: fileCharts,
      seed: (Date.now() & 0xffff) || 1,
    });
    screen = QUIZ;
    return;
  }
  if (item.kind === 'clock') {
    /* Clock wraps whatever is armed, exactly as the Ladder does. */
    const firstChart = menuItems.find((m) => m.kind === 'chart');
    if (!chart && firstChart) armChart(firstChart.chart);
    if (!chart) return;
    clockMode = true;
    ladder = null;
    screen = READY;
    return;
  }
  if (item.kind === 'ladder') {
    /* The Ladder wraps whatever is armed; with nothing armed it takes the
     * first real drill so the entry is never a dead end. */
    const first = menuItems.find((m) => m.kind === 'chart');
    if (!chart && first) armChart(first.chart);
    if (!chart) return;
    ladder = LAD.createLadder({
      bpm: settings.bpm, step: settings.ladderStep, bars: settings.ladderBars,
    });
    ladderReason = '';
    clockMode = false;
    screen = READY;
    return;
  }
  ladder = null;
  clockMode = false;
  armChart(item.chart);
}

function back() {
  if (screen === SETTINGS && settingsEditing) { settingsEditing = false; return true; }
  if (screen === MENU) return false;
  if (screen === RUNNING) { stop(); return true; }
  screen = MENU;
  quiz = null;
  ladder = null;
  return true;
}

function closeModule() {
  dspSet('panic', '1');
  /* Note-offs on every channel, down both routes. Injected MIDI is held back
   * for a few audio frames and three more AFTER overtake ends, so exiting on
   * the same tick that queues them drops them — hence the drain below. */
  for (let chn = 0; chn < 16; chn++) {
    queue(OUT_TRACK | OUT_USB, 0xB0 | chn, 120, 0);
    queue(OUT_TRACK | OUT_USB, 0xB0 | chn, 123, 0);
  }
  serviceOutbox(true);
  darkenPads();
  setButtonLED(C.CC_PLAY, 0);
  setButtonLED(C.CC_RECORD, 0);
  flushFiles(true);
  if (typeof host_exit_module === 'function') host_exit_module();
}

/* ---- drawing ------------------------------------------------------------ */
function draw() {
  if (screen === MENU) {
    V.drawList(ctx, { title: 'DRUMS', items: menuItems.map((m) => m.label), selected: menuSel });
    return;
  }
  if (screen === SETTINGS) {
    V.drawList(ctx, {
      title: settingsEditing ? 'SET *' : 'SETTINGS',
      items: SET.settingsRows(settings), selected: settingsSel,
    });
    return;
  }
  if (screen === PROGRESS) {
    const drills = ST.drillsWithHistory(stats);
    const id = drills[progressSel % Math.max(1, drills.length)] || '';
    const recs = ST.forDrill(stats, id);
    V.drawProgress(ctx, {
      drillLabel: ST.drillLabel(id), records: recs, summary: ST.summarise(recs),
    });
    return;
  }
  if (screen === QUIZ && quiz) {
    V.drawQuiz(ctx, {
      quiz, title: `${quiz.mode}: ${quiz.kind}`, progress: Q.roundProgress(quiz),
      labelFor: (id) => Q.labelFor(quiz, id),
      isEliminated: (i) => Q.isEliminated(quiz, i),
      hintsLeft: Q.hintsLeft(quiz),
    });
    return;
  }
  if (screen === RESULT && quiz) {
    V.drawResult(ctx, {
      rate: Q.ratePerMinute(quiz, now()),
      best: ST.summarise(ST.forDrill(stats, Q.quizDrillId(quiz))).best,
      errorRate: Q.errorFraction(quiz), hints: quiz.hintsTaken,
      series: ST.forDrill(stats, Q.quizDrillId(quiz)),
    });
    return;
  }
  if (screen === LADDER && ladder) {
    V.drawLadder(ctx, { ladder, reason: ladderReason, barsDone: ladder.bars });
    return;
  }
  if (screen === SUMMARY && run) {
    V.drawSummary(ctx, { run, tightMs: SC.WINDOWS[settings.strictness].perfectMs });
    return;
  }
  if (screen === READY && chart) {
    const warn = IO.playabilityWarnings(chart)[0] || '';
    V.drawReady(ctx, {
      chart, bpm: chart.bpm, looping: settings.loop, loopBars: chart.loopBars,
      title: 'READY', songBeats: 0, warning: warn, run,
      outLabel: SET.rowFor('midiOut').format(settings.midiOut),
    });
    return;
  }
  if (screen === RUNNING && run) {
    V.drawReadingView(ctx, {
      run, chart, songBeats, pxPerBeat: settings.pxPerBeat, view: settings.view,
      title: chart.name, bpm: chart.bpm, looping: settings.loop,
      dynamics: settings.dynamics, beatFlash, timing: run.timing,
    });
    if (clockMode) {
      const perBar = CH.beatsPerBar(chart);
      const from = C.silenceStart(songBeats, settings.clockBars, perBar);
      const muted = from !== null;
      V.drawClockBanner(ctx, {
        muted,
        drift: muted ? statsSince(run.timing, from).meanMs : 0,
        barsLeft: muted ? 0
          : Math.max(0, settings.clockBars - Math.floor((songBeats % (settings.clockBars * perBar)) / perBar)),
      });
    }
    const digit = C.countInDigit(songBeats, settings.countIn);
    if (digit > 0) V.drawCountIn(ctx, digit);
  }
}

/* ---- lifecycle ---------------------------------------------------------- */
globalThis.init = function init() {
  const loaded = SET.loadSettings(readFile(SETTINGS_PATH));
  settings = loaded.settings;
  if (loaded.changed) saveSettings();
  stats = ST.parseStats(readFile(STATS_PATH));
  loadExercises();
  rebuildMenu();
  invalidateLedCache();
  darkenPads();
  dspSet('gain', '0.45');
  screen = MENU;
  announce('Drums Practice');
};

globalThis.tick = function tick() {
  if (globalThis.overtakeParked) return;
  const t = now();

  if (screen === RUNNING && run && chart) {
    advanceClock();
    serviceClick();
    serviceReference();
    if (mode === C.MODE_PRACTICE) {
      SC.ensureEntries(run, songBeats + 8);
      SC.expireMissed(run, songBeats, settings.study);
      serviceLadder();
    }
    SC.pruneEntries(run, CH.xToBeat(L.DESPAWN_X, songBeats, settings.pxPerBeat) - 1);
    V.pruneMarkers(run, CH.xToBeat(L.DESPAWN_X, songBeats, settings.pxPerBeat));
    if (SC.runFinished(run, songBeats, blocked)) stop();
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
  }
  flushFiles(false);
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data || data.length < 3) return;
  const status = data[1] === undefined ? data[0] : data[1];
  const d1 = data[2];
  const d2 = data[3];
  const type = status & 0xF0;

  if (type === 0x90 || type === 0x80) {
    /* Notes below 10 are capacitive KNOB TOUCH, not pads. Every module that
     * forgets this gets phantom hits the moment a finger rests on a knob. */
    if (d1 <= C.KNOB_TOUCH_MAX) return;
    if (!PAD.isPad(d1)) return;
    if (type === 0x90 && d2 > 0) padDown(d1, d2);
    else padUp(d1);
    return;
  }
  if (type !== 0xB0) return;

  switch (d1) {
    case C.CC_JOG_TURN: {
      const delta = decodeDelta(d2);
      if (!delta) return;
      jog(delta);
      return;
    }
    case C.CC_JOG_CLICK:
      if (d2 > 0) click();
      return;
    case C.CC_MENU:
      if (d2 > 0) { screen = MENU; rebuildMenu(); }
      return;
    case C.CC_BACK:
      if (d2 > 0 && !back()) closeModule();
      return;
    case C.CC_PLAY:
      if (d2 > 0 && screen === READY) start(false);
      else if (d2 > 0 && screen === RUNNING) stop();
      return;
    case C.CC_RECORD:
      if (d2 <= 0) return;
      if (screen === QUIZ && quiz) { Q.takeHint(quiz); return; }
      if (screen === READY) start(true);
      else if (screen === RUNNING) stop();
      return;
    default:
      break;
  }

  if (d1 >= C.CC_KNOB1 && d1 < C.CC_KNOB1 + C.KNOB_COUNT) {
    const k = d1 - C.CC_KNOB1;
    if (k >= SET.KNOB_ROWS.length) return;
    const delta = decodeDelta(d2);
    if (!delta) return;
    editSetting(SET.ROWS[SET.KNOB_ROWS[k]].key, delta);
  }
};

function jog(delta) {
  const target = C.jogTarget(screen, settingsEditing);
  if (target === 'menu') {
    menuSel = Math.max(0, Math.min(menuItems.length - 1, menuSel + delta));
  } else if (target === 'row') {
    settingsSel = Math.max(0, Math.min(SET.ROWS.length - 1, settingsSel + delta));
  } else if (target === 'value') {
    editSetting(SET.ROWS[settingsSel].key, delta);
  } else if (target === 'choice' && quiz) {
    Q.moveChoice(quiz, delta);
  } else if (target === 'drill') {
    const n = Math.max(1, ST.drillsWithHistory(stats).length);
    progressSel = (((progressSel + delta) % n) + n) % n;
  }
}

function click() {
  if (screen === MENU) { openSelected(); return; }
  if (screen === SETTINGS) { settingsEditing = !settingsEditing; return; }
  if (screen === QUIZ && quiz && quiz.mode === 'pick') {
    const r = Q.pickChoice(quiz, now());
    if (r === 'right') {
      if (Q.roundComplete(quiz)) finishQuiz();
      else Q.advance(quiz);
    }
    return;
  }
  if (screen === RESULT) { screen = MENU; quiz = null; return; }
  if (screen === SUMMARY || screen === LADDER) { screen = chart ? READY : MENU; return; }
}

/*
 * Changing tempo, loop length or the kit rebuilds the armed drill straight
 * away, so what is on screen is always what has been dialled in. A
 * hand-written drill keeps its own tempo — it is fixed material, not a recipe
 * to re-run at another speed.
 */
function editSetting(key, delta) {
  SET.applySetting(settings, key, delta);
  saveSettings();
  if (SET.affectsChart(key) && chart && screen !== RUNNING) {
    const src = menuItems[menuSel];
    if (src && src.kind === 'chart') armChart(src.chart);
  }
}

globalThis.onMidiMessageExternal = function onMidiMessageExternal(_data) {};

globalThis.onResume = function onResume() {
  invalidateLedCache();
  for (let i = 0; i < PAD.PAD_COUNT; i++) ledPrev[i] = -1;
};

globalThis.onUnload = function onUnload() {
  closeModule();
};
