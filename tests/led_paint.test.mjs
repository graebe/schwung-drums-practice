import test from 'node:test';
import assert from 'node:assert/strict';
import { paint, flashColor } from '../src/led_paint.mjs';
import * as P from '../src/padmap.mjs';

const buf = () => new Array(P.PAD_COUNT).fill(-1);
const at = (out, pad) => out[pad - P.PAD_FIRST];

test('a pad with no voice stays dark, one with a voice is dimly lit', () => {
  const out = paint(buf(), { layout: 'kit' });
  for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
    assert.equal(at(out, pad), P.padVoice(pad, 'kit') ? P.LED_VOICE : P.LED_OFF);
  }
});

test('a judgement outranks the finger that caused it', () => {
  /* The press is still down when the verdict arrives; showing the finger
   * would hide the answer exactly when it is useful. */
  const out = paint(buf(), {
    layout: 'kit',
    held: { has: (p) => p === 80 },
    flash: { pads: [80], color: P.LED_MISS },
  });
  assert.equal(at(out, 80), P.LED_MISS);
});

test('the finger outranks the guidance', () => {
  const out = paint(buf(), {
    layout: 'kit',
    held: { has: (p) => p === 80 },
    targets: [{ voice: 'SN', hand: null, beatsAway: 0.1 }],
  });
  assert.equal(at(out, 80), P.LED_PRESSED);
});

test('wrong hand has its own colour, told apart from a miss', () => {
  /* "Right drum, wrong hand" is a different mistake, fixed differently. If it
   * shared red you would never learn to tell them apart mid-bar. */
  assert.equal(flashColor({ result: 'perfect', handOk: false }), P.LED_STICK);
  assert.equal(flashColor({ result: 'perfect', handOk: true, dynOk: false }), P.LED_STICK);
  assert.equal(flashColor({ result: 'good', handOk: true, dynOk: true }), P.LED_HIT);
  assert.equal(flashColor({ result: 'stray' }), P.LED_MISS);
  assert.equal(flashColor({ result: 'late' }), P.LED_MISS);
  assert.equal(flashColor(null), P.LED_OFF);
  assert.notEqual(P.LED_STICK, P.LED_MISS);
  assert.notEqual(P.LED_STICK, P.LED_HIT);
});

test('guidance brightens as the hit approaches, and stops when it is far off', () => {
  const near = paint(buf(), { layout: 'kit', targets: [{ voice: 'SN', beatsAway: 0.1 }] });
  const far = paint(buf(), { layout: 'kit', targets: [{ voice: 'SN', beatsAway: 1.0 }] });
  const away = paint(buf(), { layout: 'kit', targets: [{ voice: 'SN', beatsAway: 8 }] });
  const snare = P.padsForVoice('SN', 'kit')[0];
  assert.equal(at(near, snare), P.LED_TARGET_NEAR);
  assert.equal(at(far, snare), P.LED_TARGET_FAR);
  assert.equal(at(away, snare), P.LED_VOICE, 'a hit eight beats out is not guidance');
});

test('guidance lights only the hand being asked for', () => {
  /* Lighting both halves would answer the question the drill is asking. */
  const out = paint(buf(), { layout: 'kit', targets: [{ voice: 'SN', hand: 'R', beatsAway: 0.1 }] });
  for (const pad of P.padsForVoice('SN', 'kit', 'R')) assert.equal(at(out, pad), P.LED_TARGET_NEAR);
  for (const pad of P.padsForVoice('SN', 'kit', 'L')) assert.equal(at(out, pad), P.LED_VOICE);
});

test('painting allocates nothing — it fills the array it was given', () => {
  /* It runs on every LED frame; the pitched module records killing a
   * 34k-allocations-per-second path of exactly this shape. */
  const out = buf();
  const same = paint(out, { layout: 'kit', targets: [{ voice: 'KK', beatsAway: 0.2 }] });
  assert.equal(same, out);
});

test('dark blanks everything, whatever else is set', () => {
  const out = paint(buf(), {
    layout: 'kit', dark: true, held: { has: () => true },
    flash: { pads: [70], color: P.LED_HIT },
  });
  assert.ok(out.every((c) => c === P.LED_OFF));
});

/* ---- what the guide pads point at --------------------------------------- */

import { guideTargets } from '../src/led_paint.mjs';
import { createRun, ensureEntries } from '../src/scoring.mjs';

const chart = {
  bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 4, sticking: 'strict',
  events: [
    { beat: 0, voices: ['SN'], hand: 'R' },
    { beat: 1, voices: ['SN'], hand: 'L' },
    { beat: 2, voices: ['KK', 'HH'] },
  ],
};

test('guidance looks ahead, nearest first, and not far', () => {
  /* A pad lit for a hit eight beats away is decoration, not guidance. */
  const run = createRun(chart, { sticking: 'strict' });
  ensureEntries(run, 16);
  const near = guideTargets(run, 0);
  assert.ok(near.length > 0);
  assert.equal(near[0].voice, 'SN');
  assert.ok(near[0].beatsAway <= near[near.length - 1].beatsAway, 'not in order');
  for (const t of near) assert.ok(t.beatsAway <= 1.5, `${t.beatsAway} beats out is not guidance`);
});

test('guidance names the hand only when the drill enforces sticking', () => {
  const strict = createRun(chart, { sticking: 'strict' });
  assert.equal(guideTargets(strict, 0)[0].hand, 'R');
  const off = createRun(chart, { sticking: 'off' });
  assert.equal(guideTargets(off, 0)[0].hand, null, 'lighting both hands answers the question');
});

test('guidance is bounded, and copes with no run at all', () => {
  const run = createRun(chart, { sticking: 'off' });
  ensureEntries(run, 64);
  assert.ok(guideTargets(run, 0, 6).length <= 6);
  assert.deepEqual(guideTargets(null, 0), []);
});

test('a stack points at every voice in it', () => {
  const run = createRun(chart, { sticking: 'off' });
  ensureEntries(run, 16);
  const at2 = guideTargets(run, 2).filter((t) => Math.abs(t.beatsAway) < 1e-9);
  assert.deepEqual(at2.map((t) => t.voice).sort(), ['HH', 'KK']);
});
