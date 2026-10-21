// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Execute ui.js itself.
 *
 * It is the one file that cannot be imported under `node` — it reaches for
 * host globals and for `/data/UserData/schwung/shared/...` — so it is loaded
 * with those stubbed and then DRIVEN: init, a few hundred ticks, pads, knobs,
 * every screen. Everything it does lands in a log that can be asserted on.
 *
 * This catches the class of bug that unit tests structurally cannot: a typo
 * in a host call, a screen that throws on entry, a lifecycle hook that is not
 * a function. On the device those fail by the module silently not loading,
 * because shadow_ui's stderr goes to /dev/null.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScreen, countOn } from '../tools/screen_buffer.mjs';
import { DRILLS } from '../src/guess.mjs';

const SHARED = '/data/UserData/schwung/shared/';

const STAGED_UI = join(mkdtempSync(join(tmpdir(), 'drums-ui-')), 'ui.js');
let uiLoads = 0;

async function loadUi({ extraFiles = {}, settings = null, dataFiles = {} } = {}) {
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  const log = { leds: [], buttons: [], params: [], midi: [], writes: {}, announces: [], exited: 0 };
  const screen = createScreen();
  /* A CONTROLLED clock. Driven in real time, `performance.now()` barely moves
   * between calls and the 20ms draw throttle almost never fires — which is
   * how the whole draw path once shipped unexercised. */
  let clock = 0;
  globalThis.performance = { now: () => clock };
  globalThis.__advance = (ms) => { clock += ms; };

  /* The shared host modules, as data URLs — the same shape ui.js imports. */
  const inputFilter = `data:text/javascript,${encodeURIComponent(`
    export const setLED = (n, c) => globalThis.__log.leds.push([n, c]);
    export const setButtonLED = (cc, c) => globalThis.__log.buttons.push([cc, c]);
    export const invalidateLedCache = () => {};
    export const decodeDelta = (v) => (v === 0 ? 0 : v < 64 ? v : v - 128);
  `)}`;
  const screenReader = `data:text/javascript,${encodeURIComponent(`
    export const announce = (s) => globalThis.__log.announces.push(s);
  `)}`;

  const files = {};
  const exDir = new URL('../src/exercises/', import.meta.url);
  for (const f of readdirSync(exDir)) {
    files[`/data/UserData/schwung/modules/tools/drums-practice/exercises/${f}`] =
      readFileSync(new URL(f, exDir), 'utf8');
  }
  for (const [name, text] of Object.entries(extraFiles)) {
    files[`/data/UserData/schwung/modules/tools/drums-practice/exercises/${name}`] = text;
  }
  if (settings) {
    files['/data/UserData/schwung/modules/tools/drums-practice/settings.json'] =
      JSON.stringify({ version: 2, ...settings });
  }
  /* The module's own data — progress.json, stats.json — as left by a session. */
  for (const [name, text] of Object.entries(dataFiles)) {
    files[`/data/UserData/schwung/modules/tools/drums-practice/${name}`] = text;
  }

  Object.assign(globalThis, {
    __log: log,
    clear_screen: () => screen.clear(),
    fill_rect: (x, y, w, h, v) => screen.fillRect(x, y, w, h, v),
    draw_rect: (x, y, w, h, v) => screen.drawRect(x, y, w, h, v),
    draw_line: (a, b, c, d, v) => screen.line(a, b, c, d, v),
    print: (x, y, s, v) => screen.text(x, y, s, v),
    text_width: (s) => screen.textWidth(s),
    host_read_file: (p) => files[p] ?? null,
    host_write_file: (p, t) => { log.writes[p] = t; return true; },
    host_module_set_param: (k, v) => log.params.push([k, v]),
    move_midi_inject_to_move: (p) => log.midi.push(['track', ...p]),
    move_midi_external_send: (p) => log.midi.push(['usb', ...p]),
    host_exit_module: () => { log.exited++; },
  });

  const rewritten = src
    .replace(`'${SHARED}input_filter.mjs'`, `'${inputFilter}'`)
    .replace(`'${SHARED}screen_reader.mjs'`, `'${screenReader}'`)
    .replace(/from '\.\/([a-z_]+)\.mjs'/g,
      (_m, n) => `from '${new URL(`../src/${n}.mjs`, import.meta.url).href}'`);

  /*
   * Staged as a FILE, not a data: URL, so coverage can see it: from a data:
   * URL the largest and riskiest file in the module was simply missing from
   * the report. ui.js keeps module-level state — the current screen, the menu
   * selection, the armed drill — so each load gets its own instance through a
   * query string, or every test would inherit what the last one left behind.
   */
  writeFileSync(STAGED_UI, rewritten);
  await import(`${pathToFileURL(STAGED_UI).href}?n=${++uiLoads}`);
  return { log, screen };
}

const CC = { jogTurn: 14, jogClick: 3, menu: 50, back: 51, play: 85, record: 86,
             knob1: 71, shift: 49 };
/*
 * Getting about the tree. Rows are found by facts that hold whatever is
 * bundled: Grooves is the third row (after Basics and the Learning Path) and
 * Rock & Pop its first family, and the jog clamps, so the end of the top list
 * is Progress with Quiz just above it.
 */
/* Grooves › Rock & Pop, highlight on its first groove (Rock backbeat). */
const toFirstDrill = () => { cc(CC.jogTurn, 2); cc(CC.jogClick, 127); cc(CC.jogClick, 127); };
/* Into its ladder, highlight on L1 — the first TIMED rung. L0 above it is the
 * untimed one, and has flows of its own. */
const toFirstRung = () => { toFirstDrill(); cc(CC.jogClick, 127); cc(CC.jogTurn, 1); };
/* Into the Quiz folder, highlight on its first drill. */
const toQuizzes = () => {
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1);
  cc(CC.jogTurn, 127);
  cc(CC.jogClick, 127);
};
const cc = (n, v) => globalThis.onMidiMessageInternal([0xb0, n, v]);
const pad = (n, v) => globalThis.onMidiMessageInternal([v > 0 ? 0x90 : 0x80, n, v]);
/* A write that strikes a drum. The `n` list also carries the tick's click
 * (`c:1`/`c:0`) and panic (`x`), which are not hits. */
const isHit = ([k, v]) => k === 'n' && /(^|,)\d+:\d+(,|$)/.test(v);
/* A panic: in the stroke list as `x`, or the direct write closing still uses. */
const isPanic = ([k, v]) => (k === 'n' && /(^|,)x(,|$)/.test(v)) || (k === 'panic' && v === '1');
/* 25ms a tick, so every tick also draws. */
const ticks = (n) => { for (let i = 0; i < n; i++) { globalThis.__advance(25); globalThis.tick(); } };

test('ui.js loads and declares every lifecycle hook', async () => {
  const { log } = await loadUi();
  for (const hook of ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal',
                      'onResume', 'onUnload']) {
    assert.equal(typeof globalThis[hook], 'function', `${hook} is missing`);
  }
  globalThis.init();
  assert.ok(log.announces.length > 0, 'init said nothing to the screen reader');
  assert.ok(log.leds.length > 0, 'init lit no pads');
});

test('input actually DOES something — the screen responds to the jog', async () => {
  /*
   * The test that would have caught the shipped bug. Every other test here
   * asserted that pressing things did not THROW; none asserted that pressing
   * things had an EFFECT. With the MIDI decoder misreading its input, the
   * module drew its menu once and then ignored every press — and the whole
   * suite stayed green, because the helpers sent the same wrong shape the
   * code expected.
   *
   * So: capture what is drawn, press something, and require the screen to
   * have changed.
   */
  const { screen } = await loadUi();
  globalThis.init();
  ticks(3);

  /* Compare the SCREEN, not the text: moving the menu highlight changes which
   * row is inverted, and a row's characters can be identical either way. */
  const before = screen.pixels.slice();
  assert.ok(before.some((p) => p), 'nothing was drawn at all');

  for (let i = 0; i < 4; i++) cc(CC.jogTurn, 1);
  ticks(3);
  const after = screen.pixels.slice();

  assert.ok(after.some((p, i) => p !== before[i]),
    'the jog changed nothing on screen — the module is deaf to input');
});

test('a pad press reaches the engine as a hit', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  const before = log.params.length;
  pad(80, 100);
  globalThis.tick();
  const hits = log.params.slice(before).filter(isHit);
  assert.equal(hits.length, 1, 'the pad never reached the engine');
  assert.match(hits[0][1], /^\d+:100$/, `unexpected payload: ${hits[0][1]}`);
});

test('a full session runs without throwing', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(5);

  /* Down the menu into a drill, practise it, stop, back out. */
  for (let i = 0; i < 8; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(5);
  cc(CC.record, 127);
  ticks(40);
  pad(80, 110); ticks(2); pad(80, 0);
  pad(68, 40);  ticks(2); pad(68, 0);
  ticks(40);
  cc(CC.record, 127);
  ticks(5);
  cc(CC.back, 127);
  ticks(5);

  assert.ok(log.params.some(isHit), 'no hits ever reached the engine');
  assert.ok(log.exited === 0, 'the module exited early');
});

test('a hit is batched into ONE parameter write, not one per drum', async () => {
  /* The overtake parameter channel is a single-slot mailbox: two calls in a
   * frame would have the second overwrite the first and only one drum would
   * sound. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  cc(CC.record, 127);
  ticks(20);
  const before = log.params.length;
  pad(80, 100);
  pad(81, 100);
  pad(68, 100);
  globalThis.tick();
  const writes = log.params.slice(before).filter(isHit);
  assert.equal(writes.length, 1, 'three pads in one frame must be one write');
  assert.ok(writes[0][1].split(',').length >= 2, 'the write lost hits');
});

test('the click shares the tick\'s one write with the hits', async () => {
  /* A stroke on the beat used to send 'c' and then 'n' in the same tick, and
   * the single-slot mailbox kept only one of them. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  let both = 0;
  for (let i = 0; i < 400; i++) {
    const before = log.params.length;
    pad(80, 100);
    globalThis.__advance(16);
    globalThis.tick();
    pad(80, 0);
    const wrote = log.params.slice(before).filter(([k]) => k !== 'vm');
    assert.ok(wrote.length <= 1, `tick ${i} wrote ${JSON.stringify(wrote)}`);
    if (wrote.length && /(^|,)c:[01](,|$)/.test(wrote[0][1]) && /(^|,)\d+:100(,|$)/.test(wrote[0][1])) both++;
  }
  assert.ok(!log.params.some(([k]) => k === 'c'), 'a separate click write');
  assert.ok(both > 0, 'no tick carried a hit and the click together');
});

test('knob touch is not a pad', async () => {
  /* Notes below 10 are capacitive knob touch. A module that treats them as
   * pads gets phantom hits the moment a finger rests on a knob. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  const before = log.params.length;
  for (let n = 0; n <= 9; n++) { pad(n, 100); pad(n, 0); }
  globalThis.tick();
  assert.equal(log.params.slice(before).filter(isHit).length, 0);
});

test('every screen draws without throwing', async () => {
  const { log } = await loadUi();
  globalThis.init();
  /* Walk the whole menu, opening and backing out of each entry in turn. */
  for (let i = 0; i < 24; i++) {
    cc(CC.menu, 127);
    ticks(2);
    for (let j = 0; j < i; j++) cc(CC.jogTurn, 1);
    cc(CC.jogClick, 127);
    ticks(6);
    cc(CC.record, 127);
    ticks(10);
    cc(CC.jogClick, 127);
    ticks(4);
    cc(CC.back, 127);
    ticks(2);
  }
  assert.ok(log.announces.length > 0);
});

