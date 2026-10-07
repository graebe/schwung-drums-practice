/*
 * Fault injection.
 *
 * The first hardware run wedged the screen and left nothing behind: a
 * successful init in the log, then silence. Whatever the original cause, the
 * unforgivable part was the SILENCE — a module that can fail without saying
 * why cannot be fixed, and a player left with a frozen OLED has to be told a
 * rescue chord.
 *
 * So these tests break things on purpose and assert that the module says so,
 * shuts up, writes it down, and can still be closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createScreen, countOn } from '../tools/screen_buffer.mjs';
import { DRILLS } from '../src/guess.mjs';

const SHARED = '/data/UserData/schwung/shared/';
const DIR = '/data/UserData/schwung/modules/tools/drums-practice';

/*
 * Load ui.js with a controllable clock, so the 20ms draw throttle fires on
 * every tick. The smoke test drives it in real time, where `performance.now()`
 * barely advances between calls and the draw path is almost never reached —
 * which is precisely how the draw path shipped unexercised.
 */
async function loadUi({ breakOn = null } = {}) {
  const log = { params: [], writes: {}, announces: [], leds: [], buttons: [] };
  const screen = createScreen();
  let clock = 0;
  const files = {};
  const exDir = new URL('../src/exercises/', import.meta.url);
  for (const f of readdirSync(exDir)) {
    files[`${DIR}/exercises/${f}`] = readFileSync(new URL(f, exDir), 'utf8');
  }

  /* Any host primitive can be made to throw, which is what a real host fault
   * looks like from inside the module. */
  const maybeThrow = (name) => {
    if (breakOn === name) throw new Error(`${name} exploded`);
  };

  globalThis.__log = log;
  globalThis.performance = { now: () => clock };
  Object.assign(globalThis, {
    clear_screen: () => { maybeThrow('clear_screen'); screen.clear(); },
    fill_rect: (x, y, w, h, v) => screen.fillRect(x, y, w, h, v),
    draw_rect: (x, y, w, h, v) => screen.drawRect(x, y, w, h, v),
    draw_line: (a, b, c, d, v) => screen.line(a, b, c, d, v),
    print: (x, y, s, v) => { maybeThrow('print'); screen.text(x, y, s, v); },
    text_width: (s) => screen.textWidth(s),
    host_read_file: (p) => { maybeThrow('host_read_file'); return files[p] ?? null; },
    host_write_file: (p, t) => { log.writes[p] = t; return true; },
    host_module_set_param: (k, v) => log.params.push([k, v]),
    move_midi_inject_to_move: () => {},
    move_midi_external_send: () => {},
    host_exit_module: () => { log.exited = (log.exited || 0) + 1; },
  });

  const inputFilter = `data:text/javascript,${encodeURIComponent(`
    export const setLED = (n, c) => globalThis.__log.leds.push([n, c]);
    export const setButtonLED = (cc, c) => globalThis.__log.buttons.push([cc, c]);
    export const invalidateLedCache = () => {};
    export const decodeDelta = (v) => (v === 0 ? 0 : v < 64 ? v : v - 128);
  `)}`;
  const screenReader = `data:text/javascript,${encodeURIComponent(`
    export const announce = (s) => globalThis.__log.announces.push(s);
  `)}`;

  /*
   * `breakOn: 'view'` simulates the realistic fault — a bug in this module's
   * OWN rendering code — by making the drill renderer throw while leaving the
   * error screen intact. Breaking a host primitive instead (print, say) is a
   * different and unrecoverable case: if the display cannot be written to,
   * nothing can be shown on it, and all the module can do is stop trying.
   */
  /* DOUBLE quotes inside: encodeURIComponent does not escape an apostrophe,
   * so a single-quoted import here would survive encoding and terminate the
   * `from '...'` string this URL is about to be pasted into. */
  const viewShim = `data:text/javascript,${encodeURIComponent(`
    export * from "${new URL('../src/view.mjs', import.meta.url).href}";
    export function drawReadingView() { throw new Error("view exploded"); }
  `)}`;
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8')
    .replace(`'${SHARED}input_filter.mjs'`, `'${inputFilter}'`)
    .replace(`'${SHARED}screen_reader.mjs'`, `'${screenReader}'`)
    .replace(/from '\.\/([a-z_]+)\.mjs'/g, (_m, n) => {
      if (n === 'view' && breakOn === 'view') return `from '${viewShim}'`;
      return `from '${new URL(`../src/${n}.mjs`, import.meta.url).href}'`;
    });
  /* A data: URL is cached by its full text, and ui.js keeps module-level
   * state (screen, error count, safe mode). Each test needs a FRESH instance,
   * so the source carries a unique trailing comment — appending a query
   * string instead would put the `?` inside the module and fail to parse. */
  const unique = `${src}\n//${Math.random()}`;
  await import(`data:text/javascript,${encodeURIComponent(unique)}`);

  /* 25ms a tick, so the draw throttle fires every time. */
  const ticks = (n) => { for (let i = 0; i < n; i++) { clock += 25; globalThis.tick(); } };
  return { log, screen, ticks, setClock: (v) => { clock = v; } };
}

