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
import * as PADMAP from '../src/padmap.mjs';
import * as PROG from '../src/progress.mjs';
import { VOICES } from '../src/kit.mjs';
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

/*
 * Every tip already read, as a learner who has met them: the welcome and the
 * first-visit cards stand in front of the screens most tests walk to. The
 * tests about them load with `tips: []`.
 */
const ALL_TIPS = ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island'];

async function loadUi({ extraFiles = {}, settings = null, dataFiles = {}, withLessons = false,
  tips = ALL_TIPS, walked = false } = {}) {
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
  /* The lesson cards stand before the steps they introduce, so only the tests
   * about them ship the file; the rest walk the path without them. */
  if (withLessons) {
    files['/data/UserData/schwung/modules/tools/drums-practice/lessons.json'] =
      readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8');
  }
  if (settings) {
    files['/data/UserData/schwung/modules/tools/drums-practice/settings.json'] =
      JSON.stringify({ version: 2, ...settings });
  }
  /* MENU's help, which every screen opens. */
  files['/data/UserData/schwung/modules/tools/drums-practice/help.json'] =
    readFileSync(new URL('../src/help.json', import.meta.url), 'utf8');
  /* The module's own data — progress.json, stats.json — as left by a session,
   * with the tips read unless the test says otherwise. A test that leaves
   * progress to be rebuilt from stats.json gets no progress file. */
  const data = { ...dataFiles };
  if (!('progress.json' in data) && !('stats.json' in data)) {
    /* Meet the pads walked, for the tests that begin past it: Continue's
     * first offer is otherwise the tour. */
    const p = PROG.emptyProgress();
    if (walked) PROG.recordTour(p, 'tour:pads', Date.now());
    data['progress.json'] = JSON.stringify({ ...JSON.parse(PROG.serialiseProgress(p)), tips });
  } else if (data['progress.json']) {
    try {
      const obj = JSON.parse(data['progress.json']);
      if (obj && obj.version === 2) {
        if (!obj.tips) obj.tips = tips;
        if (walked) {
          const p = PROG.emptyProgress();
          PROG.recordTour(p, 'tour:pads', Date.now());
          obj.items = { ...p.items, ...obj.items };
        }
        data['progress.json'] = JSON.stringify(obj);
      }
    } catch (e) { /* a damaged file stays damaged */ }
  }
  for (const [name, text] of Object.entries(data)) {
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
    .replace(/from '\.\/([a-z_/]+)\.mjs'/g,
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
 * Walk the list by name: from the list as it stands, highlight each label in
 * turn and open it, the last one opened too unless `{ open: false }` is last.
 * A label matches a row that is it or starts with it. Rows that move as the
 * tree grows cannot break a test that names where it is going.
 */
function goTo(...path) {
  const opts = typeof path[path.length - 1] === 'object' ? path.pop() : {};
  for (let i = 0; i < path.length; i++) {
    const m = globalThis.drumsPracticeMenu();
    assert.ok(m, `not on the list on the way to ${path[i]}`);
    const at = m.labels.findIndex((l) => l === path[i] || l.startsWith(path[i]));
    assert.ok(at >= 0, `no "${path[i]}" in ${m.title}: ${m.labels.join(' | ')}`);
    if (at !== m.cursor) cc(CC.jogTurn, at > m.cursor ? at - m.cursor : 128 - (m.cursor - at));
    if (i < path.length - 1 || opts.open !== false) cc(CC.jogClick, 127);
  }
}

/* Practice › Grooves › Rock & Pop, highlight on Rock backbeat — the third
 * groove, after First beat and the Eighth-note beat. */
const toFirstDrill = () => goTo('Practice', 'Grooves', 'Rock & Pop', 'Rock backbeat', { open: false });
/* Into its ladder, highlight on L1 — the first TIMED rung. L0 above it is the
 * untimed one, and has flows of its own. */
const toFirstRung = () => { toFirstDrill(); cc(CC.jogClick, 127); cc(CC.jogTurn, 1); };
/* Into the Quiz folder, highlight on its first drill. */
const toQuizzes = () => goTo('Quiz');
const cc = (n, v) => globalThis.onMidiMessageInternal([0xb0, n, v]);
const shiftClick = () => { cc(CC.shift, 127); cc(CC.jogClick, 127); cc(CC.shift, 0); };
const screenNow = () => globalThis.drumsPracticeScreen().screen;
/* Back to the list from a drill, a result, a quiz or a card: Back until it shows. */
function toList() {
  for (let i = 0; i < 6 && !globalThis.drumsPracticeMenu(); i++) cc(CC.back, 127);
  assert.ok(globalThis.drumsPracticeMenu(), `Back did not reach the list from ${screenNow()}`);
}
/* Up to the top of the list, the cursor on Continue. */
function toTop() {
  toList();
  for (let i = 0; i < 8 && globalThis.drumsPracticeMenu().title !== 'Drums'; i++) cc(CC.back, 127);
  const at = globalThis.drumsPracticeMenu().cursor;
  if (at) cc(CC.jogTurn, 128 - at);
}
/* Shift+click the highlighted row, and do one action of its sheet. */
function sheetPick(label) {
  shiftClick();
  const s = globalThis.drumsPracticeScreen();
  assert.equal(s.screen, 'sheet', 'Shift+click did not open the sheet');
  const at = s.sheet.indexOf(label);
  assert.ok(at >= 0, `no "${label}" in the sheet: ${s.sheet.join(' | ')}`);
  if (at) cc(CC.jogTurn, at);
  cc(CC.jogClick, 127);
}
/* Into a list, where the pads are the kit: at home they are the circles. */
function toKit() {
  goTo('Practice');
}
/* The Path list's Review folder: its last row — the first, Continue, may
 * read Review too. */
function toReview(open = true) {
  const m = globalThis.drumsPracticeMenu();
  const at = m.labels.lastIndexOf('Review');
  assert.ok(at > 0, `no Review: ${m.labels.join(' | ')}`);
  if (at !== m.cursor) cc(CC.jogTurn, at > m.cursor ? at - m.cursor : 128 - (m.cursor - at));
  if (open) cc(CC.jogClick, 127);
}
/* The Path as a list, cursor on its Continue row. */
function toPathList() {
  toTop();
  goTo('Learning Path');
  sheetPick('Show as list');
  const at = globalThis.drumsPracticeMenu().cursor;
  if (at) cc(CC.jogTurn, 128 - at);
}
/* Settings › a group: the editor with that group's rows. */
function toSettings(group = 'Practice') {
  toTop();
  goTo('Settings', group);
  assert.equal(screenNow(), 'settings');
}
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
  toKit();                /* pads are the kit in a list; at home they are circles */
  const before = log.params.length;
  pad(80, 100);
  globalThis.tick();
  const hits = log.params.slice(before).filter(isHit);
  assert.equal(hits.length, 1, 'the pad never reached the engine');
  assert.match(hits[0][1], /^\d+:100$/, `unexpected payload: ${hits[0][1]}`);
});

test('a pad sounds as its voice\'s GM note, in the engine and down a MIDI route alike', async () => {
  const KIT = await import('../src/kit.mjs');
  const pads = [[68, 'KK'], [69, 'SN'], [70, 'HH'], [PADMAP.padAt(3, 2), 'P1']];
  let { log } = await loadUi();
  globalThis.init();
  ticks(3);
  toKit();                /* pads are the kit in a list; at home they are circles */
  for (const [p, voice] of pads) {
    assert.equal(PADMAP.padVoice(p), voice, `MPC Classic pad ${p}`);
    const before = log.params.length;
    pad(p, 100);
    pad(p, 0);
    globalThis.tick();
    assert.equal(log.params.slice(before).filter(isHit)[0][1], `${KIT.gmOf(voice)}:100`, `${voice} to the engine`);
  }
  ({ log } = await loadUi({ settings: { midiOut: 1 } }));
  globalThis.init();
  ticks(3);
  toKit();                /* pads are the kit in a list; at home they are circles */
  for (const [p, voice] of pads) {
    const before = log.midi.length;
    pad(p, 100);
    pad(p, 0);
    ticks(2);
    const ons = log.midi.slice(before).filter((m) => (m[2] & 0xf0) === 0x90);
    assert.ok(ons.some((m) => m[3] === KIT.gmOf(voice)), `${voice} down the route`);
  }
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
    toList();
    ticks(2);
    for (let j = 0; j < i; j++) cc(CC.jogTurn, 1);
    cc(CC.jogClick, 127);
    ticks(6);
    cc(CC.record, 127);
    ticks(10);
    cc(CC.menu, 127);              /* its help, and closed again */
    ticks(2);
    cc(CC.menu, 127);
    shiftClick();                  /* a sheet on a list, Settings elsewhere */
    ticks(2);
    cc(CC.back, 127);
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
  /* Knobs change settings only on the Settings screen: open Settings ›
   * Practice, then knob 1 is its first row, Tempo. */
  toSettings('Practice');
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
   * a snare would be a stray every time and score nothing. On MPC Classic the
   * closed hat is the bottom row's third pad, 70, beside the snare. Eighths at
   * 84bpm are ~357ms, which is 14 ticks of 25ms.
   */
  const hat = PADMAP.padsForVoice('HH', PADMAP.DEFAULT_LAYOUT)[0];
  for (let i = 0; i < 1600; i++) {
    globalThis.__advance(25);
    if (i % 14 === 0) { pad(hat, 100); pad(hat, 0); }
    globalThis.tick();
  }
  globalThis.onUnload();
  const stats = log.writes['/data/UserData/schwung/modules/tools/drums-practice/stats.json'];
  assert.ok(stats, 'nothing was written');
  const parsed = JSON.parse(stats);
  assert.ok(parsed.records.length >= 1, 'a finished practice recorded no score');
});

test('the top is home: five circles, the chosen one named, the keys under it; no Continue', async () => {
  await loadUi({ walked: true });
  globalThis.init();
  ticks(3);
  const drawn = drawnText(2);
  for (const t of ['DRUMS', 'Learning Path', 'JOG choose']) {
    assert.ok(drawn.includes(t), `home does not show ${t}: ${drawn.join('|')}`);
  }
  assert.deepEqual(globalThis.drumsPracticeMenu().labels, ['Learning Path', 'Practice', 'Quiz', 'Progress', 'Settings']);
  assert.equal(globalThis.drumsPracticeScreen().home.selected, 0, 'Path is chosen first');
  goTo('Practice');
  assert.ok(drawnText(1).includes('CLICK open  BACK up'), 'a folder says Back goes up');
  assert.deepEqual(globalThis.drumsPracticeMenu().labels, ['Subdivisions', 'Grooves', 'Rudiments', 'Random']);
});

test('Back walks up one folder at a time, and leaves only from the top', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();                            /* three folders deep */
  cc(CC.back, 127); ticks(1);
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

test('the Ladder and the Clock are offered on a drill with a tempo — a groove, not a quiz', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  shiftClick();
  assert.deepEqual(globalThis.drumsPracticeScreen().sheet, ['Practise: Ladder', 'Practise: Clock', 'Settings...']);
  assert.ok(drawnText(1).includes('ROCK BACKBEAT'), 'the sheet is titled with its row');
  cc(CC.back, 127);
  toTop();
  goTo('Quiz', { open: true });
  shiftClick();
  assert.deepEqual(globalThis.drumsPracticeScreen().sheet, ['Settings...']);
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
  assert.ok(drawnText().some((t) => t === 'scrub'), 'Back did not restart the drill');
  assert.equal(log.exited || 0, 0);

  cc(CC.back, 127);                 /* ready -> the folder it came from */
  ticks(4);
  /* The groove's own folder, the groove on the highlight: its rungs are on
   * the ready screen now. */
  assert.ok(drawnText().some((t) => /ROCK & POP/.test(t)), 'Back did not land on the folder');
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
  toSettings('Practice');
  ticks(2);

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
  toSettings('Practice');
  ticks(2);

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
  toSettings('Practice');
  ticks(2);
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
  /* A user drill with no shipped category lands in Practice › Other, last. */
  goTo('Practice', 'Other');
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

  assert.ok(drawnText().some((t) => t === 'scrub'), 'the control box is not on screen');
  const atHome = screen.pixels.slice();

  /* 36 clicks to the bar; a bar's worth should move the chart. */
  for (let i = 0; i < 40; i++) cc(CC.knob1, 1);
  ticks(3);
  assert.ok(screen.pixels.some((p, i) => p !== atHome[i]), 'the knob is dead on READY');
  assert.ok(!drawnText().some((t) => t === 'scrub'),
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
  assert.ok(!drawnText().some((t) => t === 'scrub'));
  for (let i = 0; i < 80; i++) cc(CC.knob1, 127);   /* 127 decodes as -1 */
  ticks(2);
  assert.ok(drawnText().some((t) => t === 'scrub'), 'the box never came back');
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
  /* The chart, above the bottom line: that is the level and the keys on the
   * ready screen, the progress bar once playing. */
  let differing = 0;
  for (let i = 0; i < 56 * 128; i++) if (scrubbed[i] !== screen.pixels[i]) differing++;
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
    settings: () => { toSettings('Sound'); ticks(2); },
    progress: () => { goTo('Progress'); ticks(2); },
    quiz: () => { toQuizzes(); cc(CC.jogClick, 127); ticks(2); },
    sheet: () => { shiftClick(); ticks(2); },
    help: () => { startFirstDrill(); ticks(10); cc(CC.menu, 127); ticks(2); },
    welcome: () => { goTo('Settings', 'Help', 'Welcome again'); ticks(2); },
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
  toKit();                /* pads are the kit in a list; at home they are circles */
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
  toKit();                /* pads are the kit in a list; at home they are circles */
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
  toKit();                /* pads are the kit in a list; at home they are circles */
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
  const hh = P.padsForVoice('HH', 'mpc').slice().sort((a, b) => a - b);
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
  const hh = new Set(P.padsForVoice('HH', 'mpc'));
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
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  sheetPick('Practise: Clock'); ticks(2);          /* Rock backbeat L1, on the Clock */
  assert.match(log.announces.join('|'), /Clock: Rock backbeat/);
  cc(CC.back, 127); ticks(1);                      /* the list, on the groove */
  cc(CC.jogClick, 127); cc(CC.jogTurn, 1); ticks(2);   /* a plain L1 again */
  cc(CC.record, 127);
  const drawn = drawnText(200);
  assert.ok(!drawn.some((t) => /LISTEN|ON YOUR OWN/.test(t)), 'the Clock banner followed into a plain drill');
});

/* ---- Regressions from the 1.2.0 review, driven end to end ------------------- */

const SETTINGS_FILE = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
const knob = (k, d) => cc(CC.knob1 + k, d);
/* Arm the first rung of the first groove: Grooves › Rock & Pop › Rock backbeat › L1. */
function armFirstRung() {
  toFirstRung();
  ticks(2);
  cc(CC.jogClick, 127);
  ticks(2);
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
  assert.ok(ready.includes('practise') && !ready.some((t) => /REC again/.test(t)),
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
  assert.ok(!back.some((t) => /SETTINGS/.test(t)) && back.includes('practise'),
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
  toSettings('Practice');
  globalThis.onMidiMessageInternal([0x90, 9, 127]);   /* jog touch */
  knob(0, 1);                                         /* row 0 is Tempo, if the cursor stayed */
  for (let i = 0; i < 5; i++) cc(CC.jogTurn, 1);      /* row 5, Strict: the second page */
  for (let i = 0; i < 3; i++) knob(1, 1);             /* knob 2 is row 5 on that page */
  ticks(2);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[SETTINGS_FILE]);
  assert.equal(saved.bpm, 91, 'jog touch must not move the cursor off Tempo');
  assert.equal(saved.strictness, 'tight', 'three turns of one knob, one row');
  assert.equal(saved.view, 'grid', 'and not the rows around it');
  assert.equal(saved.sticking, 'off');
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
  toFirstDrill();
  sheetPick('Practise: Ladder');
  ticks(2);
  assert.match(log.announces.join(' | '), /Ladder: .*, from 65/);
});

test('the Clock ends by itself on a result', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  sheetPick('Practise: Clock');
  ticks(2);
  cc(CC.record, 127);
  /* Four rounds of 4 bars on, 4 off, at 92bpm: about 85 seconds. */
  assert.ok(runUntil(/BACK start/, 5000), 'the Clock never ended');
});

test('Menu is help over a run: the take pauses, the Record light goes out, Menu again goes back', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  startFirstDrill();
  ticks(40);
  cc(CC.menu, 127);
  ticks(4);
  const record = log.buttons.filter(([c]) => c === CC.record);
  assert.equal(record[record.length - 1][1], 0, 'the Record light was left burning');
  const shown = drawnText(2);
  assert.ok(shown.some((t) => /^1\/\d+$/.test(t)), `help opened scrolled: ${shown.join('|')}`);
  assert.ok(shown.includes('A take, under way.'), 'what the screen is comes first');
  assert.ok(shown.includes('HELP: PLAYING'), shown.join('|'));
  assert.ok(shown.includes('JOG scroll'), 'the help has its own hint line');
  const help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('REC    pause') && help.includes('SHIFT+CLICK settings'), help.join('|'));
  assert.ok(help.includes('PLAYING'), 'the Playing topic of help.json is on it');
  cc(CC.jogTurn, 3);
  assert.ok(drawnText(1).some((t) => /^4\/\d+$/.test(t)), 'the jog scrolls the help');
  cc(CC.menu, 127);
  ticks(2);
  assert.equal(screenNow(), 'running');
  assert.ok(drawnText(2).includes('PAUSED'), 'the take was not paused under the help');
});

