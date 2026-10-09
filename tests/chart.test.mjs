// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/chart.mjs';
import * as L from '../src/layout.mjs';

const chart = {
  bpm: 120, timeSig: [4, 4], loopBars: 1,
  events: [{ beat: 0, voices: ['KK'] }, { beat: 1, voices: ['SN'] },
           { beat: 2, voices: ['KK'] }, { beat: 3, voices: ['SN'] }],
};

test('beat and x are inverses of each other', () => {
  for (const songBeats of [0, 1.5, 17.25]) {
    for (const px of [L.PX_PER_BEAT_MIN, 24, L.PX_PER_BEAT_MAX]) {
      const x = C.beatToX(5, songBeats, px);
      assert.ok(Math.abs(C.xToBeat(x, songBeats, px) - 5) < 1e-9);
    }
  }
  assert.equal(C.beatToX(3, 3, 24), L.HIT_X, 'the current beat sits on the hit line');
});

test('ms and beats are inverses of each other', () => {
  assert.equal(C.beatsToMs(1, 120), 500);
  assert.equal(C.msToBeats(500, 120), 1);
  assert.ok(Math.abs(C.msToBeats(C.beatsToMs(2.5, 93), 93) - 2.5) < 1e-9);
});

test('time signature decides the bar, not the beat unit', () => {
  assert.equal(C.beatsPerBar({ timeSig: [4, 4] }), 4);
  assert.equal(C.beatsPerBar({ timeSig: [3, 4] }), 3);
  assert.equal(C.beatsPerBar({ timeSig: [6, 8] }), 3, 'six eighths is three quarter-beats');
  assert.equal(C.beatsPerBar({ timeSig: [7, 8] }), 3.5);
  assert.equal(C.beatsPerBar({}), 4, 'defaults to 4/4');
});

test('a loop is always a whole number of bars', () => {
  assert.equal(C.loopBeats(chart), 4);
  assert.equal(C.loopBeats({ ...chart, loopBars: 2 }), 8);
  /* A drill that runs 5 beats rounds UP to two bars: a loop that repeats
   * mid-bar has no beat 1 to play against. */
  assert.equal(C.loopBeats({ timeSig: [4, 4], events: [{ beat: 4.5, voices: ['SN'] }] }), 8);
  assert.equal(C.loopBeats({ timeSig: [4, 4], events: [] }), 4, 'never zero-length');
});

test('each repeat shifts by exactly one loop', () => {
  assert.deepEqual(C.expandEvents(chart, 0).map((e) => e.beat), [0, 1, 2, 3]);
  assert.deepEqual(C.expandEvents(chart, 2).map((e) => e.beat), [8, 9, 10, 11]);
  assert.equal(C.expandEvents(chart, 1)[0].voices[0], 'KK', 'the material is unchanged');
  assert.equal(chart.events[0].beat, 0, 'expanding must not mutate the chart');
});

test('bar lines march on under a loop, with no gap or doubling at the seam', () => {
  const px = 24;
  const seen = new Set();
  for (let t = 0; t < 12; t += 0.25) {
    for (const bar of C.visibleBars(chart, t, px)) seen.add(bar.beat);
  }
  const beats = [...seen].sort((a, b) => a - b);
  assert.deepEqual(beats, [0, 4, 8, 12], 'one line per bar, none missing, none twice');
});

test('a one-pass drill stops drawing bar lines past its end', () => {
  const bars = C.visibleBars(chart, 0, 24, 4);
  assert.deepEqual(bars.map((b) => b.beat), [0, 4]);
});

test('iterationAt tells which repeat a beat belongs to', () => {
  assert.equal(C.iterationAt(chart, 0), 0);
  assert.equal(C.iterationAt(chart, 3.99), 0);
  assert.equal(C.iterationAt(chart, 4), 1);
  assert.equal(C.iterationAt(chart, 9), 2);
});

test('the header counts bars through the whole practice', () => {
  /* "bar 3 of a one-bar loop" tells you nothing; "bar 3 of 8" tells you how
   * much is left, which is the only reason to put it on screen. */
  const four = { ...chart, loopBars: 4, repeats: 2 };   /* 8 bars in all */
  assert.deepEqual(C.barBeatOf(four, 0), { bar: 1, bars: 8, beat: 1, rep: 1, reps: 2 });
  assert.deepEqual(C.barBeatOf(four, 9.5), { bar: 3, bars: 8, beat: 2, rep: 1, reps: 2 });
  assert.deepEqual(C.barBeatOf(four, 17), { bar: 5, bars: 8, beat: 2, rep: 2, reps: 2 });
  assert.equal(C.barBeatOf(four, -3).bar, 1, 'the count-in is not bar zero');
});