const cc = (n, v) => globalThis.onMidiMessageInternal([0xb0, n, v]);
const pad = (n, v) => globalThis.onMidiMessageInternal([v > 0 ? 0x90 : 0x80, n, v]);
const CC = { jogTurn: 14, jogClick: 3, menu: 50, back: 51, play: 85, record: 86 };

test('a throw in the draw path never reaches the host', () => {
  /* QuickJS runs tick on shadow_ui\'s loop. An exception there stops the
   * frame, and the OLED simply keeps whatever it last had. */
  return loadUi({ breakOn: 'print' }).then(({ ticks }) => {
    globalThis.init();
    assert.doesNotThrow(() => ticks(20));
  });
});

test('a failure silences the kit rather than leaving it ringing', async () => {
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(10);
  assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'),
    'sixteen voices were left running behind a broken screen');
});

test('a failure is written down, so a freeze can be diagnosed afterwards', async () => {
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(10);
  const crash = log.writes[`${DIR}/crash.log`];
  assert.ok(crash, 'nothing was left behind to diagnose');
  assert.ok(/print exploded/.test(crash), `crash.log does not name the cause: ${crash}`);
  assert.ok(/init|tick|draw|midi/.test(crash), 'crash.log does not name the callback');
});

test('the crash file is written ONCE, not every frame', async () => {
  /* A path that throws fifty times a second would otherwise put an eMMC
   * write in the frame loop — which is how a fault becomes a brick. */
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(5);
  const first = log.writes[`${DIR}/crash.log`];
  ticks(60);
  assert.equal(log.writes[`${DIR}/crash.log`], first, 'the crash file was rewritten');
});