test('Menu is help everywhere, and Back closes it where it was opened', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', { open: false });
  cc(CC.menu, 127);
  let help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('LEARNING PATH'), 'a row of the Learning Path explains it');
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'Back from help is where it was');
  toTop();
  goTo('Quiz');
  cc(CC.menu, 127);
  help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('QUIZ') && help.includes('CLICK  open'), help.join('|'));
  cc(CC.back, 127);
  cc(CC.jogClick, 127);             /* a quiz */
  ticks(2);
  cc(CC.menu, 127);
  assert.ok(drawnText(1).includes('HELP: QUIZ'));
  cc(CC.back, 127);
  assert.equal(screenNow(), 'quiz');
});

test('a broken user.json is reported, and the shipped drills still load', async () => {
  await loadUi({ extraFiles: { 'user.json': '{ "exercises": [ oops' } });
  globalThis.init();
  const shown = drawnText(2);
  assert.ok(shown.some((t) => /BAD USER\.JSON/.test(t)), shown.join('|'));
  assert.ok(shown.some((t) => /^Learning Path$/.test(t)), 'home is there underneath');
});

/* ---- the Learning Path and progress ---------------------------------------- */

const DATA = '/data/UserData/schwung/modules/tools/drums-practice/';
/* Easy to play exactly: no count-in, no click, hands not judged. */
const PLAIN = { countIn: 0, click: false, sticking: 'off' };
const SNARE = 0;
let snarePad = 0;
async function snare() {
  if (!snarePad) snarePad = (await import('../src/padmap.mjs')).padsForVoice('SN', 'mpc')[SNARE];
  return snarePad;
}

/* Continue: Play on the Path's map. */
function continuePath() {
  toTop();
  goTo('Learning Path');
  cc(CC.play, 127);
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
  const { log } = await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  assert.ok(drawnText(2).some((t) => /Quart/.test(t)), 'Continue did not open Quarters');
  /* The first step asks for quarters at 60% of their 100: Speed is set to it. */
  playQuarters(sn, 60);
  const shown = drawnText(2);
  assert.ok(shown.includes('CLEAN') && shown.includes('60 bpm'), `not clean: ${shown.join('|')}`);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.equal(saved.items['subdiv:quarters'].best, 60, 'clean at the step\'s target');
  assert.equal(saved.items['subdiv:quarters'].done, 0, 'a ✓ is still 100%: the spiral comes back for it');
  const settingsSaved = JSON.parse(log.writes[`${DATA}settings.json`]);
  assert.equal(settingsSaved.bpm, 100, 'Tempo is the drill\'s target');
  assert.equal(settingsSaved.speed, 60, 'Speed is the step\'s');
});

test('leaving the path for the library gives back your own Speed', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, speed: 90 } });
  globalThis.init();
  ticks(2);
  continuePath();                  /* Quarters, at the step's 60% */
  toTop();
  toFirstRung();                   /* Practice › Grooves › Rock & Pop › Rock backbeat › L1 */
  cc(CC.jogClick, 127);
  ticks(2);
  globalThis.onUnload();
  assert.equal(JSON.parse(log.writes[SETTINGS_FILE]).speed, 90);
  assert.match(log.announces.join('|'), /83 bpm|Rock backbeat/);
});

test('Click on a path result opens the next step of the track', async () => {
  await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 60);
  cc(CC.jogClick, 127);
  ticks(2);
  /* Time has nothing more installed in this stage: on to the track left longest. */
  const shown = drawnText(2);
  assert.ok(shown.some((t) => /First bea/.test(t)) && shown.includes('own pace'), `not on to the first beat: ${shown.join('|')}`);
});

test('a take short of the step\'s target reads as its speed; the row shows it against the target', async () => {
  await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  knob(7, 127);                     /* Speed 60 -> 55 */
  knob(7, 127);                     /* -> 50 */
  ticks(2);
  playQuarters(sn, 50);
  const shown = drawnText(2);
  assert.ok(shown.includes('CLEAN') && shown.includes('50 bpm'), shown.join('|'));
  toTop();
  ticks(2);
  /* Path › 0 Hello, kit › Time: Quarters reads 50 of its 60. */
  goTo('Learning Path', '0 Hello, kit', 'Time');
  ticks(2);
  assert.ok(drawnText(2).includes('50/60'), `the row does not show the speed: ${drawnText(2).join('|')}`);
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

test('an even take of an accented drill counts, and its dynamics say the accents were soft', async () => {
  /* The reported take, through the real UI: every note hit on time at one
   * velocity, so no accent stood out. The notes were right, so it is
   * learned; the dynamics are their own score beside it, with what to fix. */
  const { log } = await loadUi({ settings: { ...PLAIN, bpm: 100 } });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  /* Practice › Subdivisions › Eighths, at 100: its written tempo. */
  goTo('Practice', 'Subdivisions', 'Eighths');
  ticks(2);
  playEighths(sn, 100, () => 70);
  let shown = drawnText(2);
  assert.ok(shown.includes('LEARNED'), shown.join('|'));
  assert.ok(!shown.includes('NOT CLEAN'), shown.join('|'));
  assert.ok(shown.includes('dyn 0%'), shown.join('|'));
  assert.ok(shown.some((t) => /^\d+ soft 70<85$/.test(t)), shown.join('|'));
  /* The same take with the accents lifted: full marks, and no advice. */
  playEighths(sn, 100, (i) => (i % 2 ? 70 : 90));
  shown = drawnText(2);
  assert.ok(shown.includes('dyn 100%'), shown.join('|'));
  assert.ok(!shown.some((t) => / soft /.test(t)), shown.join('|'));
  globalThis.onUnload();
  const stats = JSON.parse(log.writes[`${DATA}stats.json`]).records;
  const even = stats.find((r) => r.d.startsWith('drill:subdiv:eighths') && r.dy > 0);
  assert.ok(even, 'the record does not say what its errors were');
  assert.equal(even.av, 70);
  assert.equal(even.an, 85);
  assert.equal(even.dp, 0);
  assert.equal(even.err, 0, 'a soft accent is no error of the notes');
  const progress = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.equal(progress.version, 2);
  assert.equal(progress.items['subdiv:eighths'].dyn, 100);
});

test('a Study take is not counted', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, study: true }, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 60);
  assert.ok(drawnText(2).includes('STUDY'));
  globalThis.onUnload();
  const saved = log.writes[`${DATA}progress.json`];
  assert.ok(!saved || !JSON.parse(saved).items['subdiv:quarters']);
});