test('settings persist, and are written lazily rather than every frame', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  /* Knobs change settings only on the Settings screen: open it, then knob 1
   * is its first row, Tempo. */
  cc(CC.shift, 127);
  cc(CC.jogClick, 127);
  cc(CC.shift, 0);
  cc(CC.knob1, 1);
  cc(CC.knob1, 1);
  ticks(3);
  const path = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
  assert.equal(log.writes[path], undefined, 'an eMMC write landed in the frame path');
  globalThis.onUnload();
  assert.ok(log.writes[path], 'settings were never written');
  assert.equal(JSON.parse(log.writes[path]).bpm, 92, 'the knob did not move the tempo');
});

test('a host unload silences the engine and darkens the pads, synchronously', async () => {
  /* There are no more ticks coming when the host tears us down, so this path
   * cannot defer anything — and it must not call host_exit_module, because we
   * are already being unloaded. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  const before = log.leds.length;
  globalThis.onUnload();
  assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'), 'the kit was left ringing');
  const after = log.leds.slice(before);
  assert.ok(after.length >= 32, 'the pads were left lit');
  assert.ok(after.every(([, c]) => c === 0), 'a pad was left on');
  assert.equal(log.exited || 0, 0, 'it asked the host to exit while the host was exiting it');

});

test('back walks out one level at a time and then closes', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  for (let i = 0; i < 18; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(3);
  cc(CC.back, 127);            /* drill -> menu */
  ticks(2);
  assert.equal(log.exited, 0, 'the first back should not have closed the module');
  cc(CC.back, 127);            /* menu -> out   */
  ticks(20);                   /* the exit drains the queue before it goes */
  assert.equal(log.exited, 1);
});

test('a practice ENDS BY ITSELF and shows the summary — no second press', async () => {
  /*
   * The regression test for the reported bug: "the practice never ends."
   * A drill looped until the player interrupted it, so it never finished,
   * never showed a summary and never recorded a score. Start it and do
   * nothing; it has to arrive at RESULT on its own.
   */
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);

  /* Past the ear training to the rock beat, which opens its LADDER; the first
   * timed rung is the hi-hat alone. */
  toFirstRung();
  ticks(3);
  cc(CC.jogClick, 127);
  ticks(3);
  cc(CC.record, 127);

  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s2, v) => { drawn.push(s2); orig(x, y, s2, v); };
  /* A generous wall-clock run: 8 bars at 84bpm is about 23 seconds, and each
   * tick is 25ms. */
  ticks(1600);
  globalThis.print = orig;

  assert.ok(drawn.some((t) => /RESULT|REC again/.test(t)),
    `the practice never finished on its own: ${[...new Set(drawn)].slice(0, 12).join('|')}`);
});

test('a finished practice records a score without being asked', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  toFirstRung();
  ticks(3);
  cc(CC.jogClick, 127);
  ticks(3);
  cc(CC.record, 127);
  /*
   * Play along on a HI-HAT pad — the first drill is hi-hats only, and hitting
   * a snare would be a stray every time and score nothing. In Ableton's Drum
   * Rack order the closed hat is GM 42, which is pad 78: second row up, third
   * column, directly above the snare. Eighths at 84bpm are ~357ms, which is
   * 14 ticks of 25ms.
   */
  for (let i = 0; i < 1600; i++) {
    globalThis.__advance(25);
    if (i % 14 === 0) { pad(78, 100); pad(78, 0); }
    globalThis.tick();
  }
  globalThis.onUnload();
  const stats = log.writes['/data/UserData/schwung/modules/tools/drums-practice/stats.json'];
  assert.ok(stats, 'nothing was written');
  const parsed = JSON.parse(stats);
  assert.ok(parsed.records.length >= 1, 'a finished practice recorded no score');
});

test('the list opens on Basics, with the material ahead of the practice tools', async () => {
  await loadUi();
  globalThis.init();
  ticks(3);
  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s2, v) => { drawn.push(s2); orig(x, y, s2, v); };
  ticks(2);
  globalThis.print = orig;
  for (const row of ['Basics', 'Grooves', 'Rudiments']) {
    assert.ok(drawn.includes(row), `the top list does not show ${row}: ${drawn.join('|')}`);
  }
});

test('Back walks up one folder at a time, and leaves only from the top', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();                            /* two folders deep */
  cc(CC.back, 127); ticks(1);
  cc(CC.back, 127); ticks(1);
  assert.equal(log.exited, 0, 'Back left from inside a folder');
  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s2, v) => { drawn.push(s2); orig(x, y, s2, v); };
  ticks(2);
  globalThis.print = orig;
  assert.ok(drawn.includes('DRUMS'), `not back at the top: ${drawn.join('|')}`);
});

test('the Ladder with nothing armed asks for a drill instead of picking one', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1);
  cc(CC.jogTurn, 127); cc(CC.jogTurn, 127);  /* Training */
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);                      /* Ladder */
  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s2, v) => { drawn.push(s2); orig(x, y, s2, v); };
  ticks(2);
  globalThis.print = orig;
  assert.ok(drawn.includes('ARM A DRILL'), drawn.join('|'));
});

/* ---- the transport ------------------------------------------------------ */
/*
 * Driven end to end against the real module with a clock the test owns —
 * play, pause, hold, scrub, resume — because each step is easy to get right
 * on its own and still have the sequence drift.
 */

/* Open the first drill's first rung and start practising it. */
function startFirstDrill() {
  toFirstRung();
  ticks(2);
  cc(CC.jogClick, 127);          /* the first rung of its ladder */
  ticks(2);
  cc(CC.record, 127);
  ticks(2);
}

function drawnText(ticksToRun = 2) {
  const out = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s, v) => { out.push(s); orig(x, y, s, v); };
  ticks(ticksToRun);
  globalThis.print = orig;
  return out;
}

test('the running mode\'s own button pauses and HOLDS the playhead', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(200);                       /* five seconds in */

  const moving = screen.pixels.slice();
  cc(CC.record, 127);               /* pause: practice's own button */
  ticks(4);
  const held = screen.pixels.slice();
  ticks(200);                       /* five more seconds of wall time */
  const stillHeld = screen.pixels.slice();

  assert.ok(held.some((p, i) => p !== moving[i]), 'pausing changed nothing on screen');
  assert.deepEqual(stillHeld, held, 'the playhead moved while paused');
  assert.ok(drawnText().some((t) => /PAUSED/.test(t)), 'the screen does not say PAUSED');
});

test('resuming carries on in tempo rather than lurching to wall time', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(80);
  cc(CC.record, 127);               /* pause: practice's own button */
  const atPause = screen.pixels.slice();
  ticks(400);                       /* ten seconds of doing nothing */
  cc(CC.record, 127);               /* resume */
  ticks(2);
  const justAfter = screen.pixels.slice();

  /* One tick past the resume, the picture must look like the moment it was
   * paused at — not ten seconds further on. */
  let differing = 0;
  for (let i = 0; i < atPause.length; i++) if (atPause[i] !== justAfter[i]) differing++;
  assert.ok(differing < 260, `${differing} pixels changed — the clock lurched forward`);
  ticks(60);
  assert.ok(screen.pixels.some((p, i) => p !== justAfter[i]), 'it never restarted');
});

test('the OTHER button switches listen and practice in place, without pausing', async () => {
  /* Watch a bar, then play it: the playhead does not go back to the top, and
   * the music does not stop to make the switch. */
  const { log, screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(200);                       /* practising, five seconds in */
  cc(CC.play, 127);                 /* switch to listening */
  log.params.length = 0;
  const atSwitch = screen.pixels.slice();
  ticks(80);
  assert.ok(screen.pixels.some((p, i) => p !== atSwitch[i]), 'the switch stopped the music');
  assert.ok(log.params.some(isHit), 'listening played nothing after the switch');
  assert.ok(!drawnText().some((t) => /PAUSED/.test(t)), 'switching paused instead');
  cc(CC.record, 127);               /* and back to practising */
  ticks(40);
  assert.ok(!drawnText().some((t) => /PAUSED/.test(t)));
});

test('the knob scrubs while paused, and only while paused', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(120);

  /* Running: the knob is a setting, not a scrub. */
  const before = screen.pixels.slice();
  for (let i = 0; i < 20; i++) cc(CC.knob1, 1);
  ticks(2);

  cc(CC.record, 127);               /* pause: practice's own button */
  ticks(4);
  const atPause = screen.pixels.slice();
  /* A scrub banks raw units and emits a bar every twelfth. */
  for (let i = 0; i < 30; i++) cc(CC.knob1, 1);
  ticks(4);
  assert.ok(screen.pixels.some((p, i) => p !== atPause[i]),
    'scrubbing while paused moved nothing');
  assert.ok(drawnText().some((t) => /PAUSED/.test(t)), 'the scrub resumed the drill');
});

