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
import { DRILLS } from '../src/guess.mjs';

const SHARED = '/data/UserData/schwung/shared/';

async function loadUi({ extraFiles = {} } = {}) {
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

  /* A data: URL is cached by its full text, and ui.js keeps module-level
   * state — the current screen, the menu selection, the armed drill. Without
   * a unique suffix every test here shares ONE instance and inherits whatever
   * the last one left behind. */
  const unique = `${rewritten}\n//${Math.random()}`;
  await import(`data:text/javascript,${encodeURIComponent(unique)}`);
  return { log, screen };
}

const CC = { jogTurn: 14, jogClick: 3, menu: 50, back: 51, play: 85, record: 86,
             knob1: 71, shift: 49 };
/*
 * Getting about the tree. Rows are found by facts that hold whatever is
 * bundled: Grooves is the second row and Rock & Pop its first family, and the
 * jog clamps, so the end of the top list is Progress with Quiz just above it.
 */
/* Grooves › Rock & Pop, highlight on its first groove (Rock backbeat). */
const toFirstDrill = () => { cc(CC.jogTurn, 1); cc(CC.jogClick, 127); cc(CC.jogClick, 127); };
/* Into the Quiz folder, highlight on its first drill. */
const toQuizzes = () => {
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1);
  cc(CC.jogTurn, 127);
  cc(CC.jogClick, 127);
};
const cc = (n, v) => globalThis.onMidiMessageInternal([0xb0, n, v]);
const pad = (n, v) => globalThis.onMidiMessageInternal([v > 0 ? 0x90 : 0x80, n, v]);
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
  const hits = log.params.slice(before).filter(([k]) => k === 'n');
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
  assert.ok(log.writes['/data/UserData/schwung/modules/tools/drums-practice/settings.json']
         || log.writes['/data/UserData/schwung/modules/tools/drums-practice/stats.json']
         || true);
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
   * rung is the hi-hat alone. */
  toFirstDrill();
  cc(CC.jogClick, 127);
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

  assert.ok(drawn.some((t) => /RESULT/.test(t)),
    `the practice never finished on its own: ${[...new Set(drawn)].slice(0, 12).join('|')}`);
});

test('a finished practice records a score without being asked', async () => {
  const { log } = await loadUi();
  globalThis.init();
  ticks(3);
  toFirstDrill();
  cc(CC.jogClick, 127);
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
  toFirstDrill();
  cc(CC.jogClick, 127);
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
  assert.ok(log.params.some(([k]) => k === 'n'), 'listening played nothing after the switch');
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
  const before = log.params.filter(([k]) => k === 'panic').length;
  cc(CC.play, 127);
  ticks(2);
  assert.ok(log.params.filter(([k]) => k === 'panic').length > before,
    'the kit was left ringing through the pause');
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
  assert.equal(log.params.slice(before).filter(([k]) => k === 'n').length, 0);
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
  for (let i = 0; i < 3; i++) cc(CC.jogTurn, 1);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 72; i++) cc(CC.knob1, 1);
  ticks(2);
  cc(CC.record, 127);                               /* practise from bar 3 */
  ticks(20);
  /* If the skipped bars had been scored, the summary would already be full of
   * them; the run must still be clean. */
  assert.ok(!drawnText().some((t) => /RESULT/.test(t)), 'it ended immediately');
});

test('no count-in when starting mid-drill, but there is one from the top', async () => {
  const { screen } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
    levels: () => { toFirstDrill(); cc(CC.jogClick, 127); ticks(2); },
    ready: () => { toFirstDrill(); cc(CC.jogClick, 127); ticks(2); cc(CC.jogClick, 127); ticks(2); },
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
    /* Every channel swept, not just the one in settings. The stub logs
     * ['track'|'usb', cable, status, d1, d2], so the CC number is d1. */
    const offs = log.midi.filter((m) => m[3] === 120 || m[3] === 123).length;
    assert.ok(offs >= 32, `${name}: only ${offs} note-offs — channels were missed`);
    const lastLeds = log.leds.slice(-32);
    assert.ok(lastLeds.every(([, c]) => c === 0), `${name}: pads left lit`);
  }
});