test('I know this: skip on Continue moves it on to the next track', async () => {
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('Quarters'));
  sheetPick('I know this: skip');
  ticks(1);
  assert.match(log.announces.join('|'), /Skipped Quarters/);
  assert.ok(drawnText(1).includes('FIRST BEAT L0'), 'skipping did not move on');
  goTo('0 Hello, kit', 'Time', 'Quarters', { open: false });
  sheetPick('Undo skip');
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('Quarters'), 'the skip was not taken back');
});

test('a folder skips everything in it from its sheet, and Undo skip takes it back', async () => {
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', 'Ear', { open: false });
  ticks(1);
  assert.ok(!globalThis.drumsPracticeMenu().labels.some((l) => /^Skip/.test(l)), 'a skip row among the content');
  sheetPick('I know it all: skip');
  ticks(1);
  assert.match(log.announces.join('|'), /Skipped 2/);
  shiftClick();
  assert.deepEqual(globalThis.drumsPracticeScreen().sheet, ['Undo skip', 'Show as list', 'Settings...']);
  cc(CC.jogClick, 127);
  assert.match(log.announces.join('|'), /Skips taken back/);
});

test('a stage\'s sheet starts the path there, and its Settings... opens Settings over the list', async () => {
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '2 Sixteenths', { open: false });
  shiftClick();
  assert.deepEqual(globalThis.drumsPracticeScreen().sheet,
    ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Show as list', 'Settings...']);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  assert.match(log.announces.join('|'), /The path starts at stage 2/);
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('Sixteenths'), 'Continue is not in stage 2');
  goTo('2 Sixteenths', { open: false });
  sheetPick('Settings...');
  assert.equal(globalThis.drumsPracticeMenu().title, 'Settings');
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'Back from Settings is where it came from');
});

test('Test out: checkpoint plays the stage\'s checkpoint', async () => {
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', { open: false });
  sheetPick('Test out: checkpoint');
  ticks(2);
  assert.equal(screenNow(), 'ready');
  assert.match(log.announces.join('|'), /First beat.* ready/);
});

test('Settings › Path: a track switched off, and Continue no longer offers it', async () => {
  await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Settings', 'Learning Path', 'Tracks');
  ticks(1);
  assert.ok(drawnText(1).includes('on'));
  goTo('Time');                   /* Time: off */
  ticks(1);
  assert.ok(drawnText(1).includes('off'), drawnText(1).join('|'));
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('FIRST BEAT L0'), drawnText(1).join('|'));
});

test('Settings › Path: the short ladder, and starting at a later stage', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Settings', 'Learning Path', 'Rungs');   /* full -> short */
  goTo('Start at');                    /* Stage 0 -> Stage 1 */
  ticks(1);
  const shown = drawnText(1);
  assert.ok(shown.includes('short') && shown.includes('Stage 1'), shown.join('|'));
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('Eighths'), drawnText(1).join('|'));
});

/* Practise quarters at `bpm`, hitting only every other beat: a take that
 * does not count. From the ready screen or a result, Record starts it. */
function playHalf(snarePadNo, bpm, beats = 40) {
  cc(CC.record, 127);
  const beatMs = 60000 / bpm;
  let t = 0;
  let next = 0;
  let k = 0;
  for (let i = 0; i < (beats * beatMs) / 25 + 40; i++) {
    if (t >= next) { if (k % 2 === 0) { pad(snarePadNo, 100); pad(snarePadNo, 0); } k++; next += beatMs; }
    globalThis.__advance(25);
    t += 25;
    globalThis.tick();
  }
}

test('stuck on a step: a hint after three failed takes, parked after six', async () => {
  const { log } = await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  for (let n = 1; n <= 6; n++) {
    playHalf(sn, 60);
    const shown = drawnText(2);
    assert.ok(shown.includes('NOT CLEAN'), shown.join('|'));
    if (n < 3) assert.ok(shown.includes('CLICK next  REC again'), `take ${n}: ${shown.join('|')}`);
    else if (n < 6) assert.ok(shown.includes('stuck? knob 8 slower'), `take ${n}: ${shown.join('|')}`);
    else assert.ok(shown.includes('parked: CLICK other'), `take ${n}: ${shown.join('|')}`);
  }
  toPathList();
  ticks(1);
  assert.ok(drawnText(1).includes('FIRST BEAT L0'), 'Continue still offers the parked step');
  globalThis.onUnload();
  assert.ok(JSON.parse(log.writes[`${DATA}progress.json`]).items['subdiv:quarters'].park > 0);
});

/* ---- pad layouts and the Pad map ------------------------------------------- */

/* Settings › Pads, then its Pad map row. */
async function toPadMap() {
  const SET = await import('../src/settings_def.mjs');
  toSettings('Pads');
  const row = SET.rowsIn('pads').findIndex((r) => r.key === 'padMap');
  for (let i = 0; i < row; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(1);
}

test('the Pad map names every pad, sounds it, and steps through the layouts', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  await toPadMap();
  let shown = drawnText(1);
  assert.ok(shown.includes('MPC Classic') && shown.includes('PAD hear CLICK edit'), shown.join('|'));
  assert.equal(shown.filter((t) => /^[A-Z0-9]{2}$/.test(t)).length, 32);
  const before = log.params.length;
  pad(68, 100); pad(68, 0);
  ticks(1);
  assert.ok(drawnText(1).includes('Kick'), 'the pad was not named');
  assert.ok(log.params.slice(before).some(isHit), 'nor heard');
  cc(CC.jogTurn, 1);
  ticks(1);
  assert.ok(drawnText(1).includes('MPC Family Rows'), drawnText(1).join('|'));
  cc(CC.back, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('PADS'), 'Back returns to Settings › Pads');
  globalThis.onUnload();
  assert.equal(JSON.parse(log.writes[SETTINGS_FILE]).layout, 'family');
});

test('Click on a preset makes Custom a copy of it; an edit lands on both halves; Back saves pads.json', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  await toPadMap();
  cc(CC.jogClick, 127);           /* edit a copy of MPC Classic */
  ticks(1);
  assert.ok(drawnText(1).includes('Custom'), drawnText(1).join('|'));
  pad(68, 100); pad(68, 0);       /* pick the kick pad */
  ticks(1);
  assert.ok(drawnText(1).includes('JOG sound KNOB1 both'));
  cc(CC.jogTurn, 1);              /* KK -> the next voice in staff order: K2 */
  ticks(1);
  assert.ok(drawnText(1).includes('Kick 2'), drawnText(1).join('|'));
  cc(CC.back, 127);
  ticks(1);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes['/data/UserData/schwung/modules/tools/drums-practice/pads.json']);
  assert.equal(saved.pair, 'twin');
  assert.deepEqual(saved.rows[3].split(' ').slice(0, 1), ['K2']);
  assert.equal(saved.rows[3].split(' ')[4], 'K2', 'and its twin under the right hand');
  assert.equal(JSON.parse(log.writes[SETTINGS_FILE]).layout, 'custom');
  assert.equal(log.writes['/data/UserData/schwung/modules/tools/drums-practice/pads.bak.json'],
    log.writes['/data/UserData/schwung/modules/tools/drums-practice/pads.json'], 'and its backup');
});

test('a Custom edit survives closing straight from the Pad map', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  await toPadMap();
  cc(CC.jogClick, 127);
  pad(68, 100); pad(68, 0);
  cc(CC.jogTurn, 1);
  cc(CC.shift, 127); cc(CC.back, 127); cc(CC.shift, 0);   /* close, not Back */
  ticks(40);
  globalThis.onUnload();
  const saved = log.writes['/data/UserData/schwung/modules/tools/drums-practice/pads.json'];
  assert.ok(saved, 'the edit was lost');
  assert.equal(JSON.parse(saved).rows[3].split(' ')[0], 'K2');
});

test('knob 1 on Custom edits one half only', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  await toPadMap();
  cc(CC.jogClick, 127);
  pad(68, 100); pad(68, 0);
  knob(0, 1);                     /* both -> one */
  ticks(1);
  assert.ok(drawnText(1).includes('one'));
  cc(CC.jogTurn, 1);
  cc(CC.back, 127);
  globalThis.onUnload();
  const saved = JSON.parse(log.writes['/data/UserData/schwung/modules/tools/drums-practice/pads.json']);
  assert.deepEqual([saved.rows[3].split(' ')[0], saved.rows[3].split(' ')[4]], ['K2', 'KK']);
});

test('a Custom from pads.json is what the pads play; a broken one is said and falls back', async () => {
  const rows = ['CR CR CR CR CR CR CR CR', 'HH HH HH HH HH HH HH HH', 'SN SN SN SN SN SN SN SN', 'SH KK KK KK KK KK KK KK'];
  let loaded = await loadUi({ settings: { layout: 'custom' },
    dataFiles: { 'pads.json': JSON.stringify({ version: 1, pair: 'twin', rows }) } });
  globalThis.init();
  ticks(2);
  toKit();                /* pads are the kit in a list; at home they are circles */
  let before = loaded.log.params.length;
  pad(68, 100); pad(68, 0);
  globalThis.tick();
  assert.equal(loaded.log.params.slice(before).filter(isHit)[0][1], '70:100', 'the shaker, as pads.json says');
  loaded = await loadUi({ settings: { layout: 'custom' }, dataFiles: { 'pads.json': '{"rows": 3}' } });
  globalThis.init();
  ticks(2);
  toKit();                /* pads are the kit in a list; at home they are circles */
  assert.ok(drawnText(1).includes('BAD PADS.JSON'), drawnText(1).join('|'));
  before = loaded.log.params.length;
  pad(68, 100); pad(68, 0);
  globalThis.tick();
  assert.equal(loaded.log.params.slice(before).filter(isHit)[0][1], '36:100', 'MPC Classic until it is saved');
});