test('Back restarts, and Back twice leaves without a gesture of its own', async () => {
  const { log, screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(200);

  cc(CC.back, 127);                 /* running -> ready */
  ticks(4);
  /* The ready screen IS the chart now, with the control box over it — so the
   * proof it restarted is the box being back, which only happens at the top. */
  assert.ok(drawnText().some((t) => /SCRUB/.test(t)), 'Back did not restart the drill');
  assert.equal(log.exited || 0, 0);

  cc(CC.back, 127);                 /* ready -> the folder it came from */
  ticks(4);
  /* The groove's own ladder: having just played one rung, the next thing you
   * want is the next rung, one step away rather than back at the top. */
  assert.ok(drawnText().some((t) => /ROCK BACKBEAT/.test(t)), 'Back did not land on the ladder');
  assert.equal(log.exited || 0, 0, 'it left the module instead of going to the list');
});

test('pausing silences the engine', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(60);
  const before = log.params.filter(isPanic).length;
  cc(CC.play, 127);
  ticks(2);
  assert.ok(log.params.filter(isPanic).length > before,
    'the kit was left ringing through the pause');
});

/*
 * The engine reads one parameter a tick and the strokes go last, so a panic
 * written on its own was lost whenever a stroke was queued in the same tick.
 * It rides in the stroke list now, as `x`, in order.
 */
test('a pause in the same tick as a stroke still silences, and a stroke after it still plays', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(60);
  let before = log.params.length;
  pad(78, 100); pad(78, 0);                       /* a hat, queued ... */
  cc(CC.record, 127);                             /* ... then pause, same tick */
  ticks(1);
  let writes = log.params.slice(before).filter(([k]) => k === 'n');
  assert.deepEqual(writes.map(([, v]) => v), ['x'], 'one write: the cut, the stroke before it dropped');
  assert.equal(log.params.slice(before).filter(([k]) => k === 'panic').length, 0, 'no separate panic to lose');

  cc(CC.record, 127);                             /* resume */
  ticks(1);
  before = log.params.length;
  cc(CC.back, 127);                               /* restart: a panic ... */
  pad(78, 100); pad(78, 0);                       /* ... then a hat, same tick */
  ticks(1);
  writes = log.params.slice(before).filter(([k]) => k === 'n');
  assert.equal(writes.length, 1);
  assert.match(writes[0][1], /^x,\d+:100$/, 'the cut first, then the hat');
});

test('the panel keeps repainting while paused', async () => {
  /*
   * The bug this nearly shipped with in the pitched module: gating the whole
   * running block on !paused stops the draw as well, so a scrub moves the
   * playhead and changes nothing on screen.
   */
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(60);
  cc(CC.play, 127);
  ticks(2);
  screen.clear();
  ticks(3);
  assert.ok(screen.pixels.some((p) => p), 'nothing was drawn while paused');
});

test('in Settings the knobs follow the rows ON SCREEN, not fixed numbers', async () => {
  /*
   * So the mapping survives scrolling, and a knob can never point at a row
   * you cannot see.
   */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.shift, 127);
  cc(CC.jogClick, 127);             /* shift + click opens settings */
  ticks(2);
  cc(CC.shift, 0);

  /* At the top of the list, knob 1 is the first row — the tempo. */
  cc(CC.knob1, 1);
  ticks(2);
  globalThis.onUnload();
  const path = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
  assert.equal(JSON.parse(log.writes[path]).bpm, 91, 'knob 1 did not edit the first visible row');
});

test('scrolling Settings moves what the knobs address', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.shift, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  cc(CC.shift, 0);

  /* Scroll well down the list, then turn knob 1: it must edit a row that is
   * now on screen, and NOT the tempo at the top. */
  for (let i = 0; i < 12; i++) cc(CC.jogTurn, 1);
  ticks(2);
  cc(CC.knob1, 1);
  ticks(2);
  globalThis.onUnload();
  const path = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
  assert.equal(JSON.parse(log.writes[path]).bpm, 90, 'knob 1 still edited the tempo off screen');
});

test('touching a knob moves the cursor to the row it edits', async () => {
  /*
   * Knob touch arrives as notes 0-9. This module used to drop them on the
   * floor, which left the knob mapping as something you had to know.
   */
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.shift, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  cc(CC.shift, 0);
  const before = screen.pixels.slice();

  globalThis.onMidiMessageInternal([0x90, 3, 127]);   /* touch knob 4 */
  ticks(2);
  assert.ok(screen.pixels.some((p, i) => p !== before[i]),
    'touching a knob moved nothing — the mapping is still invisible');
});

test('knob touch is still never a pad hit', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  const before = log.params.length;
  for (let n = 0; n <= 9; n++) {
    globalThis.onMidiMessageInternal([0x90, n, 120]);
    globalThis.onMidiMessageInternal([0x80, n, 0]);
  }
  globalThis.tick();
  assert.equal(log.params.slice(before).filter(isHit).length, 0);
});

test('a drill listed in user.json loads alongside the shipped ones', async () => {
  /*
   * The bug this closes: the install preserved hand-written exercise FILES
   * but replaced index.json, so a drill you wrote survived an update with its
   * manifest entry gone — still on disk, never in the list again.
   */
  const { log } = await loadUi({
    extraFiles: {
      'user.json': JSON.stringify({
        exercises: [{ id: 'mine', name: 'My groove', file: 'mine.json', group: 'groove' }],
      }),
      'mine.json': JSON.stringify({
        id: 'mine', name: 'My groove', bpm: 90, timeSig: [4, 4], loopBars: 1, repeats: 4,
        events: [{ beat: 0, voices: ['KK'] }, { beat: 2, voices: ['SN'] }],
      }),
    },
  });
  globalThis.init();
  ticks(3);
  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s, v) => { drawn.push(s); orig(x, y, s, v); };
  /* A user drill with no shipped category lands in Other, after Rudiments. */
  for (let i = 0; i < 4; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(3);
  globalThis.print = orig;
  assert.ok(drawn.some((t) => /My groove/.test(t)), `user drill missing: ${drawn.join('|')}`);
});

test('a file on disk that no manifest lists does not load', async () => {
  /* Which is what stops a drill the module no longer ships being carried
   * forward for ever by the install's preserve step. */
  const { log } = await loadUi({
    extraFiles: {
      'orphan.json': JSON.stringify({
        id: 'orphan', name: 'ZZ Orphan', bpm: 90, timeSig: [4, 4], loopBars: 1, repeats: 4,
        events: [{ beat: 0, voices: ['KK'] }],
      }),
    },
  });
  globalThis.init();
  ticks(3);
  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s, v) => { drawn.push(s); orig(x, y, s, v); };
  for (let i = 0; i < 40; i++) { cc(CC.jogTurn, 1); ticks(1); }
  globalThis.print = orig;
  assert.ok(!drawn.some((t) => /Orphan/.test(t)), 'an unlisted file loaded');
});

/* ---- the ready screen you can start from -------------------------------- */

test('the knob scrubs on READY, and the box gets out of the way', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);          /* a level, so READY is armed */

  assert.ok(drawnText().some((t) => /SCRUB/.test(t)), 'the control box is not on screen');
  const atHome = screen.pixels.slice();

  /* 36 clicks to the bar; a bar's worth should move the chart. */
  for (let i = 0; i < 40; i++) cc(CC.knob1, 1);
  ticks(3);
  assert.ok(screen.pixels.some((p, i) => p !== atHome[i]), 'the knob is dead on READY');
  assert.ok(!drawnText().some((t) => /SCRUB/.test(t)),
    'the box stayed up over the music being scrubbed through');
});

test('the box comes back when you scroll home, which is how you find it', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 40; i++) cc(CC.knob1, 1);
  ticks(2);
  assert.ok(!drawnText().some((t) => /SCRUB/.test(t)));
  for (let i = 0; i < 80; i++) cc(CC.knob1, 127);   /* 127 decodes as -1 */
  ticks(2);
  assert.ok(drawnText().some((t) => /SCRUB/.test(t)), 'the box never came back');
});

test('Play from a scrubbed position starts THERE, not at the top', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 72; i++) cc(CC.knob1, 1);     /* two bars */
  ticks(2);
  const scrubbed = screen.pixels.slice();
  cc(CC.play, 127);                                 /* listen from here */
  ticks(2);
  /* One tick in, the picture must still be the bar we chose — not the top,
   * and not a count-in. */
  let differing = 0;
  for (let i = 0; i < scrubbed.length; i++) if (scrubbed[i] !== screen.pixels[i]) differing++;
  assert.ok(differing < 420, `${differing} pixels changed — it restarted from the top`);
});

test('the bars behind a start point are settled, not counted as misses', async () => {
  /* Otherwise picking bar 5 would open with four bars of misses against you. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 72; i++) cc(CC.knob1, 1);
  ticks(2);
  cc(CC.record, 127);                               /* practise from bar 3 */
  ticks(20);
  /* If the skipped bars had been scored, the summary would already be full of
   * them; the run must still be clean. */
  assert.ok(!drawnText().some((t) => /RESULT|REC again/.test(t)), 'it ended immediately');
});

test('no count-in when starting mid-drill, but there is one from the top', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);

  /* From the top: the count-in digit is drawn. */
  cc(CC.record, 127);
  ticks(2);
  const fromTop = screen.pixels.slice();
  cc(CC.back, 127);                                  /* restart */
  ticks(3);

  /* From a scrub: straight in. */
  for (let i = 0; i < 72; i++) cc(CC.knob1, 1);
  ticks(2);
  cc(CC.record, 127);
  ticks(2);
  assert.ok(screen.pixels.some((p, i) => p !== fromTop[i]),
    'starting mid-drill looked the same as starting from the top');
});

test('the module closes from EVERY screen, and silences everything on the way', async () => {
  /*
   * Shift+Back is the one gesture that must work wherever you are. Each of
   * these leaves the module in a different state, and none of them may trap
   * you or leave a note sounding on a track.
   */
  const routes = {
    menu: () => {},
    levels: () => { toFirstRung(); ticks(2); },
    ready: () => { toFirstRung(); ticks(2); cc(CC.jogClick, 127); ticks(2); },
    running: () => { startFirstDrill(); ticks(10); },
    paused: () => { startFirstDrill(); ticks(10); cc(CC.play, 127); ticks(2); },
    settings: () => { cc(CC.shift, 127); cc(CC.jogClick, 127); ticks(2); cc(CC.shift, 0); },
    progress: () => { for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1); cc(CC.jogClick, 127); ticks(2); },
    quiz: () => { toQuizzes(); cc(CC.jogClick, 127); ticks(2); },
  };
  for (const [name, go] of Object.entries(routes)) {
    const { log } = await loadUi();
    globalThis.init();
    ticks(2);
    go();
    cc(CC.shift, 127);
    cc(CC.back, 127);
    cc(CC.shift, 0);
    ticks(30);
    assert.equal(log.exited, 1, `${name}: shift+Back did not close the module`);
    assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'), `${name}: kit left ringing`);
    /* With the built-in kit nothing was ever sent over MIDI, so nothing is
     * swept there: sweeping unused routes cut Move's own notes. The stub
     * logs ['track'|'usb', cable, status, d1, d2], so the CC number is d1. */
    const offs = log.midi.filter((m) => m[3] === 120 || m[3] === 123).length;
    assert.equal(offs, 0, `${name}: ${offs} CCs swept down routes never used`);
    const lastLeds = log.leds.slice(-32);
    assert.ok(lastLeds.every(([, c]) => c === 0), `${name}: pads left lit`);
  }
});