test('an endless drill has no total to count against', () => {
  const e = { ...chart, repeats: 0 };
  assert.equal(C.practiceBars(e), 0);
  assert.equal(C.barBeatOf(e, 20).bars, 0, 'the caller shows the absolute bar instead');
  assert.equal(C.practiceBeats(e), Infinity);
  assert.equal(C.practiceProgress(e, 100), 0, 'there is no fraction of forever');
});

test('a practice states its own length, and silence is never forever', () => {
  assert.equal(C.repeatsOf({ repeats: 4 }), 4);
  assert.equal(C.repeatsOf({ repeats: 0 }), 0, '0 is endless, and deliberate');
  assert.equal(C.repeatsOf({}), C.DEFAULT_REPEATS, 'a file that says nothing still ends');
  assert.equal(C.repeatsOf({ repeats: -2 }), C.DEFAULT_REPEATS);
  const eight = { ...chart, loopBars: 1, repeats: 8 };
  assert.equal(C.practiceBeats(eight), 32);
  assert.equal(C.practiceBars(eight), 8);
  assert.ok(Math.abs(C.practiceSeconds(eight) - 16) < 0.01, '32 beats at 120bpm is 16s');
  assert.ok(Math.abs(C.practiceProgress(eight, 8) - 0.25) < 1e-9);
});

test('beat and subdivision edges fire once each, on the frame they happen', () => {
  assert.equal(C.isBeatEdge(0.9, 1.1), true);
  assert.equal(C.isBeatEdge(1.1, 1.2), false);
  assert.equal(C.isSubdivEdge(0.4, 0.6, 2), true, 'the & of the beat');
  assert.equal(C.isSubdivEdge(0.1, 0.2, 2), false);
  assert.equal(C.isSubdivEdge(0.1, 0.2, 0), false, 'a click that is off never fires');
});

test('waiting holds the playhead and resumes in tempo, never lurching', () => {
  const a = C.applyWait(5, 0, null);
  assert.deepEqual(a, { songBeats: 5, waitedBeats: 0, blocked: false, scoreBeats: 5, frozenAt: null });
  const b = C.applyWait(5, 0, 3);
  assert.deepEqual(b, { songBeats: 3, waitedBeats: 2, blocked: true, scoreBeats: 5, frozenAt: 0 });
  /* Two beats of real time passed while frozen; releasing resumes AT 3, not 5. */
  const c = C.applyWait(5, b.waitedBeats, null);
  assert.equal(c.songBeats, 3);
  assert.equal(c.blocked, false);
});

test('the visible window runs from the despawn edge to the right edge', () => {
  const { fromBeat, toBeat } = C.visibleRange(10, 24);
  assert.ok(fromBeat < 10 && 10 < toBeat);
  assert.ok(Math.abs(C.beatToX(fromBeat, 10, 24) - L.DESPAWN_X) < 1e-9);
  assert.ok(Math.abs(C.beatToX(toBeat, 10, 24) - L.SPAWN_X) < 1e-9);
});

test('a label is trimmed to the gap before the next one', () => {
  const vis = [{ x: 10 }, { x: 30 }];
  assert.equal(C.labelLimitPx(vis, 0, 24), 18);
  assert.equal(C.labelLimitPx(vis, 1, 24), L.SCREEN_W - 30, 'the last one runs to the edge');
});

test('while frozen the judge keeps real time, frame after frame', () => {
  /* Frame 1 folds the overshoot into waitedBeats; without frozenAt, frame 2
   * would read rawBeats - waitedBeats and pin the judge to the block point. */
  const f1 = C.applyWait(3.5, 0, 3, null);
  const f2 = C.applyWait(4.5, f1.waitedBeats, 3, f1.frozenAt);
  assert.equal(f2.songBeats, 3, 'the scroll stays on the note');
  assert.equal(f2.scoreBeats, 4.5, 'the judge has seen every beat go by');
  /* Released on that same instant: the scroll resumes from the note, and the
   * two clocks agree again. */
  const released = C.applyWait(4.5, f2.waitedBeats, null, f2.frozenAt);
  assert.equal(released.songBeats, 3, 'released, it resumes from the note');
  assert.equal(released.scoreBeats, 3);
  assert.equal(released.frozenAt, null);
});