test('a pads.json emptied by a save cut short is read from its backup, unannounced', async () => {
  const rows = ['CR CR CR CR CR CR CR CR', 'HH HH HH HH HH HH HH HH', 'SN SN SN SN SN SN SN SN', 'SH KK KK KK KK KK KK KK'];
  const loaded = await loadUi({ settings: { layout: 'custom' },
    dataFiles: { 'pads.json': '', 'pads.bak.json': JSON.stringify({ version: 1, pair: 'twin', rows }) } });
  globalThis.init();
  ticks(2);
  toKit();                /* pads are the kit in a list; at home they are circles */
  assert.ok(!drawnText(1).includes('BAD PADS.JSON'), drawnText(1).join('|'));
  const before = loaded.log.params.length;
  pad(68, 100); pad(68, 0);
  globalThis.tick();
  assert.equal(loaded.log.params.slice(before).filter(isHit)[0][1], '70:100', 'the backup\'s shaker');
});

test('Flip puts the kick under the left hand\'s right finger', async () => {
  const { log } = await loadUi({ settings: { flip: true } });
  globalThis.init();
  ticks(2);
  toKit();                /* pads are the kit in a list; at home they are circles */
  const before = log.params.length;
  pad(PADMAP.padAt(0, 3), 100); pad(PADMAP.padAt(0, 3), 0);
  globalThis.tick();
  assert.equal(log.params.slice(before).filter(isHit)[0][1], '36:100');
});

test('a drum quiz under Sticking plays on MPC Classic, so every prompt can be answered', async () => {
  const { log } = await loadUi({ settings: { layout: 'sticking', roundSize: 10 } });
  globalThis.init();
  ticks(2);
  openQuiz(0);                     /* Guess: drum */
  const pads = PADMAP.layoutVoices('mpc').map((v) => PADMAP.padsForVoice(v, 'mpc')[0]);
  let shown = [];
  for (let k = 0; k < 600 && !shown.some((t) => /score \d+%/.test(t)); k++) {
    const p = pads[k % pads.length];
    pad(p, 100); pad(p, 0);
    ticks(25);
    shown = drawnText(1);
  }
  assert.ok(shown.some((t) => /score \d+%/.test(t)), 'the round could not be finished on Sticking');
  assert.ok(log.writes);
});

test('a drill a layout cannot fully play names the drum on the ready screen', async () => {
  /* Chromatic is GM 36-51 and has no cowbell, which songo's bell is on. */
  await loadUi({ settings: { layout: 'gm' }, extraFiles: {
    'bell.json': JSON.stringify({ id: 'bell', name: 'Bell', bpm: 90, timeSig: [4, 4], loopBars: 1, repeats: 2,
      sticking: 'off', events: [{ beat: 0, voices: ['P1', 'KK'] }, { beat: 1, voices: ['P1'] }] }),
    'user.json': JSON.stringify({ exercises: [{ id: 'bell', name: 'Bell', file: 'bell.json', category: 'latin' }] }),
  } });
  globalThis.init();
  ticks(2);
  goTo('Practice', 'Grooves', 'Latin & World');
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 1);   /* its last groove: Bell */
  cc(CC.jogClick, 127); ticks(2);                    /* its ready screen, on L0 */
  cc(CC.jogTurn, 1); ticks(2);                       /* L1, the timed rung with the bell */
  assert.ok(drawnText(2).includes('NO P1 ON PADS'), drawnText(2).join('|'));
});

/* ---- lesson cards ---------------------------------------------------------- */

test('a lesson card stands before a new concept, and Click is all it costs', async () => {
  const { log } = await loadUi({ settings: PLAIN, withLessons: true, walked: true });
  globalThis.init();
  ticks(2);
  continuePath();
  /* Entering the first stage: its card, then the step's two. */
  let shown = drawnText(1);
  assert.ok(shown.includes('0 Hello, kit'), `no stage card: ${shown.join('|')}`);
  assert.ok(shown.includes('JOG page  CLICK next'), shown.join('|'));
  cc(CC.jogClick, 127); ticks(1);
  assert.ok(drawnText(1).includes('The pulse'), drawnText(1).join('|'));
  cc(CC.jogClick, 127); ticks(1);
  shown = drawnText(1);
  assert.ok(shown.includes('Your result') && shown.some((t) => /CLICK start/.test(t)), shown.join('|'));
  cc(CC.jogClick, 127); ticks(2);
  assert.ok(drawnText(2).some((t) => /Quart/.test(t)), 'Click on the last card did not open the step');
  /* Read once, never again: Continue goes straight to the step. */
  toList(); ticks(1);
  cc(CC.play, 127); ticks(2);                  /* Continue: Play on the map */
  assert.ok(drawnText(2).some((t) => /Quart/.test(t)), 'a card read came back');
  globalThis.onUnload();
  const seen = JSON.parse(log.writes[`${DATA}progress.json`]).path.seen;
  assert.deepEqual(seen, ['stage-0', 'pulse', 'result']);
});

test('Back from a card returns to the list and marks nothing read; Intros off shows none', async () => {
  await loadUi({ settings: PLAIN, withLessons: true, walked: true });
  globalThis.init();
  ticks(2);
  continuePath();
  cc(CC.back, 127); ticks(1);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'Back did not return to the map');
  cc(CC.play, 127); ticks(1);
  assert.ok(drawnText(1).includes('0 Hello, kit'), 'the card was marked read by Back');
  cc(CC.back, 127);
  toTop();
  /* Settings › Path › Intros: new -> always -> off. */
  goTo('Settings', 'Learning Path', 'Intros');
  goTo('Intros');
  ticks(1);
  assert.ok(drawnText(1).includes('off'), drawnText(1).join('|'));
  continuePath();
  ticks(2);
  assert.ok(drawnText(2).some((t) => /Quart/.test(t)), 'Intros off still showed a card');
});

test('Play on a card skips the reading and hears the practice', async () => {
  const { log } = await loadUi({ settings: PLAIN, withLessons: true, walked: true });
  globalThis.init();
  ticks(2);
  continuePath();
  cc(CC.play, 127);
  ticks(2);
  assert.ok(log.buttons.some(([cc, c]) => cc === CC.play && c === 126), 'not listening');
  globalThis.onUnload();
  assert.equal(JSON.parse(log.writes[`${DATA}progress.json`]).path.seen.length, 3);
});

test('a stage\'s Lessons row reads its cards again, the jog turning their pages', async () => {
  await loadUi({ settings: PLAIN, withLessons: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', 'Lessons');
  ticks(1);
  assert.ok(drawnText(1).includes('JOG page  CLICK next'), drawnText(1).join('|'));
  cc(CC.jogTurn, 1);              /* a one-page card stays on its page */
  ticks(1);
  const done = () => drawnText(1).some((t) => /CLICK done/.test(t));
  for (let i = 0; i < 10 && !done(); i++) { cc(CC.jogClick, 127); ticks(1); }
  assert.ok(done());
  cc(CC.jogClick, 127); ticks(20);   /* the avatar finishes its walk to the hut */
  assert.ok(drawnText(1).includes('Lessons'), `not back in the stage folder: ${drawnText(1).join('|')}`);
});

test('Path › Review lists what is due, and opens it; with nothing due there is no Review', async () => {
  const day = 86400;
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 2, items: { flam: {
    best: 100, bpm: 70, plays: 1, t: now - 3 * day, done: now - 3 * day, skip: 0,
    rep: { due: now - day, step: 0, at: 0, ok: false }, h: [],
  } } };
  await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  sheetPick('Show as list');                         /* Review is no island: it is in the list */
  toReview(false);                                   /* the last row, after the stages */
  ticks(1);
  assert.ok(drawnText(1).includes('1 due'), 'the due count is not on the row');
  cc(CC.jogClick, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('Flam'));
  cc(CC.jogClick, 127);
  ticks(2);
  assert.ok(drawnText(2).some((t) => /Flam/.test(t)) && drawnText(1).some((t) => /bars|\d+\/\d+/.test(t)),
    'the review did not arm its drill');
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  assert.ok(!globalThis.drumsPracticeMenu().labels.includes('Review'), 'an empty Review is shown');
});

test('Continue alternates a due review with the next step, one each', async () => {
  const day = 86400;
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 2, items: { flam: {
    best: 100, bpm: 70, plays: 1, t: now - 3 * day, done: now - 3 * day, skip: 0,
    rep: { due: now - day, step: 0, at: 0, ok: false }, h: [],
  } } };
  const { log } = await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) }, walked: true });
  globalThis.init();
  ticks(2);
  toPathList();
  assert.equal(globalThis.drumsPracticeMenu().labels[0], 'Review', 'a due review comes first');
  assert.ok(drawnText(1).includes('Flam'));
  shiftClick();
  assert.deepEqual(globalThis.drumsPracticeScreen().sheet, ['Show as map', 'Settings...'], 'a review is not skipped');
  cc(CC.back, 127);
  cc(CC.jogClick, 127);
  ticks(2);
  assert.match(log.announces.join('|'), /Review: Flam/);
  assert.equal(screenNow(), 'ready');
  toList();
  assert.equal(globalThis.drumsPracticeMenu().labels[0], 'Continue', 'then a new step');
  assert.ok(drawnText(1).includes('Quarters'));
  cc(CC.jogClick, 127);
  ticks(2);
  toList();
  assert.equal(globalThis.drumsPracticeMenu().labels[0], 'Review', 'and the review again');
});

test('Progress lists the tracks and what was played, and opens a chart', async () => {
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 2, items: { 'flam-tap': {
    best: 85, bpm: 61, plays: 2, t: now, done: 0, skip: 0, rep: null,
    h: [[now - 60, 70, 95, 20, 1, -1], [now, 85, 93, 18, 1, -1]],
  } } };
  await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  goTo('Progress');
  ticks(1);
  const list = drawnText(1);
  for (const t of ['PROGRESS', 'Overall', 'Time', 'Hands', 'Grooves', 'CLICK chart  BACK up']) {
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
  assert.ok(ear.includes('EAR') && ear.some((t) => /learned of 8/.test(t)), ear.join('|'));
  cc(CC.back, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('PROGRESS'), 'Back from a chart returns to the list');
});