test('after notes went to a Move track, exit sweeps every channel there, and only there', async () => {
  const { log } = await loadUi({ settings: { midiOut: 1 } });
  globalThis.init();
  ticks(3);
  globalThis.onMidiMessageInternal([0x90, 68, 100]);   /* a pad: a note to the track */
  globalThis.onMidiMessageInternal([0x80, 68, 0]);
  ticks(5);
  log.midi.length = 0;
  cc(CC.shift, 127);
  cc(CC.back, 127);
  cc(CC.shift, 0);
  ticks(40);
  const offs = log.midi.filter((m) => m[3] === 120 || m[3] === 123);
  assert.equal(offs.length, 32, 'all sixteen channels, both CCs');
  assert.ok(offs.every((m) => m[0] === 'track'), 'and nothing to USB, which was never used');
});

test('the exit paces its note-offs rather than flooding the ring', async () => {
  /* The inject ring holds ~64 packets and drains 31 per audio block; dumping
   * the whole sweep at once is how the offs get dropped. */
  /* Both routes in use, so the sweep is at its largest. */
  const { log } = await loadUi({ settings: { midiOut: 3 } });
  globalThis.init();
  ticks(2);
  globalThis.onMidiMessageInternal([0x90, 68, 100]);
  globalThis.onMidiMessageInternal([0x80, 68, 0]);
  ticks(4);
  const start = log.midi.length;
  cc(CC.shift, 127); cc(CC.back, 127); cc(CC.shift, 0);
  let worst = 0;
  for (let i = 0; i < 30; i++) {
    const before = log.midi.length;
    ticks(1);
    worst = Math.max(worst, log.midi.length - before);
  }
  assert.ok(log.midi.length - start >= 64, 'the sweep went out: 16 channels, 2 CCs, 2 routes');
  assert.ok(worst <= 16, `${worst} packets in one tick is a flood`);
  assert.equal(log.exited, 1);
});

test('once it has gone it stays gone — the pads do not light again', async () => {
  /*
   * The host does not necessarily stop calling tick() the instant
   * host_exit_module returns. Without a latch the very next tick repaints the
   * grid, so the pads come back up behind a module that has closed.
   */
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  cc(CC.shift, 127); cc(CC.back, 127); cc(CC.shift, 0);
  ticks(20);
  assert.equal(log.exited, 1);
  const after = log.leds.length;
  ticks(200);
  assert.equal(log.leds.length, after, 'the pads were repainted after closing');
  assert.equal(log.exited, 1, 'it asked the host to exit more than once');
});

test('72 clicks lands EXACTLY on two bars, with no accumulated drift', async () => {
  /*
   * Counting in beats accumulates binary error: adding perBar/36 per click,
   * 72 clicks of 4/36 reaches 7.999999999999998, so two full bars of turning
   * reads bar 2 beat 4 and the counter sits an epsilon behind your hand for
   * the rest of the drill. Counting in integer UNITS and multiplying once is
   * exact.
   *
   * Asserted through the header, which is where the drift would show.
   */
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 72; i++) cc(CC.knob1, 1);
  const drawn = drawnText();
  /* Two bars in on an eight-bar practice: bar 3 of 8, not bar 2 of 8. */
  assert.ok(drawn.some((t) => /^3\/8$/.test(t)),
    `the position drifted: ${drawn.filter((t) => /\//.test(t)).join('|')}`);
});

test('a scrub cannot run past the end of the practice', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 2000; i++) cc(CC.knob1, 1);
  ticks(2);
  const drawn = drawnText();
  const pos = drawn.find((t) => /^\d+\/\d+$/.test(t));
  assert.ok(pos, 'no position on screen');
  const [bar, bars] = pos.split('/').map(Number);
  assert.ok(bar <= bars, `bar ${bar} of ${bars} is past the end`);
});

/* ---- the ear training actually works ------------------------------------ */

function openQuiz(index) {
  toQuizzes();
  for (let i = 0; i < index; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(3);
}

test('a hearing drill SOUNDS its prompt', async () => {
  /*
   * Three of the five drills asked you to identify something they never
   * played: nothing in the module sounded a quiz prompt at all.
   */
  for (const [i, d] of DRILLS.entries()) {
    if (d.mode !== 'hear' && d.mode !== 'pick') continue;
    const { log } = await loadUi();
    globalThis.init();
    ticks(2);
    const before = log.params.filter(isHit).length;
    openQuiz(i);
    ticks(40);                       /* a rhythm prompt takes a moment */
    const after = log.params.filter(isHit).length;
    assert.ok(after > before, `${d.name} played nothing`);
  }
});

test('a correct answer moves on, and the reveal stays up until it does', () => {
  /*
   * The reported bug: the drill asked one question for ever, because advance
   * was only wired into the picking path.
   *
   * Asserted through the REVEAL, which is the one thing on screen that only
   * an advance can clear: getting it right names the drum, and the next
   * prompt withholds the name again. The streak and the progress counter both
   * move whether or not the question changes, so neither can prove anything.
   */
  return loadUi().then(({ log }) => {
    globalThis.init();
    ticks(2);
    openQuiz(0);                       /* Guess: drum */

    const named = () => drawnText(1).some((t) => /Snare|Kick|Hi-hat|Ride|Crash|tom|Open hat/.test(t));
    assert.equal(named(), false, 'the answer was named before it was given');

    /* One of the pads is right; a wrong one only costs time. */
    for (let p = 68; p <= 99; p++) { pad(p, 100); pad(p, 0); }
    globalThis.tick();
    assert.equal(named(), true, 'getting it right did not reveal the answer');

    ticks(40);                         /* past QUIZ_ADVANCE_MS */
    assert.equal(named(), false, 'the prompt never advanced — it asks one question for ever');
  });
});

test('a round of N needs N different answers, not one answered N times', () => {
  /*
   * Without advancing, the same prompt accepts the same answer over and over
   * and the round completes having asked one question.
   */
  return loadUi().then(({ log }) => {
    globalThis.init();
    ticks(2);
    openQuiz(0);
    /* Answer the first prompt correctly, then IMMEDIATELY answer it again
     * with the same pads before the advance. The second press must not score,
     * because by then it is a different question. */
    for (let p = 68; p <= 99; p++) { pad(p, 100); pad(p, 0); }
    globalThis.tick();
    const after1 = drawnText(1).find((t) => /^\d+\/\d+$/.test(t));
    ticks(40);
    const after2 = drawnText(1).find((t) => /^\d+\/\d+$/.test(t));
    assert.equal(after1, after2, 'the counter moved without an answer');
    assert.ok(/^1\//.test(after1 || ''), `one answer should read 1/N, got ${after1}`);
  });
});

test('Play repeats the question in a hearing drill', async () => {
  const hearIdx = DRILLS.findIndex((d) => d.mode === 'hear');
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  openQuiz(hearIdx);
  ticks(20);
  const before = log.params.filter(isHit).length;
  cc(CC.play, 127);
  ticks(20);
  assert.ok(log.params.filter(isHit).length > before,
    'Play did not repeat the prompt');
});

test('a rhythm prompt is spread over time, not dumped in one frame', async () => {
  /* A subdivision you cannot hear as a rhythm is not a subdivision. */
  const idx = DRILLS.findIndex((d) => d.kind === 'subdiv');
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  /*
   * Opened by hand rather than through openQuiz(), which ticks three frames of
   * its own — long enough for the first note of the prompt to sound OUTSIDE
   * the window below. That is what made this test flaky: it counted per*2 - 1
   * notes, so `quarters` (per:1) left one note in the window and failed a
   * fixed `>= 4` about one run in five, on nothing but the random draw.
   *
   * It is measured against the prompt's OWN length now. What the test is about
   * is that no two notes share a frame.
   */
  toQuizzes();
  for (let i = 0; i < idx; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  let framesWithSound = 0;
  let notes = 0;
  for (let i = 0; i < 60; i++) {
    const before = log.params.filter(isHit).length;
    ticks(1);
    const added = log.params.filter(isHit).slice(before);
    if (!added.length) continue;
    framesWithSound++;
    for (const [, v] of added) notes += String(v).split(',').filter(Boolean).length;
  }
  assert.ok(framesWithSound >= 2, `the whole prompt landed in ${framesWithSound} frames`);
  assert.equal(notes, framesWithSound,
    `${notes} notes arrived in ${framesWithSound} frames — some were dumped together`);
});

test('the host may ask to unload as often as it likes; we tear down once', async () => {
  /*
   * A device log of a real unload has the host calling onUnload 53 times in
   * 150ms. Each pass used to force 32 CC messages into a ring that holds about
   * 64 and is shared with Move's own output and the LED queue, and to rewrite
   * the stats and settings files — roughly 1700 messages and 53 writes at the
   * moment control goes back to Move.
   */
  const { log } = await loadUi({ settings: { midiOut: 1 } });
  globalThis.init();
  ticks(6);
  globalThis.onMidiMessageInternal([0x90, 68, 100]);   /* something went to the track */
  globalThis.onMidiMessageInternal([0x80, 68, 0]);
  ticks(6);

  const midiBefore = log.midi.length;
  const ledsBefore = log.leds.length;
  const writesBefore = Object.keys(log.writes).length;
  globalThis.onUnload();
  const midiOnce = log.midi.length - midiBefore;
  const ledsOnce = log.leds.length - ledsBefore;
  assert.ok(midiOnce > 0, 'the first unload sent no all-notes-off at all');
  assert.ok(ledsOnce >= 32, 'the first unload left the pads lit');

  for (let i = 0; i < 52; i++) globalThis.onUnload();
  assert.equal(log.midi.length - midiBefore, midiOnce,
    'a repeated unload flooded the MIDI ring again');
  assert.equal(log.leds.length - ledsBefore, ledsOnce,
    'a repeated unload repainted every pad again');
  assert.ok(Object.keys(log.writes).length >= writesBefore,
    'sanity: writes are tracked by path');
  /* Still never asks the host to exit, however many times it is called. */
  assert.equal(log.exited || 0, 0);
});

test('opening again after a close is not left latched shut', async () => {
  /*
   * `exited` stops tick() dead, so if it survived into a second load the
   * module would come up and never draw. ui.js is re-evaluated per load today,
   * which is the only reason this has never bitten; init() clears it so that
   * stays true if shadow_ui ever reuses a context.
   */
  const { screen } = await loadUi();
  globalThis.init();
  ticks(4);
  globalThis.onUnload();
  /*
   * Asserted on the SCREEN, not on the LED log: init() paints pads directly,
   * so an LED-based check passes even when tick() is latched shut and nothing
   * is ever drawn — which is the whole failure being guarded against.
   */
  screen.pixels.fill(0);
  globalThis.init();
  ticks(8);
  assert.ok(screen.pixels.some((v) => v !== 0), 'the module drew nothing after reopening');
});

test('leaving a quiz silences whatever it was still playing', async () => {
  const idx = DRILLS.findIndex((d) => d.kind === 'groove');
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  openQuiz(idx);
  ticks(2);
  cc(CC.back, 127);
  const before = log.params.filter(isHit).length;
  ticks(60);
  assert.equal(log.params.filter(isHit).length, before,
    'the prompt kept playing after leaving the drill');
});

test('LISTENING ends by itself too, not just practising', async () => {
  /* The reported bug: "the drum practice never ends (I had 11/8 bars)". */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.play, 127);                        /* listen, not practise */

  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s, v) => { drawn.push(s); orig(x, y, s, v); };
  ticks(1600);
  globalThis.print = orig;

  assert.ok(drawn.some((t) => /RESULT|REC again/.test(t)),
    `listening never finished: ${[...new Set(drawn)].slice(0, 10).join('|')}`);
  /* And it never counted past its own length while doing so. */
  const overrun = drawn.filter((t) => /^(\d+)\/(\d+)$/.test(t))
    .map((t) => t.split('/').map(Number))
    .filter(([bar, bars]) => bar > bars);
  assert.equal(overrun.length, 0, `the bar counter ran past the end: ${overrun.slice(0, 3)}`);
});

/*
 * THE COUNT-IN IS FOUR BEATS, NOT EIGHT. start() put the count-in into the
 * clock origin and advanceClock added it again, so a drill opened at -8 with
 * the digit stuck on "4" for half of it. Asserted on TIME, through the first
 * note the engine is asked to sound — a pixel diff could not tell 4 from 8.
 */
test('the count-in lasts exactly the beats it says', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);          /* Rock backbeat, L1: hi-hat, 92 bpm */
  log.params.length = 0;
  cc(CC.play, 127);                        /* listen, from the top */
  let elapsed = 0;
  while (elapsed < 10000 && !log.params.some(isHit)) {
    globalThis.__advance(5);
    elapsed += 5;
    globalThis.tick();
  }
  const fourBeats = 4 * 60000 / 92;
  assert.ok(Math.abs(elapsed - fourBeats) <= 30,
    `the first note sounded ${elapsed}ms after Play; four beats is ${Math.round(fourBeats)}ms`);
});