test('a throw in MIDI handling does not reach the host either', async () => {
  const { ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  assert.doesNotThrow(() => {
    for (let i = 0; i < 40; i++) { cc(CC.jogTurn, 1); pad(80, 100); pad(80, 0); }
    ticks(5);
  });
});

test('repeated failures stop the drill instead of retrying it forever', async () => {
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(40);
  /* Safe mode draws only the error. The proof it took hold is that nothing
   * more is announced and no new work is queued. */
  const before = log.params.length;
  ticks(40);
  assert.ok(log.params.length - before <= 2, 'the module is still grinding after giving up');
});

test('BACK still closes the module from the error screen', async () => {
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(10);
  cc(CC.back, 127);
  ticks(20);                  /* the exit drains the MIDI queue before it goes */
  assert.ok(log.exited >= 1, 'the player was trapped on the error screen');
});

test('closing gets all the way through even when part of it throws', async () => {
  /* A failure to write settings must not stop the panic, and a failure to
   * panic must not stop the pads going dark. */
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(6);
  const before = log.leds.length;
  globalThis.onUnload();
  const after = log.leds.slice(before);
  assert.ok(after.length >= 32, 'the pads were left lit');
  assert.ok(after.every(([, c]) => c === 0), 'a pad was left on');
  assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'));
  /* onUnload does NOT call host_exit_module: the host is already tearing us
   * down, and asking again answers a question nobody asked. */
  assert.equal(log.exited || 0, 0);
});

test('a broken settings file does not stop the module opening', async () => {
  const { log, ticks } = await loadUi({ breakOn: 'host_read_file' });
  globalThis.init();
  ticks(10);
  /* Reading threw, so there is an error — but the module is alive and the
   * player can still get out. */
  assert.doesNotThrow(() => ticks(10));
  cc(CC.back, 127);
  ticks(20);
  assert.ok(log.exited >= 1);
});

test('every screen state draws SOMETHING — a stale frame is impossible', async () => {
  /*
   * The bug this closes: draw() used to end with `if (screen === RUNNING &&
   * run)`, so any state whose data was missing drew nothing at all and the
   * OLED kept its last frame. That is indistinguishable from a hang.
   */
  const { screen, ticks } = await loadUi();
  globalThis.init();
  ticks(2);
  for (let i = 0; i < 26; i++) {
    cc(CC.menu, 127);
    ticks(2);
    for (let j = 0; j < i; j++) cc(CC.jogTurn, 1);
    cc(CC.jogClick, 127);
    ticks(4);
    cc(CC.record, 127);
    ticks(6);
    screen.clear();
    ticks(2);
    assert.ok(countOn(screen, 0, 0, 128, 64) > 20,
      `menu entry ${i} left the screen blank — the device would look frozen`);
    cc(CC.back, 127);
    ticks(2);
  }
});

test('a bug in the drill renderer lands on the error screen, naming the cause', async () => {
  const { log, screen, ticks } = await loadUi({ breakOn: 'view' });
  globalThis.init();
  ticks(2);
  /* Open a drill with no ladder and start it, which is what reaches the
   * renderer. */
  cc(CC.jogTurn, 1); cc(CC.jogTurn, 1);   /* Rudiments */
  cc(CC.jogClick, 127);                    /* › Rolls */
  cc(CC.jogClick, 127);                    /* › Single stroke roll */
  cc(CC.jogClick, 127);
  ticks(3);
  cc(CC.record, 127);
  ticks(8);

  const text = [];
  const orig = globalThis.print;
  globalThis.print = (x, y, s2, v) => { text.push(s2); orig(x, y, s2, v); };
  ticks(3);
  globalThis.print = orig;

  assert.ok(text.some((t) => /ERROR|STOPPED/.test(t)), `no error screen: ${text.join('|')}`);
  assert.ok(text.some((t) => /exploded/.test(t)), `the cause is not named: ${text.join('|')}`);
  /* The rescue chord has to be ON the screen: a player who does not know it
   * has no way out but the power cable. */
  assert.ok(text.some((t) => /SHIFT/.test(t)), `no rescue chord: ${text.join('|')}`);
  assert.ok(text.some((t) => /BACK/.test(t)), 'no way out on screen');
  assert.ok(log.params.some(([k, v]) => k === 'panic' && v === '1'), 'the kit was left ringing');
  assert.ok(countOn(screen, 0, 0, 128, 64) > 40);

  /* And Back still closes it. */
  cc(CC.back, 127);
  ticks(20);
  assert.ok(log.exited >= 1, 'the player was trapped on the error screen');
});

test('when even the error screen cannot be drawn, the module stops trying', async () => {
  /* A dead draw primitive means nothing can be displayed. Repainting anyway
   * would panic the engine and write the LED queue fifty times a second for
   * as long as the module stayed open. */
  const { log, ticks } = await loadUi({ breakOn: 'print' });
  globalThis.init();
  ticks(40);
  const params = log.params.length;
  const leds = log.leds.length;
  ticks(100);
  assert.ok(log.params.length - params <= 2, 'still panicking the engine every frame');
  assert.ok(log.leds.length - leds <= 40, 'still flooding the LED queue');
  /* Still closable, which is the whole point — leaving outranks safe mode. */
  cc(CC.back, 127);
  ticks(20);
  assert.ok(log.exited >= 1);
});