test('the overview draws drills learned over time', async () => {
  const now = Math.round(Date.now() / 1000);
  const learned = (t) => ({ best: 100, bpm: 70, plays: 1, t, done: t, skip: 0, rep: null, h: [] });
  const progress = { version: 2, items: {
    'flam-tap': learned(now - 86400 * 3), flam: learned(now - 86400), 'rock-backbeat:l3': learned(now),
  } };
  const { screen } = await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  goTo('Progress');
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

test('a progress.json of version 1 is set aside and rebuilt from stats, judged anew', async () => {
  /* `flam` was learned long ago: its takes have been trimmed from stats.json. */
  const v1 = JSON.stringify({ version: 1, items: { 'subdiv:eighths': { best: 0, plays: 1, h: [] },
    flam: { best: 100, bpm: 70, plays: 12, t: 500, done: 400, h: [] } } });
  /* An eighths take with every note on time but its accents soft: under
   * version 1 it was not clean (err counted the dynamics); its breakdown says
   * the errors were all dynamics, so today it counts. */
  const stats = { version: 1, records: [
    { t: 1000, d: 'drill:subdiv:eighths:normal:strict', bpm: 100, sd: 9, n: 32, err: 8, tot: 32,
      st: 0, sk: 0, dy: 8, av: 70, an: 85 },
  ] };
  const { log } = await loadUi({ dataFiles: { 'progress.json': v1, 'stats.json': JSON.stringify(stats) } });
  globalThis.init();
  ticks(2);
  globalThis.onUnload();
  assert.equal(log.writes[`${DATA}progress.v1.json`], v1, 'the old file is kept whole');
  assert.equal(log.writes[`${DATA}progress.bad.json`], undefined, 'an old file is not a damaged one');
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.equal(saved.version, 2);
  assert.equal(saved.items['subdiv:eighths'].best, 100);
  assert.ok(saved.items['subdiv:eighths'].done, 'a take that failed only on dynamics is learned');
  assert.equal(saved.items.flam.done, 400, 'a ✓ the stats log no longer holds survives the update');
});

test('a damaged progress.json is kept aside and the backup read', async () => {
  const good = JSON.stringify({ version: 2, items: { flam: { best: 90, plays: 1, h: [] } } });
  const { log } = await loadUi({ dataFiles: { 'progress.json': '{"items": {trunc',
    'progress.bak.json': good } });
  globalThis.init();
  ticks(2);
  assert.equal(log.writes[`${DATA}progress.bad.json`], '{"items": {trunc');
  goTo('Progress');
  for (let i = 0; i < 5; i++) cc(CC.jogTurn, 1);   /* past the overviews */
  ticks(1);
  assert.ok(drawnText(1).includes('90%'), 'the backup was not read');
});

test('an Ear step records its round, and Click goes on to the next quiz', async () => {
  const PM = await import('../src/padmap.mjs');
  const { log } = await loadUi({ settings: { roundSize: 10 } });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', 'Ear', 'Guess: drum');
  ticks(2);
  assert.ok(drawnText(1).some((t) => /GUESS: DRUM/.test(t)), 'the step did not open its quiz');
  /* Try every drum in turn until the round is over: right answers and wrong
   * ones, so the score is somewhere in between. */
  const pads = PM.layoutVoices('mpc').map((v) => PM.padsForVoice(v, 'mpc')[0]);
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
  /* Three drums are not the kit: the round is filed under its pool. */
  assert.equal(JSON.parse(log.writes[`${DATA}progress.json`]).items['quiz:guess:voice:kit3'].plays, 1);
});

test('the Clock step arms the Clock round its drill, at the drill\'s target', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '1 Eighth notes', 'Time', 'Clock');
  ticks(2);
  assert.ok(log.announces.includes('Clock: Quarters'), log.announces.slice(-3).join('|'));
  /* Eight bars of quarters at 100bpm is 19 seconds; at the default 90 it is 21. */
  assert.ok(drawnText(1).some((t) => /0:19/.test(t)), 'not at the target tempo');
});

test('a Ladder that never holds a rung ends, says why, and counts as tried', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, ladderBars: 1 } });
  globalThis.init();
  ticks(2);
  /* Practice › Subdivisions › Quarters, on the Ladder. */
  goTo('Practice', 'Subdivisions', 'Quarters', { open: false });
  sheetPick('Practise: Ladder');
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

test('Hear: subdivision and Pick: groove put their answers on the bottom row, every question in the same place', async () => {
  const AP = await import('../src/answer_pads.mjs');
  /* They have no pads of their own. Hear: subdivision fits the bar whole (5
   * subdivisions); the groove pool does not, so it offers three near misses. */
  for (const [index, count] of [[3, 5], [4, 3]]) {
    const { log } = await loadUi();
    globalThis.init();
    ticks(2);
    openQuiz(index);
    ticks(2);
    const lit = () => {
      const leds = padNow(log);
      const row = [];
      for (let p = 68; p < 76; p++) row.push(leds[p] === 0 ? 0 : 1);
      return row;
    };
    const want = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of AP.answerPads(count)) want[p - 68] = 1;
    assert.deepEqual(lit(), want, `${DRILLS[index].name}`);
    const bright = AP.ANSWER_COLOURS.map((c) => c.bright);
    const dim = AP.ANSWER_COLOURS.map((c) => c.dim);
    const leds = padNow(log);
    for (const p of AP.answerPads(count)) assert.ok(bright.includes(leds[p]) || dim.includes(leds[p]), String(leds[p]));
    if (count <= AP.LIST_MAX) {
      const shown = drawnText(1);
      for (const name of ['blue', 'cyan', 'white']) assert.ok(shown.includes(name), `${name}: ${shown.join('|')}`);
    }
    assert.ok(drawnText(1).includes('PAD answer  REC help'));
  }
});