test('a start from a scrubbed bar plays from that bar, with no count-in', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 36; i++) cc(CC.knob1, 1);   /* one bar */
  ticks(1);
  log.params.length = 0;
  cc(CC.play, 127);
  let elapsed = 0;
  while (elapsed < 10000 && !log.params.some(isHit)) {
    globalThis.__advance(5);
    elapsed += 5;
    globalThis.tick();
  }
  /* Bar 2's first hi-hat is ON the start point: it sounds straight away, not
   * four beats later. */
  assert.ok(elapsed <= 30, `a scrubbed start waited ${elapsed}ms before its first note`);
});

/* The colour each pad was last set to, from the captured LED writes. */
function padColours(log) {
  const last = {};
  for (const [n, c] of log.leds) last[n] = c;
  return last;
}

test('a scrub lights the stack it lands on, and running hands the pads back', async () => {
  const { log } = await loadUi();
  const P = await import(new URL('../src/padmap.mjs', import.meta.url));
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);          /* Rock backbeat L1: hi-hat eighths */
  const near = () => Object.entries(padColours(log))
    .filter(([, c]) => c === P.LED_TARGET_NEAR).map(([n]) => Number(n)).sort((a, b) => a - b);
  assert.deepEqual(near(), [], 'a freshly armed drill starts dark');
  for (let i = 0; i < 9; i++) cc(CC.knob1, 1);   /* a beat: lands on a hi-hat */
  ticks(2);
  const hh = P.padsForVoice('HH', 'kit').slice().sort((a, b) => a - b);
  assert.deepEqual(near(), hh, 'the scrub did not light the hi-hat it landed on');
  cc(CC.record, 127);                       /* practise from there */
  ticks(2);
  assert.deepEqual(near(), [], 'running, with Guide pads off, nothing is lit');
});

test('Listen lights each drum as it plays it', async () => {
  const { log } = await loadUi();
  const P = await import(new URL('../src/padmap.mjs', import.meta.url));
  globalThis.init();
  ticks(2);
  toFirstRung(); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.play, 127);                         /* listen */
  const hh = new Set(P.padsForVoice('HH', 'kit'));
  let lit = false;
  for (let i = 0; i < 1600 && !lit; i++) {   /* past the 2.6s count-in */
    globalThis.__advance(5);
    globalThis.tick();
    lit = log.leds.some(([n, c]) => hh.has(n) && c === P.LED_TARGET_NEAR);
  }
  assert.ok(lit, 'Listen played the hi-hat without lighting it');
});

/*
 * CLOCK MODE DID NOT STAY WITH ITS DRILL. Using the Clock and then opening a
 * groove level kept the muting click and the drift banner, because opening a
 * level never reset it.
 */
test('the Clock stays with the drill it wrapped', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung(); cc(CC.jogClick, 127); ticks(2);   /* Rock backbeat L1 armed */
  for (let i = 0; i < 4; i++) { cc(CC.back, 127); ticks(1); } /* up to the top */
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1);
  cc(CC.jogTurn, 127); cc(CC.jogTurn, 127);                  /* Training */
  cc(CC.jogClick, 127);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127); ticks(2);                            /* Clock, on the armed drill */
  for (let i = 0; i < 4; i++) { cc(CC.back, 127); ticks(1); }
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 127);          /* back to the first row */
  toFirstRung(); cc(CC.jogClick, 127); ticks(2);   /* a plain level again */
  cc(CC.record, 127);
  const drawn = drawnText(200);
  assert.ok(!drawn.some((t) => /LISTEN|ON YOUR OWN/.test(t)), 'the Clock banner followed into a plain drill');
});

/* ---- Regressions from the 1.2.0 review, driven end to end ------------------- */

const SETTINGS_FILE = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
const shiftClick = () => { cc(CC.shift, 127); cc(CC.jogClick, 127); cc(CC.shift, 0); };
const knob = (k, d) => cc(CC.knob1 + k, d);
/* Arm the first rung of the first groove: Grooves › Rock & Pop › Rock backbeat › L1. */
function armFirstRung() {
  toFirstRung();
  ticks(2);
  cc(CC.jogClick, 127);
  ticks(2);
}
/* Up to the top of the tree and into Training (the fifth row). */
function toTraining() {
  for (let i = 0; i < 4; i++) cc(CC.back, 127);
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 127);
  for (let i = 0; i < 4; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
}
function runUntil(re, maxTicks) {
  for (let i = 0; i < maxTicks; i++) {
    if (drawnText(1).some((t) => re.test(t))) return true;
  }
  return false;
}

test('Record after a result is a new take from the top, not an instant end', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  assert.ok(runUntil(/REC again/, 3000), 'the take should end on its result');
  cc(CC.record, 127);
  ticks(2);
  /* A second or two in it must still be running — it used to start at the
   * end of the last take and finish on the spot. */
  assert.equal(runUntil(/REC again/, 60), false, 'the new take ended at once');
});

test('Back from a result goes to the start of the drill, Back again to the list', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  assert.ok(runUntil(/REC again/, 3000));
  cc(CC.back, 127);
  const ready = drawnText(2);
  assert.ok(ready.some((t) => /REC/.test(t)) && !ready.some((t) => /REC again/.test(t)),
    'the ready screen: ' + ready.slice(0, 8).join('|'));
  cc(CC.back, 127);
  assert.ok(drawnText(2).some((t) => /ROCK/.test(t)), 'then the list it came from');
});

test('Settings opened over a run pauses it, and leaving returns to it', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(80);
  shiftClick();
  assert.ok(drawnText(2).some((t) => /SETTINGS/.test(t)));
  shiftClick();
  assert.ok(drawnText(2).some((t) => /PAUSED/.test(t)), 'back on the run, held where it was');
  cc(CC.back, 127);                              /* restart: the ready screen */
  shiftClick();
  cc(CC.back, 127);                              /* Back leaves Settings too */
  const back = drawnText(2);
  assert.ok(!back.some((t) => /SETTINGS/.test(t)) && back.some((t) => /REC/.test(t)),
    'Back from Settings returns to the ready screen, not the list');
});

test('knobs change nothing outside Settings', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  for (let k = 0; k < 8; k++) { knob(k, 1); knob(k, 1); }
  ticks(4);
  globalThis.onUnload();
  /* A first start writes the defaults; what matters is that none moved. */
  const { DEFAULTS } = await import('../src/settings_def.mjs');
  const saved = log.writes[SETTINGS_FILE] ? JSON.parse(log.writes[SETTINGS_FILE]) : DEFAULTS;
  for (const k of Object.keys(DEFAULTS)) {
    assert.deepEqual(saved[k], DEFAULTS[k], `a knob on the list changed ${k}`);
  }
});