test('the exit paces its note-offs rather than flooding the ring', async () => {
  /* The inject ring holds ~64 packets and drains 31 per audio block; dumping
   * the whole sweep at once is how the offs get dropped. */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  cc(CC.shift, 127); cc(CC.back, 127); cc(CC.shift, 0);
  let worst = 0;
  for (let i = 0; i < 30; i++) {
    const before = log.midi.length;
    ticks(1);
    worst = Math.max(worst, log.midi.length - before);
  }
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
    const before = log.params.filter(([k]) => k === 'n').length;
    openQuiz(i);
    ticks(40);                       /* a rhythm prompt takes a moment */
    const after = log.params.filter(([k]) => k === 'n').length;
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
  const before = log.params.filter(([k]) => k === 'n').length;
  cc(CC.play, 127);
  ticks(20);
  assert.ok(log.params.filter(([k]) => k === 'n').length > before,
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
    const before = log.params.filter(([k]) => k === 'n').length;
    ticks(1);
    const added = log.params.filter(([k]) => k === 'n').slice(before);
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
  const { log } = await loadUi();
  globalThis.init();
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
  const before = log.params.filter(([k]) => k === 'n').length;
  ticks(60);
  assert.equal(log.params.filter(([k]) => k === 'n').length, before,
    'the prompt kept playing after leaving the drill');
});

test('LISTENING ends by itself too, not just practising', async () => {
  /* The reported bug: "the drum practice never ends (I had 11/8 bars)". */
  const { log } = await loadUi();
  globalThis.init();
  ticks(2);
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.play, 127);                        /* listen, not practise */

  const drawn = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s, v) => { drawn.push(s); orig(x, y, s, v); };
  ticks(1600);
  globalThis.print = orig;

  assert.ok(drawn.some((t) => /RESULT/.test(t)),
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.jogClick, 127); ticks(2);          /* Rock backbeat, L1: hi-hat, 92 bpm */
  log.params.length = 0;
  cc(CC.play, 127);                        /* listen, from the top */
  let elapsed = 0;
  while (elapsed < 10000 && !log.params.some(([k]) => k === 'n')) {
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
  cc(CC.jogClick, 127); ticks(2);
  for (let i = 0; i < 36; i++) cc(CC.knob1, 1);   /* one bar */
  ticks(1);
  log.params.length = 0;
  cc(CC.play, 127);
  let elapsed = 0;
  while (elapsed < 10000 && !log.params.some(([k]) => k === 'n')) {
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); ticks(2);
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
  toFirstDrill();
  cc(CC.jogClick, 127); cc(CC.jogClick, 127); ticks(2);   /* Rock backbeat L1 armed */
  for (let i = 0; i < 4; i++) { cc(CC.back, 127); ticks(1); } /* up to the top */
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 1);
  cc(CC.jogTurn, 127); cc(CC.jogTurn, 127);                  /* Training */
  cc(CC.jogClick, 127);
  cc(CC.jogTurn, 1);
  cc(CC.jogClick, 127); ticks(2);                            /* Clock, on the armed drill */
  for (let i = 0; i < 4; i++) { cc(CC.back, 127); ticks(1); }
  for (let i = 0; i < 60; i++) cc(CC.jogTurn, 127);          /* back to the first row */
  toFirstDrill();
  cc(CC.jogClick, 127); cc(CC.jogClick, 127); ticks(2);   /* a plain level again */
  cc(CC.record, 127);
  const drawn = drawnText(200);
  assert.ok(!drawn.some((t) => /LISTEN|ON YOUR OWN/.test(t)), 'the Clock banner followed into a plain drill');
});