test('an answer pad answers and sounds nothing; one of them is right', async () => {
  const AP = await import('../src/answer_pads.mjs');
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  openQuiz(3);                               /* Hear: subdivision: all five on the bar */
  ticks(120);                                /* the prompt itself sounds: let it finish */
  const before = log.params.length;
  const flashes = [];
  for (const p of AP.answerPads(5)) {
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

/*
 * Pick: drum answers on the kit's own pads: every pad of an offered drum in
 * the layout in force, in that answer's colour (the jog's choice pulsing),
 * every other pad dark. Sticking quizzes on MPC Classic, as the drum quiz does.
 */
test('Pick: drum lights each offered drum on all its pads; any of them answers, silently', async () => {
  const AP = await import('../src/answer_pads.mjs');
  for (const [setting, layout] of [['mpc', 'mpc'], ['gm', 'gm'], ['sticking', 'mpc']]) {
    const { log } = await loadUi({ settings: { layout: setting } });
    globalThis.init();
    ticks(2);
    openQuiz(2);                             /* Pick: drum */
    ticks(120);                              /* the prompt sounds first: let it finish */
    let q = globalThis.drumsPracticeScreen().quiz;
    assert.equal(q.mode + q.kind, 'pickvoice', setting);
    const lights = () => {
      const leds = padNow(log);
      q = globalThis.drumsPracticeScreen().quiz;
      for (let p = 68; p < 100; p++) {
        const at = q.options.indexOf(PADMAP.padVoice(p, layout));
        const c = AP.answerColour(at);
        const want = at < 0 || q.eliminated.includes(at) ? [0] : [c.bright, c.dim];
        assert.ok(want.includes(leds[p]), `${setting}: pad ${p} (${PADMAP.padVoice(p, layout)}) is ${leds[p]}`);
      }
    };
    lights();
    const lit = Object.entries(padNow(log)).filter(([n, c]) => n >= 68 && n < 100 && c).map(([n]) => +n);
    const want = q.options.flatMap((v) => PADMAP.padsForVoice(v, layout)).sort((a, b) => a - b);
    assert.deepEqual(lit.sort((a, b) => a - b), want, `${setting}: the lit pads are the offered drums'`);

    const before = log.params.length;
    /* A dark pad does nothing. */
    const dark = [...Array(32).keys()].map((i) => 68 + i).find((p) => !want.includes(p));
    pad(dark, 100); pad(dark, 0);
    ticks(1);
    assert.equal(globalThis.drumsPracticeScreen().quiz.wrong, 0, `${setting}: a dark pad answered`);
    /* A wrong drum's last pad strikes it, and all its pads go dark. */
    const wrong = q.options.findIndex((v) => v !== q.prompt);
    const wrongPads = PADMAP.padsForVoice(q.options[wrong], layout);
    pad(wrongPads[wrongPads.length - 1], 100); pad(wrongPads[wrongPads.length - 1], 0);
    ticks(10);                               /* past the red flash */
    assert.ok(globalThis.drumsPracticeScreen().quiz.eliminated.includes(wrong), setting);
    for (const p of wrongPads) assert.equal(padNow(log)[p], 0, `${setting}: struck, pad ${p} still lit`);
    lights();
    /* The right drum's first pad answers it. */
    const right = PADMAP.padsForVoice(q.prompt, layout)[0];
    pad(right, 100); pad(right, 0);
    ticks(1);
    assert.equal(globalThis.drumsPracticeScreen().quiz.correct, 1, `${setting}: the right drum's pad`);
    assert.equal(log.params.slice(before).filter(isHit).length, 0, `${setting}: an answer pad sounded a drum`);
  }
});

test('Pick: drum names the jog\'s choice and its colour, and a drum without a pad is said', async () => {
  /* Custom without the ride: the ride is offered on the jog all the same. */
  const rows = PADMAP.rowsOf(PADMAP.gridOf(PADMAP.PRESETS.mpc.rows).map((v) => (v === 'RD' ? null : v)));
  await loadUi({ settings: { layout: 'custom' },
    dataFiles: { 'pads.json': JSON.stringify({ version: 1, pair: 'twin', rows }) } });
  globalThis.init();
  ticks(2);
  openQuiz(2);
  const q = globalThis.drumsPracticeScreen().quiz;
  assert.ok(q.options.includes('RD'), 'the ride was dropped');
  let shown = drawnText(1);
  assert.ok(shown.includes('Crash  blue'), shown.join('|'));
  const seen = new Set();
  for (let i = 0; i < 300; i++) for (const t of drawnText(1)) seen.add(t);
  assert.ok(seen.has('NO RD ON PADS') && seen.has('PAD answer  REC help'), [...seen].join('|'));
  cc(CC.jogTurn, q.options.indexOf('RD'));
  shown = drawnText(1);
  assert.ok(shown.includes('Ride'), `the padless drum, on the jog: ${shown.join('|')}`);
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
  await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 60);
  assert.ok(drawnText(1).includes('CLEAN'), 'no result');
  cc(CC.jogTurn, 127);                          /* one beat back */
  ticks(1);
  let shown = drawnText(1);
  assert.ok(shown.includes('REVIEW'), `not reviewing: ${shown.join('|')}`);
  assert.ok(!shown.includes('CLEAN'), 'the result is still up');
  for (let i = 0; i < 12; i++) cc(CC.jogTurn, 127);
  ticks(1);
  shown = drawnText(1);
  assert.ok(shown.some((t) => /^\d+\/\d+$/.test(t)), 'no bar position in the review');
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 1);
  ticks(1);
  assert.ok(drawnText(1).includes('CLEAN'), 'forward to the end did not bring the result back');
});

test('the review shows what was played: hits as rings, misses as crosses', async () => {
  const { screen } = await loadUi({ settings: { ...PLAIN, view: 'staff' }, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  /* Every other beat: half hit, half missed. */
  cc(CC.record, 127);
  const beatMs = 1000;              /* the first step: quarters at 60 */
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
  await loadUi({ settings: PLAIN, walked: true });
  const sn = await snare();
  globalThis.init();
  ticks(2);
  continuePath();
  playQuarters(sn, 60);
  cc(CC.knob1, 127);
  ticks(1);
  assert.ok(drawnText(1).includes('REVIEW'));
  cc(CC.knob1, 1);
  ticks(1);
  assert.ok(drawnText(1).includes('CLEAN'), 'one step forward from just before the end is the result');
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
/* Rock backbeat's drums, on the default layout's left half — read from the
 * layout, so a change of default moves the test with it. */
const PAD_OF = Object.fromEntries(['HH', 'KK', 'SN'].map((v) => [v, PADMAP.padsForVoice(v, PADMAP.DEFAULT_LAYOUT, 'L')[0]]));
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
  cc(CC.jogClick, 127);                       /* straight to its ready screen */
  const ready = drawnText(2);
  assert.ok(ready.includes('L0  Own pace'), `the groove opens on L0: ${ready.join('|')}`);
  assert.ok(ready.includes('LEVEL') && ready.includes('>') && !ready.includes('<'), 'L0 is the bottom rung');
  assert.ok(ready.includes('own pace'), ready.join('|'));
  assert.ok(ready.includes('hear bar'));
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
  assert.ok(drawnText(2).includes('own pace'), 'still on the ready screen');
});

test('the ready header keeps the drill\'s name: the duration gives way first', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  toFirstRung();                                /* Rock backbeat, a timed level */
  ticks(2);
  const header = drawnText(1);
  assert.ok(header.includes('Rock backbeat'), `name cut: ${header.join('|')}`);
  assert.ok(header.some((t) => /^\d+ bars/.test(t)), `no length: ${header.join('|')}`);
});

test('Play on L0 takes the ready box away, and the cursor walks the bar as it sounds', async () => {
  const L = await import('../src/layout.mjs');
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  assert.ok(drawnText(2).includes('own pace'), 'the box, before Play');
  /* The cursor's arrow: its wide top row sits alone under the header rule. */
  const arrowX = () => {
    for (let x = 0; x < 128; x++) if (screen.pixels[L.CURSOR_TOP_Y * 128 + x]) return x;
    return -1;
  };
  cc(CC.play, 127);
  ticks(2);
  assert.ok(!drawnText(1).includes('own pace'), 'the box still covers the page');
  const first = arrowX();
  ticks(40);                                    /* a second into the bar */
  const later = arrowX();
  assert.ok(first >= 0 && later > first, `the cursor did not walk: ${first} -> ${later}`);
  ticks(120);                                   /* past the bar */
  assert.ok(drawnText(2).includes('own pace'), 'the box comes back when the bar is through');
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

test('a groove\'s Ladder is on its first timed rung: L0 has no tempo to climb', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  toList();
  sheetPick('Practise: Ladder');
  ticks(2);
  assert.match(log.announces.join('|'), /Ladder: Rock backbeat/);
  assert.ok(drawnText(2).includes('practise'), 'the Ladder is on a timed rung');
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
  assert.ok(ready.includes('practise'), `the timed ready screen: ${ready.join('|')}`);
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

test('L0 on the sticking layout names the drum it has no pad for, and does not start', async () => {
  /* Every pad is the snare there: the hat and the kick of a groove cannot be
   * struck, and with no clock nothing would ever move the cursor on. */
  const { log } = await loadUi({ settings: { layout: 'sticking' } });
  globalThis.init();
  ticks(2);
  armL0();
  assert.ok(drawnText(2).includes('NO HH ON PADS'), 'the ready box names the drum');
  cc(CC.record, 127);
  ticks(2);
  assert.ok(drawnText(2).includes('NO HH ON PADS'), 'and Record does not start a take');
  assert.ok(log.announces.some((a) => /no HH on these pads/.test(a)));
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
  goTo('Practice', 'Grooves', 'Rock & Pop');
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

test('switching Pads back in Settings clears the L0 warning', async () => {
  await loadUi({ settings: { layout: 'sticking' } });
  globalThis.init();
  ticks(2);
  armL0();
  assert.ok(drawnText(2).includes('NO HH ON PADS'));
  const SET = await import('../src/settings_def.mjs');
  const row = SET.ROWS.findIndex((r) => r.key === 'layout');
  shiftClick();
  for (let i = 0; i < 40; i++) cc(CC.jogTurn, 127);
  for (let i = 0; i < row; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);                          /* edit Pads */
  cc(CC.jogTurn, 1);                             /* sticking is the last value */
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 127); /* clamp at the first: MPC Classic */
  cc(CC.jogClick, 127);
  shiftClick();
  assert.ok(!drawnText(2).includes('NO HH ON PADS'), 'the warning went with the layout');
  cc(CC.record, 127);
  ticks(2);
  stepThrough();
  assert.ok(drawnText(3).some((t) => /1st try/.test(t)), 'and the take runs');
});

test('mashing kick, snare and hat at once never steps L0 on', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  armL0();
  cc(CC.record, 127);
  ticks(2);
  for (let k = 0; k < 40; k++) {
    for (const p of [PAD_OF.KK, PAD_OF.SN, PAD_OF.HH]) pad(p, 90);
    for (const p of [PAD_OF.KK, PAD_OF.SN, PAD_OF.HH]) pad(p, 0);
    ticks(8);
  }
  const shown = drawnText(1);
  assert.ok(shown.includes('1/2') && shown.includes('0/0'), `still on the first stack: ${shown.join('|')}`);
  /* The right drums, and only those, move it. */
  strike(ROCK_STACKS[0]);
  ticks(8);
  assert.ok(drawnText(1).includes('0/1'), 'the first stack is through, not first time');
});

/* ---- finding your way: the welcome, tips, hints, the sheet, help ---------- */

test('a newcomer is welcomed: what it is, the keys, then new or already playing', async () => {
  const { log } = await loadUi({ tips: [] });
  globalThis.init();
  ticks(2);
  assert.equal(screenNow(), 'welcome');
  let shown = drawnText(1);
  assert.ok(shown.includes('Welcome') && shown.includes('Drums Practice takes'), shown.join('|'));
  assert.ok(shown.includes('JOG page  CLICK go on') && shown.includes('1/4'), shown.join('|'));
  cc(CC.jogTurn, 1);                         /* the jog turns the page too */
  assert.ok(drawnText(1).includes('Lit pads can be'), drawnText(1).join('|'));
  cc(CC.jogClick, 127);
  shown = drawnText(1);
  assert.ok(shown.includes('Keys') && shown.includes('MENU   help, anywhere'), shown.join('|'));
  cc(CC.jogClick, 127);
  shown = drawnText(1);
  assert.ok(shown.includes('New to drums?') && shown.includes('From the start') && shown.includes('I already play'));
  assert.ok(shown.includes('JOG pick  CLICK go on'), shown.join('|'));
  cc(CC.jogClick, 127);                      /* From the start */
  ticks(1);
  /* The map's own tip comes first: it is a newcomer's first map. */
  assert.equal(screenNow(), 'tip');
  cc(CC.jogClick, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'From the start lands on the Path');
  assert.ok(globalThis.drumsPracticeScreen().map, 'on its map');
  assert.equal(globalThis.drumsPracticeScreen().map.at, 0, 'the avatar on the first stage');
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.deepEqual(saved.tips, ['welcome', 'map'], 'and the map tip, read on the way');
  assert.equal(saved.path.start, 0);
});

test('"I already play" opens the Path with a tip on testing out; Back ends the welcome anywhere', async () => {
  await loadUi({ tips: [] });
  globalThis.init();
  ticks(2);
  for (let i = 0; i < 3; i++) cc(CC.jogClick, 127);
  cc(CC.jogTurn, 1);                         /* I already play */
  cc(CC.jogClick, 127);
  ticks(1);
  assert.equal(screenNow(), 'tip');
  let shown = drawnText(1);
  assert.ok(shown.includes('Know a stage') && shown.includes('JOG scroll'), shown.join('|'));
  cc(CC.jogTurn, 1);                         /* the tip is longer than a page */
  shown = drawnText(1);
  assert.ok(shown.some((t) => /^2\//.test(t)), `the tip did not scroll: ${shown.join('|')}`);
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'the Path is open under the tip');

  const second = await loadUi({ tips: [] });
  globalThis.init();
  ticks(2);
  cc(CC.back, 127);                          /* dismissed on its first page */
  assert.equal(globalThis.drumsPracticeMenu().title, 'Drums');
  globalThis.onUnload();
  assert.deepEqual(JSON.parse(second.log.writes[`${DATA}progress.json`]).tips, ['welcome']);
});

test('someone who practised before the welcome existed is not welcomed, only marked', async () => {
  const progress = { version: 2, items: { flam: { best: 80, bpm: 60, plays: 3, t: 1, h: [] } } };
  const { log } = await loadUi({ tips: [], dataFiles: { 'progress.json': JSON.stringify({ ...progress, tips: [] }) } });
  globalThis.init();
  ticks(2);
  assert.equal(screenNow(), 'menu');
  globalThis.onUnload();
  assert.deepEqual(JSON.parse(log.writes[`${DATA}progress.json`]).tips, ['welcome']);
});

test('each first visit shows its tip once, and Show tips again brings them back', async () => {
  await loadUi({ tips: ['welcome'] });
  globalThis.init();
  ticks(2);
  shiftClick();                              /* the first sheet */
  ticks(1);
  assert.equal(screenNow(), 'tip');
  assert.ok(drawnText(1).includes('Options for this row.'));
  cc(CC.jogClick, 127);
  assert.equal(screenNow(), 'sheet', 'the tip stood in front of the sheet');
  cc(CC.back, 127);
  shiftClick();
  ticks(1);
  assert.equal(screenNow(), 'sheet', 'the tip came back');
  cc(CC.back, 127);
  toFirstDrill();
  cc(CC.jogClick, 127);                      /* the first ready screen */
  ticks(1);
  assert.equal(screenNow(), 'tip');
  assert.ok(drawnText(1).some((t) => /^REC plays and scores/.test(t)), drawnText(1).join('|'));
  cc(CC.back, 127);
  assert.equal(screenNow(), 'ready');
  toTop();
  goTo('Quiz', 'Hear: drum');
  ticks(1);
  assert.equal(screenNow(), 'tip');
  assert.ok(drawnText(1).some((t) => /^Answer with the lit/.test(t)));
  const before = globalThis.__log.params.length;
  cc(CC.jogClick, 127);
  ticks(2);
  assert.equal(screenNow(), 'quiz');
  assert.ok(globalThis.__log.params.slice(before).some(isHit), 'the question is asked once the tip is read');
  toTop();
  goTo('Settings', 'Help', 'Show tips again');
  cc(CC.back, 127);
  cc(CC.back, 127);
  shiftClick();
  ticks(1);
  assert.equal(screenNow(), 'tip', 'the tips were not cleared');
});

test('Shift held shows Shift\'s layer on the hint line; a long hint rotates', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.shift, 127);
  let shown = drawnText(1);
  assert.ok(shown.includes('SHIFT: CLICK options') || shown.includes('SHIFT: BACK quit'), shown.join('|'));
  cc(CC.shift, 0);
  assert.ok(drawnText(1).includes('JOG choose'));
  shiftClick();
  const parts = new Set();
  for (let i = 0; i < 300; i++) for (const t of drawnText(1)) parts.add(t);
  assert.ok(parts.has('CLICK do it') && parts.has('BACK close'), [...parts].join('|'));
  cc(CC.back, 127);
  armFirstRung();
  cc(CC.shift, 127);
  shown = drawnText(1);
  assert.ok(shown.some((t) => /^SHIFT: /.test(t)), `no Shift layer on the ready screen: ${shown.join('|')}`);
  cc(CC.shift, 0);
});

/*
 * The bottom line's turns, as [text, ticks] runs over `ms` of 25 ms ticks:
 * what the hint line (y 54 and below) shows each frame, equal frames joined.
 */
function hintRuns(ms) {
  const runs = [];
  const orig = globalThis.print;
  for (let i = 0; i < ms / 25; i++) {
    const line = [];
    globalThis.print = (x, y, s, v) => { if (y >= 54) line.push(s); orig(x, y, s, v); };
    ticks(1);
    const text = line.join(' ');
    if (runs.length && runs[runs.length - 1][0] === text) runs[runs.length - 1][1]++;
    else runs.push([text, 1]);
  }
  globalThis.print = orig;
  return runs;
}

/*
 * A hint's turns are counted from when it first showed, not from the clock's
 * zero: whatever the clock's phase, a screen opens on its first part and
 * every part stays a full turn (3 s, 120 ticks). Counted from zero, which part
 * you met was the time of day's choice and the first turn could be a frame.
 */
test('the map, home and ready screens open on their first hint part, each part a full turn', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  /* Each screen is left for another one that shows a frame, then entered
   * with no frame before the count: the phase is what the clock says then. */
  const away = () => { toTop(); goTo('Practice'); ticks(1); toTop(); };
  const open = {
    home: () => {},
    map: () => goTo('Learning Path'),
    ready: () => { toFirstRung(); cc(CC.jogClick, 127); },
  };
  const first = { home: 'JOG choose', map: 'PAD go  CLICK enter', ready: 'L1  Time only' };
  for (const name of Object.keys(open)) {
    let seen = null;
    for (let phase = 0; phase < 3000; phase += 130) {
      away();
      globalThis.__advance(phase);
      open[name]();
      const runs = hintRuns(4 * 3000 + 500);
      const where = `${name} at phase ${phase}: ${runs.map(([t, n]) => `${t}x${n}`).join(' | ')}`;
      assert.equal(runs[0][0], first[name], `does not open on its first part — ${where}`);
      assert.ok(runs.length > 2, `the hint does not take turns — ${where}`);
      for (const [, n] of runs.slice(0, -1)) assert.equal(n, 120, `a turn is cut — ${where}`);
      const order = runs.slice(0, -1).map(([t]) => t).join(' | ');
      if (seen === null) seen = order;
      assert.equal(order, seen, `the turns depend on the clock — ${where}`);
    }
  }
});

test('Settings is a folder of groups; Shift+click over a drill still shows every setting', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Settings');
  assert.deepEqual(globalThis.drumsPracticeMenu().labels, ['Learning Path', 'Practice', 'Sound', 'Pads', 'MIDI', 'Help']);
  goTo('Sound');
  let shown = drawnText(1);
  assert.ok(shown.includes('SOUND') && shown.includes('Click') && shown.includes('Latency'), shown.join('|'));
  assert.ok(!shown.includes('Tempo'), 'another group\'s row in Sound');
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Settings', 'Back from a group is the folder');
  toTop();
  armFirstRung();
  shiftClick();
  shown = drawnText(1);
  assert.ok(shown.includes('SETTINGS') && shown.includes('Tempo'), shown.join('|'));
  shiftClick();
  assert.equal(screenNow(), 'ready', 'Shift+click again leaves Settings');
});

test('a stage with lesson cards offers them in its sheet, and its help reads the stage\'s card', async () => {
  await loadUi({ withLessons: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '1 Eighth notes', { open: false });
  cc(CC.menu, 127);
  const help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('1 EIGHTH NOTES'), `no stage card in the help: ${help.join('|')}`);
  cc(CC.menu, 127);
  sheetPick('Lessons');
  ticks(1);
  assert.equal(screenNow(), 'card');
  assert.ok(drawnText(1).some((t) => /Eighth/.test(t)));
});

test('Click on the result of a review Continue opened goes on as Continue would', async () => {
  const day = 86400;
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 2, items: { flam: {
    best: 100, bpm: 70, plays: 1, t: now - 3 * day, done: now - 3 * day, skip: 0,
    rep: { due: now - day, step: 0, at: 0, ok: false }, h: [],
  } } };
  const { log } = await loadUi({ settings: PLAIN, dataFiles: { 'progress.json': JSON.stringify(progress) }, walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  cc(CC.play, 127);                          /* Continue: Review: Flam */
  ticks(2);
  cc(CC.record, 127);
  assert.ok(runUntil(/REC again/, 4000), 'the review take never ended');
  cc(CC.jogClick, 127);
  ticks(2);
  assert.match(log.announces.slice(-2).join('|'), /Quarters ready/, 'not on to the next step');
});

test('Menu on Continue reads the card of the step it would open', async () => {
  await loadUi({ withLessons: true });
  globalThis.init();
  ticks(2);
  toPathList();
  cc(CC.menu, 127);
  const help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('HELP: LIST') || drawnText(1).includes('HELP: LIST'));
  assert.ok(help.some((l) => /^THE PULSE|^YOUR RESULT|^0 HELLO, KIT/.test(l)), help.join('|'));
});

/* ---- the Path map ---------------------------------------------------------- */

const mapNow = () => globalThis.drumsPracticeScreen().map;
async function padOfPlace(n, i) {
  const PL = await import('../src/pathmap/layout.mjs');
  const layout = PL.layoutPlaces(n);
  return PL.padOfCell(layout.cells[i]);
}

test('the Path is a world map: a pad walks the avatar there, a second press goes in', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  ticks(1);
  const m = mapNow();
  assert.ok(m, 'the Path is not drawn as a map');
  assert.equal(m.places.length, 7, 'an island per stage');
  assert.equal(m.at, 0, 'the avatar starts where Continue goes');
  assert.ok(drawnText(1).includes('PAD go  CLICK enter'), drawnText(1).join('|'));
  const p3 = await padOfPlace(7, 3);
  pad(p3, 100); pad(p3, 0);
  assert.equal(mapNow().at, 3, 'the pad did not walk there');
  assert.equal(globalThis.drumsPracticeMenu().cursor, 4, 'the cursor is the place\'s row, after Continue');
  ticks(40);
  assert.match(log.announces.join('|'), /3 Ghosts & flams, 0 percent/, 'arriving says where');
  pad(p3, 100); pad(p3, 0);
  ticks(1);
  assert.equal(globalThis.drumsPracticeMenu().title, '3 Ghosts & flams', 'the second press did not go in');
  assert.ok(mapNow(), 'a stage is drawn as its island');
  assert.ok(mapNow().places.some((p) => p.startsWith('Checkpoint:')));
});

test('the jog walks the map, click goes in, Back comes out to the island it left', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  cc(CC.jogTurn, 2);
  assert.equal(mapNow().at, 2);
  cc(CC.jogTurn, 127);
  assert.equal(mapNow().at, 1, 'the jog walks back too');
  cc(CC.jogClick, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, '1 Eighth notes');
  assert.deepEqual(mapNow().places.map((p) => p.split(':')[0]),
    ['Lessons', 'Ear', 'Time', 'Grooves', 'Electives', 'Checkpoint'], 'the island\'s places, in the folder\'s order');
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path');
  assert.equal(mapNow().at, 1, 'Back puts the avatar on the island it came from');
  cc(CC.back, 127);
  assert.equal(globalThis.drumsPracticeMenu().title, 'Drums');
  assert.equal(mapNow(), null, 'the top is a list');
});