test('a Settings knob keeps its row however far it is turned, and the jog touch moves nothing', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  shiftClick();
  globalThis.onMidiMessageInternal([0x90, 9, 127]);   /* jog touch */
  knob(0, 1);                                         /* row 0 is Tempo, if the cursor stayed */
  for (let i = 0; i < 6; i++) cc(CC.jogTurn, 1);      /* row 6: the second page */
  for (let i = 0; i < 3; i++) knob(1, 1);             /* knob 2 is row 6 on that page */
  ticks(2);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[SETTINGS_FILE]);
  assert.equal(saved.bpm, 91, 'jog touch must not move the cursor off Tempo');
  assert.equal(saved.strictness, 'tight', 'three turns of one knob, one row');
  assert.equal(saved.view, 'grid', 'and not the rows around it');
  assert.equal(saved.sticking, 'strict');
});

test('knob 8 slows a hand-written drill', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armFirstRung();
  knob(7, 127);
  knob(7, 127);
  ticks(2);
  const said = log.announces.join(' | ');
  assert.match(said, /speed 90 percent, 83 bpm/, said);
});

test('the Ladder climbs from 70% of the drill\'s tempo', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armFirstRung();
  toTraining();
  cc(CC.jogClick, 127);                               /* Ladder */
  ticks(2);
  assert.match(log.announces.join(' | '), /Ladder: .*, from 65/);
});

test('the Clock ends by itself on a result', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armFirstRung();
  toTraining();
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);                               /* Clock */
  ticks(2);
  cc(CC.record, 127);
  /* Four rounds of 4 bars on, 4 off, at 92bpm: about 85 seconds. */
  assert.ok(runUntil(/BACK start/, 5000), 'the Clock never ended');
});

test('Menu stops a run cleanly: back to the list, the Record light out', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(40);
  cc(CC.menu, 127);
  ticks(4);
  const record = log.buttons.filter(([c]) => c === CC.record);
  assert.equal(record[record.length - 1][1], 0, 'the Record light was left burning');
  assert.ok(drawnText(2).some((t) => /ROCK|GROOVES|DRUMS/.test(t)));
});

test('a broken user.json is reported, and the shipped drills still load', async () => {
  await loadUi({ extraFiles: { 'user.json': '{ "exercises": [ oops' } });
  globalThis.init();
  const shown = drawnText(2);
  assert.ok(shown.some((t) => /BAD USER\.JSON/.test(t)), shown.join('|'));
  assert.ok(shown.some((t) => /Grooves/.test(t)), 'the list is there underneath');
});

/* ---- the Learning Path and progress ---------------------------------------- */

const DATA = '/data/UserData/schwung/modules/tools/drums-practice/';
/* Easy to play exactly: no count-in, no click, hands not judged. */
const PLAIN = { countIn: 0, click: false, sticking: 'off' };
const SNARE = 0;
let snarePad = 0;
async function snare() {
  if (!snarePad) snarePad = (await import('../src/padmap.mjs')).padsForVoice('SN', 'kit')[SNARE];
  return snarePad;
}

/* Learning Path › Continue: the root's second row, its first. */
function continuePath() {
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 127);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
}

/* Practise quarters at `bpm`, one hit dead on every beat, until the result. */
function playQuarters(snarePadNo, bpm, beats = 40) {
  cc(CC.record, 127);
  const beatMs = 60000 / bpm;
  let t = 0;
  let next = 0;
  for (let i = 0; i < (beats * beatMs) / 25 + 40; i++) {
    /* On the first tick at or past each beat: never more than 25ms late. */
    if (t >= next) { pad(snarePadNo, 100); pad(snarePadNo, 0); next += beatMs; }
    globalThis.__advance(25);
    t += 25;
    globalThis.tick();
  }
}

test('Continue opens the first step, a clean take at tempo learns it, Click goes on', async () => {
  const { log } = await loadUi({ settings: PLAIN });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  assert.ok(drawnText(2).some((t) => /Quart/.test(t)), 'Continue did not open Quarters');
  playQuarters(sn, 100);
  const shown = drawnText(2);
  assert.ok(shown.includes('LEARNED'), `not learned: ${shown.join('|')}`);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.ok(saved.items['subdiv:quarters'].done > 0, 'the step was not learned');
  assert.equal(saved.items['subdiv:quarters'].best, 100);
  /* The path set Tempo to the step's target, so 100% Speed was what it asks. */
  assert.equal(JSON.parse(log.writes[`${DATA}settings.json`]).bpm, 100);
});

test('Click on a path result opens the next step of the track', async () => {
  await loadUi({ settings: PLAIN });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 100);
  cc(CC.jogClick, 127);
  ticks(2);
  const shown = drawnText(2);
  assert.ok(shown.some((t) => /Eight/.test(t)), `not on to Eighths: ${shown.join('|')}`);
});

test('a slow clean take reads as its speed; the row shows it', async () => {
  await loadUi({ settings: { ...PLAIN, speed: 70 } });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 70);
  const shown = drawnText(2);
  assert.ok(shown.includes('CLEAN') && shown.includes('70 bpm'), shown.join('|'));
  cc(CC.menu, 127);
  ticks(2);
  /* Learning Path › Time › Pulse: Quarters shows its 70%. */
  cc(CC.jogTurn, 2);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(drawnText(2).includes('70%'), 'the row does not show the clean speed');
});

/* Practise eighths at `bpm`, dead on every half beat, at the velocity `vel(i)`
 * gives the i-th stroke (even i fall on the beat, where the accents are) —
 * `beats` of them, the drill's length, and then on to the result without
 * touching a pad on it. */
function playEighths(snarePadNo, bpm, vel, beats = 32) {
  cc(CC.record, 127);
  const stepMs = 30000 / bpm;
  let t = 0;
  let next = 0;
  let i = 0;
  for (let k = 0; k < (beats * 2 * stepMs) / 25 + 40; k++) {
    if (t >= next && i < beats * 2) { pad(snarePadNo, vel(i++)); pad(snarePadNo, 0); next += stepMs; }
    globalThis.__advance(25);
    t += 25;
    globalThis.tick();
  }
}

test('an even take of an accented drill says its accents were soft, and never BEST YET', async () => {
  /* The reported take, through the real UI: every note hit at one velocity,
   * so no accent stood out. It must say so — not headline a 100. */
  const { log } = await loadUi({ settings: PLAIN });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 100);
  cc(CC.jogClick, 127);           /* on to Eighths */
  ticks(2);
  playEighths(sn, 100, () => 70);
  let shown = drawnText(2);
  assert.ok(shown.includes('NOT CLEAN'), shown.join('|'));
  assert.ok(!shown.includes('BEST YET'), shown.join('|'));
  assert.ok(shown.some((t) => /^\d+ soft accents 70<85$/.test(t)), shown.join('|'));
  assert.ok(shown.includes('right, need 90'), shown.join('|'));
  /* The same take with the accents lifted counts: Record, from the result. */
  playEighths(sn, 100, (i) => (i % 2 ? 70 : 90));
  shown = drawnText(2);
  assert.ok(shown.includes('LEARNED'), shown.join('|'));
  globalThis.onUnload();
  const stats = JSON.parse(log.writes[`${DATA}stats.json`]).records;
  const even = stats.find((r) => r.d.startsWith('drill:subdiv:eighths') && r.dy > 0);
  assert.ok(even, 'the record does not say what its errors were');
  assert.equal(even.av, 70);
  assert.equal(even.an, 85);
});

test('a Study take is not counted', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, study: true } });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 100);
  assert.ok(drawnText(2).includes('STUDY'));
  globalThis.onUnload();
  const saved = log.writes[`${DATA}progress.json`];
  assert.ok(!saved || !JSON.parse(saved).items['subdiv:quarters']);
});

test('Skip next moves Continue on to the next track', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);           /* into the Learning Path */
  ticks(1);
  assert.ok(drawnText(1).some((t) => /Next: Quarters/.test(t)));
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);           /* Skip: Quarters */
  ticks(1);
  assert.ok(drawnText(1).some((t) => /Next: Eighths/.test(t)), 'skipping did not move on');
});

test('Repetition lists what is due, and opens it', async () => {
  const day = 86400;
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 1, items: { flam: {
    best: 100, bpm: 70, plays: 1, t: now - 3 * day, done: now - 3 * day, skip: 0,
    rep: { due: now - day, step: 0, at: 0, ok: false }, h: [],
  } } };
  await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 1);   /* Repetition, the last row */
  ticks(1);
  assert.ok(drawnText(1).includes('1 due'), 'the due count is not on the row');
  cc(CC.jogClick, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('Flam'));
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(drawnText(2).some((t) => /Flam/.test(t)) && drawnText(1).some((t) => /bars|\d+\/\d+/.test(t)),
    'the repetition did not arm its drill');
});

test('Progress lists the tracks and what was played, and opens a chart', async () => {
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 1, items: { 'flam-tap': {
    best: 85, bpm: 61, plays: 2, t: now, done: 0, skip: 0, rep: null,
    h: [[now - 60, 70, 95, 20, 1], [now, 85, 93, 18, 1]],
  } } };
  await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  for (let i = 0; i < 20; i++) cc(CC.jogTurn, 1);    /* Progress, the last row */
  cc(CC.jogClick, 127);
  ticks(1);
  const list = drawnText(1);
  for (const t of ['PROGRESS', 'Overall', 'Time', 'Rudiments', 'Grooves', 'Ear']) {
    assert.ok(list.includes(t), `${t} missing: ${list.join('|')}`);
  }
  for (let i = 0; i < 5; i++) cc(CC.jogTurn, 1);     /* Flam tap, after the five overviews */
  const items = drawnText(1);
  assert.ok(items.includes('Flam tap') && items.includes('85%'), items.join('|'));
  cc(CC.jogClick, 127);
  ticks(1);
  const chart = drawnText(1);
  assert.ok(chart.includes('Flam tap') && chart.some((t) => /2 takes/.test(t)), chart.join('|'));
  assert.ok(chart.includes('JOG 6/6'), 'the chart does not say where it is in the list');
  /* The jog goes on through the charts: back one is the Ear overview. */
  cc(CC.jogTurn, 127);
  ticks(1);
  const ear = drawnText(1);
  assert.ok(ear.includes('EAR') && ear.some((t) => /learned of 5/.test(t)), ear.join('|'));
  cc(CC.back, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('PROGRESS'), 'Back from a chart returns to the list');
});

