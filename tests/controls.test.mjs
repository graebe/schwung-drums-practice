import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/controls.mjs';

test('the transport says which mode the module is in', () => {
  const idle = C.transportColors(C.MODE_IDLE, true, 0.2);
  assert.equal(idle.play, C.PLAY_COLOR);
  assert.equal(idle.record, C.RECORD_COLOR);
  const off = C.transportColors(C.MODE_IDLE, true, 0.8);
  assert.equal(off.play, C.DIM, 'armed means pulsing');

  const listen = C.transportColors(C.MODE_LISTEN, true, 0.2);
  assert.equal(listen.play, C.PLAY_COLOR);
  assert.equal(listen.record, C.DIM, 'the one that is not running dims');

  const practise = C.transportColors(C.MODE_PRACTICE, true, 0.2);
  assert.equal(practise.record, C.RECORD_COLOR);
  assert.equal(practise.play, C.DIM);

  const nothing = C.transportColors(C.MODE_IDLE, false, 0.2);
  assert.equal(nothing.play, 0);
});

test('a jog turn does nothing while you are playing', () => {
  /* A knock must not change what you are playing. */
  assert.equal(C.jogTarget('running', false), 'none');
  assert.equal(C.jogTarget('ready', false), 'none');
  assert.equal(C.jogTarget('menu', false), 'menu');
  assert.equal(C.jogTarget('settings', false), 'row');
  assert.equal(C.jogTarget('settings', true), 'value');
  assert.equal(C.jogTarget('quiz', false), 'choice');
  assert.equal(C.jogTarget('progress', false), 'drill');
});

test('the count-in counts down and hands over at beat zero', () => {
  assert.equal(C.countInStart(4), -4);
  assert.equal(C.countInStart(0), 0);
  assert.deepEqual([-4, -3.5, -3, -2, -1, -0.2, 0, 1].map((b) => C.countInDigit(b, 4)),
    [4, 4, 3, 2, 1, 1, 0, 0]);
  assert.equal(C.countInDigit(-2, 0), 0, 'no count-in means no digits');
});

test('the click fires once per subdivision and knows the downbeat', () => {
  assert.deepEqual(C.clickAt(-0.01, 0.01, 1, 4), { downbeat: true, onBeat: true });
  assert.deepEqual(C.clickAt(0.99, 1.01, 1, 4), { downbeat: false, onBeat: true });
  assert.deepEqual(C.clickAt(3.99, 4.01, 1, 4), { downbeat: true, onBeat: true });
  assert.deepEqual(C.clickAt(0.49, 0.51, 2, 4), { downbeat: false, onBeat: false });
  assert.equal(C.clickAt(1.1, 1.2, 1, 4), null, 'no crossing, no click');
  assert.equal(C.clickAt(0, 4, 0, 4), null, 'a click that is off never fires');
});

test('the count-in has a downbeat, which is how you know it started', () => {
  assert.deepEqual(C.clickAt(-4.01, -3.99, 1, 4), { downbeat: true, onBeat: true });
  assert.deepEqual(C.clickAt(-3.01, -2.99, 1, 4), { downbeat: false, onBeat: true });
});

test('a sixteenth landing on bar one is still a sixteenth', () => {
  const at = C.clickAt(0.24, 0.26, 4, 4);
  assert.equal(at.onBeat, false);
  assert.equal(at.downbeat, false);
});

test('knob touch is below every pad', () => {
  assert.ok(C.KNOB_TOUCH_MAX < 68, 'pads start at 68');
});

test('the Clock drill alternates blocks of silence', () => {
  const bars = 4;
  const perBar = 4;
  assert.equal(C.clickMuted(0, bars, perBar), false, 'it starts by giving you the beat');
  assert.equal(C.clickMuted(15.9, bars, perBar), false);
  assert.equal(C.clickMuted(16, bars, perBar), true, 'then takes it away');
  assert.equal(C.clickMuted(31.9, bars, perBar), true);
  assert.equal(C.clickMuted(32, bars, perBar), false, 'and gives it back');
});

test('the count-in is never silenced — a test you cannot start is not a test', () => {
  assert.equal(C.clickMuted(-4, 4, 4), false);
  assert.equal(C.clickMuted(-0.1, 4, 4), false);
});

test('drift is measured from the start of the silence, not the top of the run', () => {
  assert.equal(C.silenceStart(0, 4, 4), null, 'nothing to measure while it is audible');
  assert.equal(C.silenceStart(16, 4, 4), 16);
  assert.equal(C.silenceStart(24, 4, 4), 16);
  assert.equal(C.silenceStart(48, 4, 4), 48, 'each stretch is measured on its own');
});

test('Clock off leaves the click alone', () => {
  assert.equal(C.clickMuted(100, 0, 4), false);
});