test('pads make no sound on the map, and are the kit again in a list', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  const PL = await import('../src/pathmap/layout.mjs');
  const water = [];
  for (let n = 68; n < 100; n++) if (PL.placeOfPad(PL.layoutPlaces(7), n) < 0) water.push(n);
  let before = log.params.length;
  for (const p of water.concat(await padOfPlace(7, 2))) { pad(p, 100); pad(p, 0); }
  ticks(2);
  assert.equal(log.params.slice(before).filter(isHit).length, 0, 'a pad sounded on the map');
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path', 'water took us somewhere');
  cc(CC.back, 127);
  toKit();
  before = log.params.length;
  pad(69, 100); pad(69, 0);
  ticks(2);
  assert.equal(log.params.slice(before).filter(isHit).length, 1, 'the list lost its kit');
});

test('on the map the pads light its places, and Play is Continue', async () => {
  const PAD = await import('../src/padmap.mjs');
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  ticks(3);
  const lit = new Map();
  for (const [n, c] of log.leds) lit.set(n, c);
  const p0 = await padOfPlace(7, 0);
  const p4 = await padOfPlace(7, 4);
  assert.equal(lit.get(p0), PAD.MAP_PALETTE.avatar, 'the avatar\'s pad is the brightest');
  assert.equal(lit.get(p4), PAD.MAP_PALETTE.ahead, 'a later stage is dim');
  assert.equal(lit.get(68 + 31), PAD.LED_OFF, 'water is dark');
  cc(CC.play, 127);
  ticks(2);
  assert.equal(globalThis.drumsPracticeScreen().screen, 'ready');
  assert.match(log.announces.slice(-3).join('|'), /Quarters ready/);
});

test('the map\'s sheet shows the folder as a list, and Back returns to the map', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  shiftClick();
  const sheet = globalThis.drumsPracticeScreen().sheet;
  assert.ok(sheet.includes('Show as list') && sheet.includes('Start the path here'), sheet.join('|'));
  cc(CC.back, 127);
  sheetPick('Show as list');
  assert.equal(mapNow(), null, 'still a map');
  assert.ok(drawnText(1).includes('CLICK open  BACK up'), 'the list has the list\'s hint');
  shiftClick();
  assert.ok(globalThis.drumsPracticeScreen().sheet.includes('Show as map'));
  cc(CC.back, 127);
  cc(CC.back, 127);
  assert.ok(mapNow(), 'Back did not return to the map');
  assert.equal(globalThis.drumsPracticeMenu().title, 'Learning Path');
});