test('the overview draws drills learned over time', async () => {
  const now = Math.round(Date.now() / 1000);
  const learned = (t) => ({ best: 100, bpm: 70, plays: 1, t, done: t, skip: 0, rep: null, h: [] });
  const progress = { version: 1, items: {
    'flam-tap': learned(now - 86400 * 3), flam: learned(now - 86400), 'rock-backbeat:l3': learned(now),
  } };
  const { screen } = await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  for (let i = 0; i < 20; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);                              /* Progress */
  for (let i = 0; i < 20; i++) cc(CC.jogTurn, 127);
  cc(CC.jogClick, 127);                              /* Overall */
  ticks(1);
  const shown = drawnText(1);
  /* L3 learned ticks L0, L1 and L2 as well: six of the path's steps. */
  assert.ok(shown.some((t) => /^6 learned of/.test(t)), shown.join('|'));
  assert.ok(shown.includes('OVERALL'));
  const L = await import('../src/layout.mjs');
  const box = L.PROGRESS_PLOT;
  assert.ok(countOn(screen, box.x, box.y, box.w, box.h) > 40, 'no step line drawn');
});

test('takes already in stats.json are read in when there is no progress yet', async () => {
  const stats = { version: 1, records: [
    { t: 1000, d: 'ladder:flam:normal', bpm: 75, sd: 12, n: 30, err: 0 },
  ] };
  const { log } = await loadUi({ dataFiles: { 'stats.json': JSON.stringify(stats) } });
  globalThis.init();
  ticks(2);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.equal(saved.items.flam.best, 107, 'clean at 75 on a flam written at 70');
  assert.ok(saved.items.flam.done);
});

test('a damaged progress.json is kept aside and the backup read', async () => {
  const good = JSON.stringify({ version: 1, items: { flam: { best: 90, plays: 1, h: [] } } });
  const { log } = await loadUi({ dataFiles: { 'progress.json': '{"items": {trunc',
    'progress.bak.json': good } });
  globalThis.init();
  ticks(2);
  assert.equal(log.writes[`${DATA}progress.bad.json`], '{"items": {trunc');
  for (let i = 0; i < 20; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  for (let i = 0; i < 5; i++) cc(CC.jogTurn, 1);   /* past the overviews */
  ticks(1);
  assert.ok(drawnText(1).includes('90%'), 'the backup was not read');
});

test('an Ear step records its round, and Click goes on to the next quiz', async () => {
  const PM = await import('../src/padmap.mjs');
  const { log } = await loadUi({ settings: { roundSize: 10 } });
  globalThis.init();
  ticks(2);
  /* Learning Path › Ear › Know the kit › Guess: drum */
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  cc(CC.jogTurn, 5);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(drawnText(1).some((t) => /GUESS: DRUM/.test(t)), 'the step did not open its quiz');
  /* Try every drum in turn until the round is over: right answers and wrong
   * ones, so the score is somewhere in between. */
  const pads = PM.layoutVoices('kit').map((v) => PM.padsForVoice(v, 'kit')[0]);
  let shown = [];
  for (let k = 0; k < 400 && !shown.some((t) => /score \d+%/.test(t)); k++) {
    const p = pads[k % pads.length];
    pad(p, 100); pad(p, 0);
    ticks(25);
    shown = drawnText(1);
  }
  assert.ok(shown.some((t) => /score \d+%/.test(t)), `no score: ${shown.join('|')}`);
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(drawnText(1).some((t) => /HEAR: DRUM/.test(t)), 'Click did not go on to Hear: drum');
  globalThis.onUnload();
  assert.equal(JSON.parse(log.writes[`${DATA}progress.json`]).items['quiz:guess:voice'].plays, 1);
});

test('the Clock step arms the Clock round its drill, at the drill\'s target', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  /* Learning Path › Time › Keep time › Clock: quarters */
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  cc(CC.jogTurn, 2);
  cc(CC.jogClick, 127);
  cc(CC.jogTurn, 3);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(log.announces.includes('Clock: Quarters'), log.announces.slice(-3).join('|'));
  /* Eight bars of quarters at 100bpm is 19 seconds; at the default 90 it is 21. */
  assert.ok(drawnText(1).some((t) => /0:19/.test(t)), 'not at the target tempo');
});

test('a Ladder that never holds a rung ends, says why, and counts as tried', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, ladderBars: 1 } });
  globalThis.init();
  ticks(2);
  /* Basics › Subdivisions › Quarters, then Training › Ladder. */
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  /* Three folders up is the top (four would close the module), then Training. */
  for (let i = 0; i < 3; i++) cc(CC.back, 127);
  cc(CC.jogTurn, 4);
  cc(CC.jogClick, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  cc(CC.record, 127);
  assert.ok(runUntil(/best clean 0/, 2000), 'the Ladder never ended');
  assert.ok(drawnText(1).some((t) => /nothing played/.test(t)));
  globalThis.onUnload();
  const it = JSON.parse(log.writes[`${DATA}progress.json`]).items['subdiv:quarters'];
  assert.equal(it.plays, 1);
  assert.equal(it.best, 0);
});

/* ---- multiple choice on the pads, as in Piano Practice ------------------- */

/* The latest colour each pad was set to. */
function padNow(log) {
  const now = {};
  for (const [n, c] of log.leds) now[n] = c;
  return now;
}

test('a Pick drill puts its answers on the bottom row, named by colour on screen', async () => {
  const AP = await import('../src/answer_pads.mjs');
  for (const index of [2, 3, 4]) {
    const { log } = await loadUi();
    globalThis.init();
    ticks(2);
    openQuiz(index);
    ticks(2);
    const leds = padNow(log);
    const row = [];
    for (let p = 68; p < 76; p++) row.push(leds[p]);
    const bright = AP.ANSWER_COLOURS.map((c) => c.bright);
    const dim = AP.ANSWER_COLOURS.map((c) => c.dim);
    assert.deepEqual(row.map((c) => c === 0 ? 0 : 1), [0, 1, 0, 1, 0, 1, 0, 0], `${DRILLS[index].name}: ${row}`);
    for (const c of [row[1], row[3], row[5]]) assert.ok(bright.includes(c) || dim.includes(c), String(c));
    const shown = drawnText(1);
    for (const name of ['blue', 'cyan', 'white']) assert.ok(shown.includes(name), `${name}: ${shown.join('|')}`);
    assert.ok(shown.includes('PAD answer  REC help'));
  }
});

test('an answer pad answers and sounds nothing; one of the three is right', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  openQuiz(3);                               /* Hear: subdivision */
  ticks(120);                                /* the prompt itself sounds: let it finish */
  const before = log.params.length;
  const flashes = [];
  for (const p of [69, 71, 73]) {
    pad(p, 100); pad(p, 0);
    ticks(1);
    flashes.push(padNow(log)[p]);
    if (flashes[flashes.length - 1] === 126) break;   /* green: right */
  }
  assert.ok(flashes.includes(126), `no answer was right: ${flashes}`);
  assert.equal(log.params.slice(before).filter(isHit).length, 0,
    'an answer pad sounded a drum');
  ticks(30);
  assert.ok(drawnText(1).some((t) => /^1\//.test(t)), 'the round did not count the answer');
});

test('Guess: drum keeps the whole kit — its answer is a drum, so there is no bar', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  openQuiz(0);
  ticks(2);
  const leds = padNow(log);
  const row = [];
  for (let p = 68; p < 76; p++) row.push(leds[p]);
  assert.ok(row.every((c) => c === 107), `the bottom row is not the kit: ${row}`);
  assert.ok(!drawnText(1).includes('blue'));
});

/* ---- looking back over a finished take ----------------------------------- */

test('from the result the jog scrolls back through the take, and forward to the result again', async () => {
  await loadUi({ settings: PLAIN });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 100);
  assert.ok(drawnText(1).includes('LEARNED'), 'no result');
  cc(CC.jogTurn, 127);                          /* one beat back */
  ticks(1);
  let shown = drawnText(1);
  assert.ok(shown.includes('REVIEW'), `not reviewing: ${shown.join('|')}`);
  assert.ok(!shown.includes('LEARNED'), 'the result is still up');
  for (let i = 0; i < 12; i++) cc(CC.jogTurn, 127);
  ticks(1);
  shown = drawnText(1);
  assert.ok(shown.some((t) => /^\d+\/\d+$/.test(t)), 'no bar position in the review');
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 1);
  ticks(1);
  assert.ok(drawnText(1).includes('LEARNED'), 'forward to the end did not bring the result back');
});

test('the review shows what was played: hits as rings, misses as crosses', async () => {
  const { screen } = await loadUi({ settings: { ...PLAIN, view: 'staff' } });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  /* Every other beat: half hit, half missed. */
  cc(CC.record, 127);
  const beatMs = 600;
  let t = 0;
  let next = 0;
  let k = 0;
  for (let i = 0; i < (40 * beatMs) / 25 + 40; i++) {
    if (t >= next) { if (k % 2 === 0) { pad(sn, 100); pad(sn, 0); } k++; next += beatMs; }
    globalThis.__advance(25);
    t += 25;
    globalThis.tick();
  }
  assert.ok(drawnText(1).includes('NOT CLEAN'), 'half missed should not be clean');
  for (let i = 0; i < 6; i++) cc(CC.jogTurn, 127);
  ticks(1);
  /* The staff between the clef and the right edge carries the judged notes. */
  assert.ok(countOn(screen, 30, 10, 98, 34) > 60, 'the review drew no notes');
  cc(CC.back, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('NOT CLEAN'), 'Back from the review is the result');
});

test('knob 1 scrolls the review too, finer than the jog', async () => {
  await loadUi({ settings: PLAIN });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 100);
  cc(CC.knob1, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('REVIEW'));
  cc(CC.knob1, 1);
  ticks(1);
  assert.ok(drawnText(1).includes('LEARNED'), 'one step forward from just before the end is the result');
  cc(CC.record, 127);
  ticks(2);
  cc(CC.jogTurn, 127);
  ticks(1);
  assert.ok(!drawnText(1).includes('REVIEW'), 'a new take forgets the last one');
});

/* ---- L0: own pace ------------------------------------------------------------ */
/*
 * The whole groove, no clock: a cursor waits on each stack until it is struck
 * together. Driven by the bundled rock backbeat, two passes, stack by stack.
 */
