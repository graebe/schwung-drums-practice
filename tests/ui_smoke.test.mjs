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
import { readFileSync, readdirSync } from 'node:fs';
import { createScreen } from '../tools/screen_buffer.mjs';

const SHARED = '/data/UserData/schwung/shared/';

async function loadUi() {
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  const log = { leds: [], buttons: [], params: [], midi: [], writes: {}, announces: [], exited: 0 };
  const screen = createScreen();

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

  await import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
  return { log, screen };
}

const CC = { jogTurn: 14, jogClick: 3, menu: 50, back: 51, play: 85, record: 86, knob1: 71 };
const cc = (n, v) => globalThis.onMidiMessageInternal([0x0b, 0xb0, n, v]);
const pad = (n, v) => globalThis.onMidiMessageInternal([0x09, v > 0 ? 0x90 : 0x80, n, v]);
const ticks = (n) => { for (let i = 0; i < n; i++) globalThis.tick(); };

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

  assert.ok(log.params.some(([k]) => k === 'n'), 'no hits ever reached the engine');
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
  const writes = log.params.slice(before).filter(([k]) => k === 'n');
  assert.equal(writes.length, 1, 'three pads in one frame must be one write');
  assert.ok(writes[0][1].split(',').length >= 2, 'the write lost hits');
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
  assert.equal(log.params.slice(before).filter(([k]) => k === 'n').length, 0);
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
  cc(CC.knob1, 1);
  cc(CC.knob1, 1);
  ticks(3);
  const path = '/data/UserData/schwung/modules/tools/drums-practice/settings.json';
  assert.equal(log.writes[path], undefined, 'an eMMC write landed in the frame path');
  globalThis.onUnload();
  assert.ok(log.writes[path], 'settings were never written');
  assert.equal(JSON.parse(log.writes[path]).bpm, 92, 'the knob did not move the tempo');
});

test('closing silences the engine, darkens the pads and drains the queue', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  const before = log.leds.length;
  globalThis.onUnload();
  assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'), 'the kit was left ringing');
  const after = log.leds.slice(before);
  assert.ok(after.length >= 32, 'the pads were left lit');
  assert.ok(after.every(([, c]) => c === 0), 'a pad was left on');
  assert.equal(log.exited, 1);
});

test('back walks out one level at a time and then closes', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  for (let i = 0; i < 10; i++) cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127);
  ticks(3);
  cc(CC.back, 127);            /* drill -> menu */
  ticks(2);
  assert.equal(log.exited, 0, 'the first back should not have closed the module');
  cc(CC.back, 127);            /* menu -> out   */
  assert.equal(log.exited, 1);
});
