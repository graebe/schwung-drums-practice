// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * L0: a groove with no clock. What a press does to the cursor, what counts as
 * right first time, and how the pace is measured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../src/scoring.mjs';
import * as UT from '../src/untimed.mjs';

/* One bar: hat+kick, hat, hat+snare (accented snare), hat. Two passes. */
function chart(extra = {}) {
  return {
    id: 'g:l0', name: 'g', bpm: 100, timeSig: [4, 4], loopBars: 1, repeats: 2, sticking: 'off',
    untimed: true,
    events: [
      { beat: 0, voices: ['HH', 'KK'] },
      { beat: 1, voices: ['HH'] },
      { beat: 2, voices: ['HH', 'SN'], dyn: { SN: 'accent' } },
      { beat: 3, voices: ['HH'] },
    ],
    ...extra,
  };
}

function setup(opts = {}, chartExtra = {}) {
  const run = SC.createRun(chart(chartExtra), { dynamics: opts.dynamics !== false, sticking: opts.sticking });
  return UT.createUntimed(run, { togetherMs: 60 });
}

const hit = (u, voice, at, vel = 80, hand = null) => UT.press(u, { voice, hand, velocity: vel }, at);

/* Strike stack after stack, correctly, `stepMs` apart. */
function playClean(u, stepMs, from = 0, vel = 80) {
  let t = from;
  while (!u.finished) {
    const e = UT.current(u);
    for (const n of e.notes) hit(u, n.voice, t, n.wantDyn === 'accent' ? 127 : vel);
    t += stepMs;
  }
  return t;
}

test('a one-drum stack moves the cursor on', () => {
  const u = setup();
  hit(u, 'HH', 0); hit(u, 'KK', 0);
  assert.equal(u.index, 1);
  const j = hit(u, 'HH', 500);
  assert.equal(j.complete, true);
  assert.equal(u.index, 2);
  assert.equal(u.firstTry, 2);
});

test('a stack struck together moves on; struck apart it is asked for again', () => {
  const u = setup();
  hit(u, 'HH', 0);
  assert.equal(u.index, 0, 'half a stack is not a stack');
  assert.equal(UT.current(u).notes[0].state, SC.HIT, 'the struck half shows');
  hit(u, 'KK', 40);
  assert.equal(u.index, 1, 'inside the window: one stack');

  const v = setup();
  hit(v, 'HH', 0);
  assert.deepEqual(UT.expire(v, 70), ['HH'], 'the lapsed half is handed back for the flash');
  assert.equal(UT.current(v).notes[0].state, SC.PENDING, 'and taken back');
  assert.equal(v.index, 0);
  hit(v, 'HH', 1000); hit(v, 'KK', 1010);
  assert.equal(v.index, 1);
  assert.equal(v.firstTry, 0, 'apart is not right first time');
  assert.equal(v.causes.apart, 1);
  assert.equal(v.run.entries[0].notes[1].state, SC.MISSED, 'it shows struck out');
});

test('a press after the window closes the old partial before it counts', () => {
  const u = setup();
  hit(u, 'HH', 0);
  hit(u, 'KK', 100);        /* lapsed: HH is taken back, KK opens a new partial */
  assert.equal(u.index, 0);
  hit(u, 'HH', 120);
  assert.equal(u.index, 1);
  assert.equal(u.causes.apart, 1);
});

test('a wrong pad keeps the cursor and spoils the stack; so does a second stroke', () => {
  const u = setup();
  const j = hit(u, 'SN', 0);
  assert.equal(j.result, 'stray');
  assert.equal(u.index, 0);
  hit(u, 'HH', 500); hit(u, 'KK', 500);
  assert.equal(u.index, 1);
  assert.equal(u.causes.wrong, 1);

  const v = setup();
  hit(v, 'HH', 0); hit(v, 'HH', 10);
  assert.equal(v.index, 0);
  assert.equal(UT.current(v).notes[0].state, SC.PENDING, 'the partial was reset');
  hit(v, 'HH', 500); hit(v, 'KK', 500);
  assert.equal(v.causes.again, 1);
  assert.equal(v.firstTry, 0);
});

test('a wrong hand under strict sticking moves on, but is not first time', () => {
  const run = SC.createRun(chart({ events: [{ beat: 0, voices: ['SN'], hand: 'R' },
    { beat: 1, voices: ['SN'], hand: 'L' }] }), { sticking: 'strict' });
  const u = UT.createUntimed(run, { togetherMs: 60 });
  const j = hit(u, 'SN', 0, 80, 'L');
  assert.equal(j.handOk, false);
  assert.equal(u.index, 1);
  hit(u, 'SN', 400, 80, 'L');
  assert.equal(u.firstTry, 1);
  assert.equal(u.causes.hand, 1);
  assert.equal(run.entries[0].notes[0].state, SC.HIT, 'a wrong hand is a ring, not a cross');
});