const ROCK = JSON.parse(readFileSync(new URL('../src/exercises/rock-backbeat.json', import.meta.url), 'utf8'));
/* Rock backbeat's drums, on the kit layout's left half. */
const PAD_OF = { HH: 78, KK: 68, SN: 69 };
/* One stack per entry, beat order, same-beat events merged as the loader does. */
const ROCK_STACKS = (() => {
  const by = new Map();
  for (const e of ROCK.events) {
    const s = by.get(e.beat) || { beat: e.beat, voices: [], dyn: {} };
    s.voices.push(...e.voices);
    if (typeof e.dyn === 'string') for (const v of e.voices) s.dyn[v] = e.dyn;
    else Object.assign(s.dyn, e.dyn || {});
    by.set(e.beat, s);
  }
  return [...by.values()].sort((a, b) => a.beat - b.beat);
})();

/* Rock backbeat › L0, armed on its ready screen. */
function armL0() {
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);   /* its ladder, highlight on L0 */
  cc(CC.jogClick, 127); ticks(2);
}
/* One stack, struck together. */
function strike(stack) {
  for (const v of stack.voices) pad(PAD_OF[v], stack.dyn[v] === 'accent' ? 127 : 80);
  for (const v of stack.voices) pad(PAD_OF[v], 0);
}
/* Every stack of `passes` passes, `gapTicks` apart. */
function stepThrough(passes = 2, gapTicks = 8) {
  for (let p = 0; p < passes; p++) {
    for (const s of ROCK_STACKS) { strike(s); ticks(gapTicks); }
  }
}

test('L0 is the first rung, and its ready screen offers own pace with no count-in', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  cc(CC.jogClick, 127);
  assert.ok(drawnText(2).some((t) => /^L0 Own pace/.test(t)), 'the ladder starts at L0');
  cc(CC.jogClick, 127);
  const ready = drawnText(2);
  assert.ok(ready.includes('REC   own pace'), ready.join('|'));
  assert.ok(ready.includes('PLAY  hear bar'));
  assert.ok(ready.some((t) => /stacks/.test(t)), 'the length is counted in stacks');
  cc(CC.record, 127);
  const running = drawnText(2);
  assert.ok(running.includes('1/2'), 'at once on the first bar of two: no count-in');
  assert.ok(running.includes('--'), 'no pace until there is one');
});

test('stepping L0 through, clean, ends on a result that learns it', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  stepThrough();
  const shown = drawnText(3);
  assert.ok(shown.some((t) => /100% 1st try/.test(t)), shown.join('|'));
  assert.ok(shown.some((t) => /of 92bpm/.test(t)), 'the pace against the written tempo');
  assert.ok(shown.includes('LEARNED'));
  globalThis.onUnload();
  const progress = JSON.parse(log.writes[`${DATA}progress.json`]);
  const it = progress.items['rock-backbeat:l0'];
  assert.ok(it && it.done, 'L0 was learned');
  assert.equal(it.rep, null, 'and never comes back for repetition');
  const stats = JSON.parse(log.writes[`${DATA}stats.json`]);
  assert.ok(stats.records.some((r) => r.d.startsWith('untimed:rock-backbeat:l0:normal') && r.cl === 1),
    JSON.stringify(stats.records));
});

test('a stack struck apart is asked for again and costs its first try', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  /* Hat, then the kick 100ms later: the window is 60ms on normal. */
  pad(PAD_OF.HH, 80); pad(PAD_OF.HH, 0);
  ticks(4);
  pad(PAD_OF.KK, 80); pad(PAD_OF.KK, 0);
  ticks(4);
  stepThrough();
  const shown = drawnText(3);
  const n = ROCK_STACKS.length * 2;
  const pct = Math.floor(((n - 1) * 100) / n);
  assert.ok(shown.some((t) => t === `${pct}% 1st try`), `${pct}%: ${shown.join('|')}`);
});

test('Guide pads light the stack L0 waits on, and a guided take is practice', async () => {
  const { log } = await loadUi({ settings: { guide: true } });
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  log.leds.length = 0;
  ticks(2);
  const PADS = await import('../src/padmap.mjs');
  const lit = new Map(log.leds);
  assert.equal(lit.get(PAD_OF.HH), PADS.LED_TARGET_NEAR, 'the hat of the first stack is lit as now');
  assert.equal(lit.get(PAD_OF.KK), PADS.LED_TARGET_NEAR, 'and the kick with it');
  stepThrough();
  assert.ok(drawnText(3).includes('PRACTICE'));
});

test('Play on L0 sounds the bar, spread over time, and starts nothing', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  log.params.length = 0;
  cc(CC.play, 127);
  ticks(1);
  const early = log.params.filter(isHit).length;
  ticks(120);                                   /* three seconds: past the bar at 92 */
  const all = log.params.filter(isHit).length;
  assert.ok(early >= 1 && all > early, `${early} then ${all}`);
  assert.ok(drawnText(2).includes('REC   own pace'), 'still on the ready screen');
});

test('Record pauses an L0 take, and a press while paused is not a stroke', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  cc(CC.record, 127);                           /* pause */
  assert.ok(drawnText(2).includes('PAUSED'));
  pad(PAD_OF.SN, 80); pad(PAD_OF.SN, 0);       /* a wrong pad — ignored while paused */
  cc(CC.record, 127);                           /* resume */
  ticks(2);
  stepThrough();
  assert.ok(drawnText(3).some((t) => /100% 1st try/.test(t)));
});

test('the Ladder over L0 asks for a timed rung', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  toTraining();
  cc(CC.jogClick, 127);                         /* Ladder */
  assert.ok(drawnText(2).includes('ARM A TIMED RUNG'));
});

test('Click on an L0 result goes on to L1', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  stepThrough();
  cc(CC.jogClick, 127);
  const ready = drawnText(2);
  assert.ok(ready.includes('REC   practise'), `the timed ready screen: ${ready.join('|')}`);
});

test('looking back over an L0 take walks its page', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  stepThrough();
  cc(CC.jogTurn, 127);                          /* back into the take */
  assert.ok(drawnText(2).includes('REVIEW'));
  cc(CC.back, 127);
  assert.ok(drawnText(2).some((t) => /1st try/.test(t)), 'Back is the result again');
});

test('Speed during an L0 take changes only what Play sounds like; the take stays whole', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  cc(CC.knob1 + 7, 127);                        /* knob 8, a step slower */
  stepThrough();
  const shown = drawnText(3);
  assert.ok(shown.includes('LEARNED'), `still a whole take: ${shown.join('|')}`);
  assert.ok(shown.some((t) => /of 92bpm/.test(t)), 'measured against the written tempo, not the Speed');
});

test('an L0 take begun from a scrubbed bar is a passage, and is not kept', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  for (let i = 0; i < 36; i++) cc(CC.knob1, 1);  /* one bar on */
  ticks(1);
  cc(CC.record, 127);
  ticks(2);
  assert.ok(drawnText(1).includes('2/2'), 'it starts on the bar scrubbed to');
  stepThrough(1);
  assert.ok(drawnText(3).includes('not kept'));
  globalThis.onUnload();
  const saved = log.writes[`${DATA}progress.json`];
  assert.ok(!saved || !JSON.parse(saved).items['rock-backbeat:l0'], 'nothing recorded');
});

test('L0 on the sticking kit says what to change instead of a take that cannot move', async () => {
  /* Every pad is the snare there: the hat and the kick of a groove cannot be
   * struck, and with no clock nothing would ever move the cursor on. */
  const { log } = await loadUi({ settings: { layout: 'sticking' } });
  globalThis.init();
  ticks(2);
  armL0();
  assert.ok(drawnText(2).includes('SET KIT TO KIT'), 'the ready box says so');
  cc(CC.record, 127);
  ticks(2);
  assert.ok(drawnText(2).includes('SET KIT TO KIT'), 'and Record does not start a take');
  assert.ok(log.announces.some((a) => /Kit/.test(a)));
});

test('an L0 scrub stops at the last bar with notes in it', async () => {
  /* A user groove of two bars with notes only in the first: the scrub used to
   * reach the empty last bar, and the take then began from the top with every
   * stack already spoiled. */
  const groove = { id: 'half', name: 'Half', bpm: 90, timeSig: [4, 4], loopBars: 2, repeats: 2,
    sticking: 'off', events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: b % 2 ? ['HH'] : ['HH', 'KK'] })) };
  await loadUi({ extraFiles: {
    'half.json': JSON.stringify(groove),
    'user.json': JSON.stringify({ exercises: [{ id: 'half', name: 'Half', file: 'half.json', category: 'rock' }] }),
  } });
  globalThis.init();
  ticks(2);
  cc(CC.jogTurn, 2); cc(CC.jogClick, 127); cc(CC.jogClick, 127);  /* Rock & Pop */
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 1);                 /* its last groove: Half */
  cc(CC.jogClick, 127); ticks(2);                                  /* its ladder, on L0 */
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 400; i++) cc(CC.knob1, 1);                   /* as far as it goes */
  ticks(1);
  assert.ok(drawnText(1).includes('3/4'), 'the last bar that holds notes');
  cc(CC.record, 127);
  ticks(2);
  for (let k = 0; k < 4; k++) {
    const voices = k % 2 ? ['HH'] : ['HH', 'KK'];
    for (const v of voices) pad(PAD_OF[v], 80);
    for (const v of voices) pad(PAD_OF[v], 0);
    ticks(8);
  }
  const shown = drawnText(3);
  assert.ok(shown.includes('not kept') && shown.includes('100% 1st try'), shown.join('|'));
});

test('switching Kit back in Settings clears the L0 warning', async () => {
  await loadUi({ settings: { layout: 'sticking' } });
  globalThis.init();
  ticks(2);
  armL0();
  assert.ok(drawnText(2).includes('SET KIT TO KIT'));
  const SET = await import('../src/settings_def.mjs');
  const row = SET.ROWS.findIndex((r) => r.key === 'layout');
  shiftClick();
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 127);
  for (let i = 0; i < row; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);                          /* edit Kit */
  cc(CC.jogTurn, 1);                             /* sticking -> ... */
  cc(CC.jogTurn, 127);
  cc(CC.jogTurn, 127);                           /* clamp at the first value: kit */
  cc(CC.jogClick, 127);
  shiftClick();
  assert.ok(!drawnText(2).includes('SET KIT TO KIT'), 'the warning went with the kit');
  cc(CC.record, 127);
  ticks(2);
  stepThrough();
  assert.ok(drawnText(3).some((t) => /1st try/.test(t)), 'and the take runs');
});
