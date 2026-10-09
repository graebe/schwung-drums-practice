// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/generator.mjs';
import { validateExercise } from '../src/exercise_io.mjs';
import { chartTotalBeats, loopBeats } from '../src/chart.mjs';
import { beamsAt, tupletAt } from '../src/beam.mjs';

test('the same seed always yields the same drill', () => {
  /* This is what lets you re-attempt the bar you just fluffed instead of a
   * different one, and it is the only reason the generator is testable. */
  const a = G.readingLine({ seed: 42, bars: 2 });
  const b = G.readingLine({ seed: 42, bars: 2 });
  assert.deepEqual(a.events, b.events);
  const c = G.readingLine({ seed: 43, bars: 2 });
  assert.notDeepEqual(a.events, c.events);
});

test('every generated drill is a valid drill', () => {
  for (const chart of G.builtins()) {
    assert.deepEqual(validateExercise(chart), [], chart.id);
    assert.ok(chartTotalBeats(chart) < loopBeats(chart), `${chart.id} overruns its loop`);
  }
});

test('a subdivision drill lays its hits on the grid it names', () => {
  for (const [kind, per] of [['quarters', 1], ['eighths', 2], ['triplets', 3],
                             ['sixteenths', 4], ['sextuplets', 6]]) {
    const c = G.subdivisionDrill(kind, {});
    assert.equal(c.events.length, per * 4, kind);
    for (let i = 0; i < c.events.length; i++) {
      assert.ok(Math.abs(c.events[i].beat - i / per) < 1e-9, `${kind} at ${i}`);
    }
  }
});

test('subdivision drills alternate hands and accent the beat', () => {
  const c = G.subdivisionDrill('sixteenths', {});
  assert.equal(c.sticking, 'strict');
  for (let i = 1; i < c.events.length; i++) {
    assert.notEqual(c.events[i].hand, c.events[i - 1].hand, 'hands must alternate');
  }
  const accents = c.events.filter((e) => e.dyn === 'accent');
  assert.equal(accents.length, 4, 'one accent per beat');
  for (const a of accents) assert.equal(a.beat % 1, 0);
});

test('triplets and sextuplets are engraved as tuplets', () => {
  for (const [kind, n] of [['triplets', 3], ['sextuplets', 6]]) {
    const c = G.subdivisionDrill(kind, {});
    assert.equal(tupletAt(c.events, 0, 1), n, kind);
  }
  assert.equal(beamsAt(G.subdivisionDrill('triplets', {}).events, 0, 1), 1);
});

test('the switching drill changes subdivision each bar', () => {
  const c = G.subdivisionLadder({});
  assert.equal(c.loopBars, 4);
  const perBar = [0, 1, 2, 3].map((b) =>
    c.events.filter((e) => e.beat >= b * 4 && e.beat < (b + 1) * 4).length);
  assert.deepEqual(perBar, [4, 8, 12, 16], 'quarters, eighths, triplets, sixteenths');
});

test('a reading line always sounds the downbeat', () => {
  /* A bar whose downbeat is a rest drills finding the downbeat, which is a
   * different and much harder skill than the one on offer. */
  for (let seed = 1; seed < 30; seed++) {
    const c = G.readingLine({ seed, bars: 2, per: 4, density: 0.2 });
    for (const bar of [0, 1]) {
      assert.ok(c.events.some((e) => Math.abs(e.beat - bar * 4) < 1e-9), `seed ${seed} bar ${bar}`);
    }
  }
});

test('density controls how full a reading line is', () => {
  const sparse = G.readingLine({ seed: 5, bars: 4, per: 4, density: 0.1 });
  const dense = G.readingLine({ seed: 5, bars: 4, per: 4, density: 0.9 });
  assert.ok(dense.events.length > sparse.events.length * 2);
});

test('a groove variation keeps its ostinato and moves only the snare', () => {
  const a = G.grooveVariation({ seed: 1 });
  const b = G.grooveVariation({ seed: 9 });
  const hats = (c) => c.events.filter((e) => e.voices.includes('HH')).map((e) => e.beat);
  const kicks = (c) => c.events.filter((e) => e.voices.includes('KK')).map((e) => e.beat);
  assert.deepEqual(hats(a), hats(b), 'the hat must not move');
  assert.deepEqual(kicks(a), kicks(b), 'the kick must not move');
  const snares = (c) => c.events.filter((e) => e.voices.includes('SN')).map((e) => e.beat);
  assert.equal(snares(a).length, 2);
  assert.notDeepEqual(snares(a), snares(b), 'something has to change');
});

test('a snare never lands on the downbeat, where it would fight the kick', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (const e of G.grooveVariation({ seed }).events) {
      if (e.voices.includes('SN')) assert.notEqual(e.beat % 4, 0, `seed ${seed}`);
    }
  }
});

test('the sticking drill asks a hand of every stroke', () => {
  const c = G.stickingDrill({ seed: 3 });
  assert.equal(c.sticking, 'strict');
  for (const e of c.events) assert.ok(e.hand === 'R' || e.hand === 'L');
});