test('Menu on the map is its help, with the place\'s lesson card; the map and island tips show once', async () => {
  await loadUi({ tips: ['welcome'], withLessons: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  ticks(1);
  assert.equal(globalThis.drumsPracticeScreen().screen, 'tip');
  assert.ok(drawnText(1).some((t) => /^Lit pads are places/.test(t)), drawnText(1).join('|'));
  cc(CC.jogClick, 127);
  cc(CC.menu, 127);
  const help = globalThis.drumsPracticeScreen().help;
  assert.ok(help.includes('PAD    go') && help.includes('0 HELLO, KIT') && help.includes('THE MAP'), help.join('|'));
  cc(CC.menu, 127);
  cc(CC.jogClick, 127);
  ticks(1);
  assert.equal(globalThis.drumsPracticeScreen().screen, 'tip', 'no island tip');
  assert.ok(drawnText(1).some((t) => /^Each place is part/.test(t)));
  cc(CC.back, 127);
  cc(CC.back, 127);
  ticks(1);
  assert.equal(globalThis.drumsPracticeScreen().screen, 'menu', 'the map tip came again');
});

test('Back and Menu light: Menu always, Back while there is somewhere to go back to', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  const last = (cc) => { const b = log.buttons.filter(([c]) => c === cc); return b[b.length - 1][1]; };
  assert.equal(last(CC.menu), 124);
  assert.equal(last(CC.back), 0, 'at the top Back closes');
  goTo('Practice');
  ticks(2);
  assert.equal(last(CC.back), 124);
  cc(CC.shift, 127); cc(CC.back, 127); cc(CC.shift, 0);
  ticks(30);
  assert.equal(last(CC.back), 0, 'left lit after closing');
  assert.equal(last(CC.menu), 0);
});

/* ---- Meet the pads ------------------------------------------------------ */

/* The pulsing pads (LED_PROMPT on the pulse's lit half), over half a second. */
function pulsing(log) {
  const lit = new Set();
  for (let i = 0; i < 25; i++) {
    ticks(1);
    for (const [n, c] of Object.entries(padColours(log))) if (c === PADMAP.LED_PROMPT) lit.add(Number(n));
  }
  return [...lit].sort((a, b) => a - b);
}

test('Meet the pads: Continue opens it first, the drum pulses and sounds, its pad moves on', async () => {
  const { log } = await loadUi({ settings: PLAIN, withLessons: true });
  globalThis.init();
  ticks(2);
  /* Continue's first offer; too long for the row, so the title bar names it. */
  toPathList();
  assert.ok(drawnText(1).includes('MEET THE PADS'), drawnText(1).join('|'));
  cc(CC.jogClick, 127);
  ticks(1);
  /* The stage's card, then the tour's own. */
  assert.ok(drawnText(1).includes('0 Hello, kit'), drawnText(1).join('|'));
  cc(CC.jogClick, 127); ticks(1);
  assert.ok(drawnText(1).includes('Meet the pads'), drawnText(1).join('|'));
  const before = log.params.filter(isHit).length;
  cc(CC.jogClick, 127); ticks(2);
  let shown = drawnText(1);
  assert.ok(shown.includes('Kick') && shown.includes('1/16'), shown.join('|'));
  assert.ok(shown.includes('PAD hit lit  JOG skip'), shown.join('|'));
  assert.equal(log.params.filter(isHit).length, before + 1, 'the kick is heard once');
  assert.deepEqual(pulsing(log), PADMAP.padsForVoice('KK', 'mpc'), 'the kick pulses on both halves');
  cc(CC.play, 127); ticks(1);
  assert.equal(log.params.filter(isHit).length, before + 2, 'Play sounds it again');
  cc(CC.menu, 127);
  assert.ok(globalThis.drumsPracticeScreen().help.includes('PAD    hit lit'), 'MENU is the tour\'s help');
  cc(CC.menu, 127);

  /* Another pad sounds and is named; the kick still waits. */
  const sn = PADMAP.padsForVoice('SN', 'mpc')[1];
  pad(sn, 100); pad(sn, 0); ticks(30);
  assert.ok(drawnText(1).includes('1/16'), 'a wrong pad moved the tour on');
  pad(sn, 100); pad(sn, 0); ticks(1);
  assert.ok(drawnText(1).includes('That was the snare.'), drawnText(1).join('|'));

  /* The right pad: a moment, then the next drum. */
  const kk = PADMAP.padsForVoice('KK', 'mpc')[1];
  pad(kk, 100); pad(kk, 0); ticks(30);
  shown = drawnText(1);
  assert.ok(shown.includes('Snare') && shown.includes('2/16'), shown.join('|'));

  /* The jog skips; the rest walked by their pads, to the end. */
  cc(CC.jogTurn, 1); ticks(1);
  assert.ok(drawnText(1).includes('3/16'), drawnText(1).join('|'));
  for (let i = 3; i <= 16; i++) {
    const voice = drawnText(1)[0];
    const v = VOICES.find((x) => x.label === voice);
    assert.ok(v, `no drum called "${voice}"`);
    const p = PADMAP.padsForVoice(v.id, 'mpc')[0];
    pad(p, 100); pad(p, 0); ticks(30);
  }
  for (let i = 0; i < 200 && !drawnText(1).includes('CLICK next  BACK list'); i++) ticks(1);
  shown = drawnText(1);
  assert.ok(shown.includes('Your kit') && shown.includes('CLICK next  BACK list'), shown.join('|'));
  /* Click goes on along the Ear track: Guess: drum, after its card. */
  cc(CC.jogClick, 127); ticks(1);
  assert.ok(drawnText(1).includes('The kit on paper'), drawnText(1).join('|'));
  cc(CC.jogClick, 127); ticks(2);
  assert.ok(drawnText(1).some((t) => /GUESS: DRUM/.test(t)), drawnText(1).join('|'));
  globalThis.onUnload();
  const saved = JSON.parse(log.writes[`${DATA}progress.json`]);
  assert.ok(saved.items['tour:pads'].done > 0, 'the tour was not recorded');
  assert.equal(saved.items['tour:pads'].plays, 1);
});

test('Meet the pads: Back leaves it unrecorded; on Sticking it tours the kit', async () => {
  const { log } = await loadUi({ settings: { ...PLAIN, layout: 'sticking' } });
  globalThis.init();
  ticks(2);
  continuePath();
  assert.ok(drawnText(1).includes('1/16'), `Sticking tours the kit: ${drawnText(1).join('|')}`);
  cc(CC.jogTurn, 1); ticks(1);
  cc(CC.back, 127); ticks(1);
  toPathList();
  assert.ok(drawnText(1).includes('MEET THE PADS'), drawnText(1).join('|'));
  globalThis.onUnload();
  const text = log.writes[`${DATA}progress.json`];
  assert.ok(!text || !JSON.parse(text).items['tour:pads'], 'Back recorded the tour');
});

/* ---- the level, on the ready screen ------------------------------------------ */

test('a groove opens on its ready screen; the jog walks its rungs, clamped, and L0 to L1 switches the screen', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  cc(CC.jogClick, 127);
  ticks(2);
  assert.equal(screenNow(), 'ready');
  assert.ok(drawnText(1).includes('own pace'), 'a fresh groove opens on L0');
  cc(CC.jogTurn, 127);                           /* below L0: nothing */
  assert.ok(drawnText(1).includes('own pace'));
  cc(CC.jogTurn, 1);
  ticks(1);
  let shown = drawnText(1);
  assert.ok(shown.includes('practise') && shown.includes('<') && shown.includes('>'), shown.join('|'));
  assert.match(log.announces.slice(-1)[0], /^level 1, Time only/);
  cc(CC.jogTurn, 10);                            /* past the top: clamped at L3 */
  ticks(1);
  shown = drawnText(1);
  assert.ok(shown.includes('<') && !shown.includes('>'), shown.join('|'));
  assert.match(log.announces.slice(-1)[0], /^level 3, plus snare/);
  cc(CC.jogTurn, 127);
  assert.match(log.announces.slice(-1)[0], /^level 2, plus kick/);
});

test('a groove opens on the first rung not yet learned, and its row shows the best rung', async () => {
  const now = Math.round(Date.now() / 1000);
  const learned = { best: 100, bpm: 84, plays: 1, t: now, done: now, skip: 0, rep: null, h: [] };
  const progress = { version: 2, items: { 'rock-backbeat:l1': learned } };
  await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) } });
  globalThis.init();
  ticks(2);
  toFirstDrill();
  ticks(1);
  assert.ok(drawnText(1).includes('L1 100%'), `the row: ${drawnText(1).join('|')}`);
  cc(CC.jogClick, 127);
  ticks(1);
  const shown = drawnText(1);
  assert.ok(shown.some((t) => /^L2 {2}\+ kick$/.test(t)) || shown.includes('practise'), shown.join('|'));
  assert.ok(globalThis.drumsPracticeScreen().screen === 'ready');
});

test('on the Path a groove is one row; the jog walks only the rungs the stage asks for', async () => {
  const { log } = await loadUi({ walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path', '0 Hello, kit', 'Grooves', { open: true });
  const labels = globalThis.drumsPracticeMenu().labels;
  assert.ok(labels.includes('First beat') && !labels.some((l) => /^L\d/.test(l)), labels.join('|'));
  goTo('First beat');
  ticks(1);
  assert.match(log.announces.join('|'), /First beat L0 ready|First beat ready/);
  cc(CC.jogTurn, 10);
  const top = log.announces.slice(-1)[0];
  assert.match(top, /^level 3/, 'stage 0 asks for L0 to L3');
  /* The sheet's skip acts on the rung the row opens on. */
  cc(CC.back, 127);
  sheetPick('I know this: skip');
  assert.match(log.announces.slice(-1)[0], /^Skipped First beat L0/);
});

test('a review arms the rung that is due, whatever the groove would open on', async () => {
  const day = 86400;
  const now = Math.round(Date.now() / 1000);
  const progress = { version: 2, items: { 'rock-backbeat:l2': {
    best: 100, bpm: 84, plays: 1, t: now - 3 * day, done: now - 3 * day, skip: 0,
    rep: { due: now - day, step: 0, at: 0, ok: false }, h: [],
  } } };
  const { log } = await loadUi({ dataFiles: { 'progress.json': JSON.stringify(progress) }, walked: true });
  globalThis.init();
  ticks(2);
  goTo('Learning Path');
  sheetPick('Show as list');
  toReview();
  goTo('Rock backbeat');
  ticks(1);
  assert.ok(drawnText(1).includes('L2  + kick'), drawnText(1).join('|'));
  cc(CC.jogTurn, 1);
  assert.match(log.announces.slice(-1)[0], /^level 3/, 'and the jog walks all the rungs from there');
});

/* ---- home ---------------------------------------------------------------- */

const homeNow = () => globalThis.drumsPracticeScreen().home;

test('home: the jog chooses a circle and it grows over 160 ms; clamped at both ends', async () => {
  const HR = await import('../src/home/render.mjs');
  await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.jogTurn, 2);
  assert.equal(homeNow().selected, 2);
  const g = homeNow().grow;
  assert.equal(g.to, 2);
  assert.ok(HR.radiusAt(g, 2, g.t0) < HR.R_LARGE && HR.radiusAt(g, 2, g.t0 + HR.GROW_MS) === HR.R_LARGE,
    'the circle grows to full size over the grow');
  assert.ok(drawnText(1).includes('Quiz'), 'the chosen circle is named');
  cc(CC.jogTurn, 20);
  assert.equal(homeNow().selected, 4, 'clamped at Settings');
  cc(CC.jogTurn, 108);
  assert.equal(homeNow().selected, 0, 'clamped at Path');
});

test('home: click opens a section, Back comes home with its circle chosen; the pads open and are silent', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  for (const [i, title] of [[0, 'Learning Path'], [1, 'Practice'], [2, 'Quiz'], [4, 'Settings']]) {
    cc(CC.jogTurn, 20); cc(CC.jogTurn, 108);
    if (i) cc(CC.jogTurn, i);
    cc(CC.jogClick, 127);
    assert.equal(globalThis.drumsPracticeMenu().title, title);
    cc(CC.back, 127);
    assert.equal(homeNow().selected, i, `${title}: Back did not come home on its circle`);
  }
  cc(CC.jogTurn, 108); cc(CC.jogTurn, 3); cc(CC.jogClick, 127);
  assert.equal(screenNow(), 'progress');
  cc(CC.back, 127);
  /* The pads: one per circle on the bottom row, 69..73, lit; the rest dark. */
  ticks(3);
  const lit = new Map();
  for (const [n, c] of log.leds) lit.set(n, c);
  for (const n of [69, 70, 71, 72, 73]) assert.notEqual(lit.get(n), 0, `pad ${n} is dark`);
  assert.equal(lit.get(68), 0);
  assert.equal(lit.get(80), 0);
  const before = log.params.length;
  pad(80, 100); pad(80, 0);
  pad(71, 100); pad(71, 0);
  ticks(2);
  assert.equal(log.params.slice(before).filter(isHit).length, 0, 'a pad sounded at home');
  assert.equal(globalThis.drumsPracticeMenu().title, 'Quiz', 'pad 71 is the third circle');
});

test('home: Menu is its help, Shift+click shows it as a list of five, Back makes it circles again', async () => {
  await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.menu, 127);
  assert.ok(drawnText(1).includes('HELP: HOME'));
  cc(CC.menu, 127);
  sheetPick('Show as list');
  assert.equal(homeNow(), null, 'still circles');
  const shown = drawnText(1);
  for (const t of ['Learning Path', 'Practice', 'Quiz', 'Progress']) assert.ok(shown.includes(t), shown.join('|'));
  cc(CC.back, 127);
  assert.ok(homeNow(), 'Back did not bring the circles back');
  assert.equal(globalThis.drumsPracticeScreen().exited, undefined);
});
