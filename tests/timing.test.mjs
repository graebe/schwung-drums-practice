import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/timing.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('mean and sigma are the textbook ones, against hand-computed values', () => {
  const acc = T.createTiming();
  /* [5,15,5,15]: mean 10, population variance 25, sigma 5. */
  for (const v of [5, 15, 5, 15]) T.pushOffset(acc, 'SN', v, 0);
  const s = T.stats(acc);
  assert.equal(s.n, 4);
  near(s.meanMs, 10);
  near(s.sdMs, 5);
  assert.equal(s.minMs, 5);
  assert.equal(s.maxMs, 15);
});

test('identical hits have exactly zero spread, not a floating-point sliver', () => {
  const acc = T.createTiming();
  for (let i = 0; i < 50; i++) T.pushOffset(acc, 'KK', 37, i);
  const s = T.stats(acc);
  assert.equal(s.sdMs, 0);
  near(s.meanMs, 37);
});

test('an empty accumulator reports nothing rather than NaN', () => {
  const s = T.stats(T.createTiming());
  assert.deepEqual(s, { n: 0, meanMs: 0, sdMs: 0, minMs: 0, maxMs: 0 });
  assert.equal(T.verdict(s), 'no hits');
  assert.deepEqual(T.perVoice(T.createTiming()), {});
  assert.deepEqual(T.recentOffsets(T.createTiming()), []);
});

test('negative is early — one sign convention, everywhere', () => {
  const acc = T.createTiming();
  T.pushOffset(acc, 'SN', -40, 0);
  assert.ok(T.stats(acc).meanMs < 0);
  assert.equal(T.verdict(T.stats(acc)), 'rushing');
  const late = T.createTiming();
  T.pushOffset(late, 'SN', 40, 0);
  assert.equal(T.verdict(T.stats(late)), 'dragging');
});

test('sigma outranks bias — scattered beats late', () => {
  /* A player who is consistently 40ms late has one easy thing to fix; one who
   * is all over the place does not, and must be told that first. */
  assert.equal(T.verdict({ n: 10, meanMs: 40, sdMs: 90 }), 'scattered');
  assert.equal(T.verdict({ n: 10, meanMs: 2, sdMs: 40 }), 'loose');
  assert.equal(T.verdict({ n: 10, meanMs: 2, sdMs: 8 }), 'tight');
});

test('per-voice breakdown separates the limbs', () => {
  const acc = T.createTiming();
  for (const v of [1, -1]) T.pushOffset(acc, 'HH', v, 0);
  for (const v of [50, 70]) T.pushOffset(acc, 'KK', v, 0);
  const pv = T.perVoice(acc);
  near(pv.HH.meanMs, 0);
  near(pv.KK.meanMs, 60);
  near(pv.KK.sdMs, 10);
  /* The session mean hides exactly this, which is why the table exists. */
  near(T.stats(acc).meanMs, 30);
  assert.deepEqual(T.voicesBySpread(acc), ['KK', 'HH']);
});

test('the rolling window is asked for in beats, not in hits', () => {
  const acc = T.createTiming();
  T.pushOffset(acc, 'SN', 100, 0);
  T.pushOffset(acc, 'SN', 100, 1);
  T.pushOffset(acc, 'SN', 0, 8);
  T.pushOffset(acc, 'SN', 0, 9);
  near(T.statsSince(acc, 8).meanMs, 0, 1e-9);
  assert.equal(T.statsSince(acc, 8).n, 2);
  near(T.stats(acc).meanMs, 50);
  assert.equal(T.statsSince(acc, 999).n, 0);
});

test('the ring is bounded but the session totals are not', () => {
  const acc = T.createTiming(4);
  for (let i = 0; i < 100; i++) T.pushOffset(acc, 'SN', 10, i);
  assert.equal(acc.ring.length, 4, 'memory stays flat however long you play');
  assert.equal(T.stats(acc).n, 100, 'the session still knows about all of them');
  assert.equal(T.recentStats(acc, 10).n, 4);
  assert.deepEqual(T.recentOffsets(acc, 2), [10, 10]);
});

test('a hit past the span folds into the end bucket rather than vanishing', () => {
  const acc = T.createTiming();
  T.pushOffset(acc, 'SN', 5000, 0);
  T.pushOffset(acc, 'SN', -5000, 0);
  const h = T.histogram(acc, 5, 100);
  assert.equal(h.reduce((a, b) => a + b, 0), 2, 'no hit is silently dropped');
  assert.equal(h[0], 1);
  assert.equal(h[4], 1);
});

test('the histogram puts zero in the middle bucket', () => {
  const acc = T.createTiming();
  T.pushOffset(acc, 'SN', 0, 0);
  const h = T.histogram(acc, 5, 100);
  assert.deepEqual(h, [0, 0, 1, 0, 0]);
});

test('a non-finite offset is refused rather than poisoning the mean', () => {
  const acc = T.createTiming();
  T.pushOffset(acc, 'SN', 10, 0);
  T.pushOffset(acc, 'SN', NaN, 0);
  T.pushOffset(acc, 'SN', Infinity, 0);
  assert.equal(T.stats(acc).n, 1);
  near(T.stats(acc).meanMs, 10);
});