test('a soft accent, once the touch is known, is counted against the dynamics', () => {
  const u = setup();
  hit(u, 'HH', 0, 70); hit(u, 'KK', 0, 70);
  hit(u, 'HH', 500, 70);
  /* Three normal strokes known: the accent needs 70 + 15. */
  hit(u, 'HH', 1000, 70); hit(u, 'SN', 1000, 72);
  assert.equal(u.firstTry, 2);
  assert.equal(u.causes.accents.n, 1);
  assert.equal(u.causes.accents.vel, 72);
  assert.equal(u.causes.accents.need, 85);

  const off = setup({ dynamics: false });
  hit(off, 'HH', 0, 70); hit(off, 'KK', 0, 70);
  hit(off, 'HH', 500, 70);
  hit(off, 'HH', 1000, 70); hit(off, 'SN', 1000, 72);
  assert.equal(off.firstTry, 3, 'Dynamics off judges no accent');
});

test('the take runs both passes, across the seam, and then is through', () => {
  const u = setup();
  assert.equal(u.total, 8);
  playClean(u, 500);
  assert.equal(u.finished, true);
  assert.equal(u.stacks, 8);
  assert.equal(u.firstTry, 8);
  assert.equal(UT.progress(u), 1);
  assert.equal(u.run.entries[7].beat, 7, 'the second pass sits a loop on');
  assert.equal(hit(u, 'HH', 1e6), null, 'a press after the end does nothing');
});

test('Guide targets: the next stack first, what is left of this one last', () => {
  const u = setup();
  hit(u, 'HH', 0);
  const t = UT.targets(u);
  assert.deepEqual(t.map((x) => [x.voice, x.beatsAway]), [['HH', 1], ['KK', 0]],
    'the hat is struck already; the kick is now, the next hat after');
});

test('pace is beats a minute, whatever the rhythm of the stacks', () => {
  const u = setup();
  playClean(u, 500);
  /* Quarter-note stacks 500ms apart is 120 beats a minute. */
  assert.equal(Math.round(u.pace), 120);
  const g = UT.paceOf([[0.5, 500], [0.5, 500], [0.5, 500], [0.25, 250]]);
  assert.equal(Math.round(g), 60);
});

test('pace: a stop is left out, and too few gaps are no pace at all', () => {
  assert.equal(Math.round(UT.paceOf([[1, 500], [1, 500], [1, 10000], [1, 500]])), 120);
  assert.equal(UT.paceOf([[1, 500], [1, 500]]), 0);
  assert.equal(UT.paceOf([]), 0);
});

test('a pause drops a partial without blame, and its time never reaches the pace', () => {
  const u = setup();
  hit(u, 'HH', 0); hit(u, 'KK', 0);
  hit(u, 'HH', 500);
  hit(u, 'HH', 1000);
  UT.pause(u);
  assert.equal(UT.current(u).notes[0].state, SC.PENDING);
  assert.equal(u.fault, '', 'a pause is not a mistake');
  hit(u, 'HH', 60000); hit(u, 'SN', 60000, 127);
  hit(u, 'HH', 60500);
  hit(u, 'HH', 61000); hit(u, 'KK', 61000);
  assert.equal(u.gaps.length, 3, 'the gap across the pause is not measured');
  assert.equal(Math.round(u.pace), 120);
});

test('the live pace follows the recent stacks', () => {
  const u = setup({}, { repeats: 10 });
  let t = playCleanUntil(u, 1000, 0, 16);
  /* Seventeen: the first gap of the faster run still spans the change. */
  playCleanUntil(u, 400, t, 17);
  assert.ok(u.livePace > u.pace, `${u.livePace} vs ${u.pace}`);
  assert.equal(Math.round(u.livePace), 150);
});

function playCleanUntil(u, stepMs, from, n) {
  let t = from;
  for (let k = 0; k < n && !u.finished; k++) {
    const e = UT.current(u);
    for (const note of e.notes) hit(u, note.voice, t, note.wantDyn === 'accent' ? 127 : 80);
    t += stepMs;
  }
  return t;
}

test('counts carry what the verdict needs', () => {
  const u = setup();
  hit(u, 'SN', 0);
  playClean(u, 500, 100);
  const c = UT.counts(u);
  assert.equal(c.stacks, 8);
  assert.equal(c.firstTry, 7);
  assert.equal(c.wrong, 1);
  assert.ok(c.pace > 0);
});

test('a scrubbed start asks from where it was scrubbed to', () => {
  const run = SC.createRun(chart());
  SC.seekTo(run, 2);
  const u = UT.createUntimed(run, { togetherMs: 60, from: SC.nextEntryIndex(run, 2) });
  assert.equal(UT.current(u).beat, 2);
  assert.equal(u.total, 6);
});
