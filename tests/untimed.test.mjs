// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * L0: a groove with no clock. What a press does to the cursor, what counts as
 * right first time, and how the pace is measured.
 *
 * A stack is judged when its together-window closes (settle), not on the
 * stroke that completes it — so a pad too many inside the window spoils it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../src/scoring.mjs';
import * as UT from '../src/untimed.mjs';

const WIN = 60;

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
  return UT.createUntimed(run, { togetherMs: WIN });
}

const hit = (u, voice, at, vel = 80, hand = null) => UT.press(u, { voice, hand, velocity: vel }, at);
/* Strike these drums together at `at`, then let the window close. */
function stack(u, voices, at, vel = 80, hand = null) {
  for (const v of voices) hit(u, v, at, typeof vel === 'function' ? vel(v) : vel, hand);
  return UT.settle(u, at + WIN + 1);
}
const accentSn = (v) => (v === 'SN' ? 127 : 80);

/* Strike stack after stack, correctly, `stepMs` apart. */
function playClean(u, stepMs, from = 0, n = Infinity) {
  let t = from;
  for (let k = 0; k < n && !u.finished; k++) {
    const e = UT.current(u);
    stack(u, e.notes.map((x) => x.voice), t,
      (v) => (e.notes.find((x) => x.voice === v).wantDyn === 'accent' ? 127 : 80));
    t += stepMs;
  }
  return t;
}

test('a stack moves the cursor on when its window closes, not on its last stroke', () => {
  const u = setup();
  hit(u, 'HH', 0); hit(u, 'KK', 0);
  assert.equal(u.index, 0, 'still open: another pad could yet spoil it');
  assert.equal(UT.settle(u, WIN), null, 'not before the window has passed');
  assert.deepEqual(UT.settle(u, WIN + 1), { complete: true });
  assert.equal(u.index, 1);
  assert.equal(u.firstTry, 1);
  stack(u, ['HH'], 500);
  assert.equal(u.index, 2);
});

test('pressing every drum at once never moves the cursor', () => {
  /* The owner's report: kick, snare and hat mashed together advanced through
   * every stack, even a hat alone, because the matching pad completed it. */
  const u = setup();
  stack(u, ['HH', 'KK'], 0);
  for (let t = 1000; t < 10000; t += 500) stack(u, ['KK', 'SN', 'HH'], t);
  assert.equal(u.index, 1, 'the hat alone was never taken by a mash');
  stack(u, ['HH'], 20000);
  assert.equal(u.index, 2, 'only the hat moves it on');
  assert.equal(u.firstTry, 1);
  assert.equal(u.causes.wrong, 1, 'one stack, one cause');
});

test('a pad too many after the stack is complete spoils it inside the window', () => {
  const u = setup();
  hit(u, 'HH', 0); hit(u, 'KK', 0);
  hit(u, 'SN', 30);
  UT.settle(u, 1000);
  assert.equal(u.index, 0, 'asked for again');
  assert.equal(UT.current(u).notes[0].state, SC.PENDING);
  stack(u, ['HH', 'KK'], 2000);
  assert.equal(u.index, 1);
  assert.equal(u.firstTry, 0);
  assert.equal(u.causes.wrong, 1);
});

test('a stack struck apart lapses and is asked for again', () => {
  const u = setup();
  hit(u, 'HH', 0);
  assert.equal(UT.current(u).notes[0].state, SC.HIT, 'the struck half shows');
  assert.deepEqual(UT.settle(u, 70), { lapsed: ['HH'] }, 'the lapsed half, for the flash');
  assert.equal(UT.current(u).notes[0].state, SC.PENDING, 'and taken back');
  assert.equal(u.index, 0);
  stack(u, ['HH', 'KK'], 1000);
  assert.equal(u.index, 1);
  assert.equal(u.firstTry, 0, 'apart is not right first time');
  assert.equal(u.causes.apart, 1);
  assert.equal(u.run.entries[0].notes[1].state, SC.MISSED, 'it shows struck out');
});

test('a press after the window settles the open stack first', () => {
  const u = setup();
  hit(u, 'HH', 0);
  hit(u, 'KK', 100);        /* lapsed: HH is taken back, KK opens a new partial */
  assert.equal(u.index, 0);
  hit(u, 'HH', 120);
  UT.settle(u, 200);
  assert.equal(u.index, 1);
  assert.equal(u.causes.apart, 1);

  const v = setup();
  hit(v, 'HH', 0); hit(v, 'KK', 0);
  hit(v, 'HH', 500);         /* the complete stack settles, then this opens the next */
  assert.equal(v.index, 1);
  UT.settle(v, 600);
  assert.equal(v.index, 2);
});

test('a wrong pad keeps the cursor and spoils the stack; so does a second stroke', () => {
  const u = setup();
  const j = hit(u, 'SN', 0);
  assert.equal(j.result, 'stray');
  assert.equal(u.index, 0);
  stack(u, ['HH', 'KK'], 500);
  assert.equal(u.index, 1);
  assert.equal(u.causes.wrong, 1);

  const v = setup();
  hit(v, 'HH', 0); hit(v, 'HH', 10);
  UT.settle(v, 100);
  assert.equal(UT.current(v).notes[0].state, SC.PENDING, 'the partial was taken back');
  stack(v, ['HH', 'KK'], 500);
  assert.equal(v.index, 1);
  assert.equal(v.causes.again, 1);
  assert.equal(v.firstTry, 0);
});

test('a wrong hand under strict sticking moves on, but is not first time', () => {
  const run = SC.createRun(chart({ events: [{ beat: 0, voices: ['SN'], hand: 'R' },
    { beat: 1, voices: ['SN'], hand: 'L' }] }), { sticking: 'strict' });
  const u = UT.createUntimed(run, { togetherMs: WIN });
  const j = hit(u, 'SN', 0, 80, 'L');
  assert.equal(j.handOk, false);
  UT.settle(u, 100);
  assert.equal(u.index, 1);
  stack(u, ['SN'], 400, 80, 'L');
  assert.equal(u.firstTry, 1);
  assert.equal(u.causes.hand, 1);
  assert.equal(run.entries[0].notes[0].state, SC.HIT, 'a wrong hand is a ring, not a cross');
});

test('a soft accent goes into the dynamics and keeps the stack right first time', () => {
  const u = setup();
  stack(u, ['HH', 'KK'], 0, 70);
  stack(u, ['HH'], 500, 70);
  /* Three normal strokes known: the accent needs 70 + 15. */
  stack(u, ['HH', 'SN'], 1000, (v) => (v === 'SN' ? 72 : 70));
  assert.equal(u.firstTry, 3, 'the right drums with the right hands are the right stack');
  const c = UT.counts(u);
  assert.equal(c.softAccents.n, 1);
  assert.equal(c.softAccents.vel, 72);
  assert.equal(c.softAccents.need, 85);
  assert.equal(c.dynErrors, 1);
  assert.equal(c.accents.n, 1);
  assert.ok(Math.abs(c.accents.credit - 2 / 15) < 1e-9, 'two of the fifteen steps it needed');

  const off = setup({ dynamics: false });
  stack(off, ['HH', 'KK'], 0, 70);
  stack(off, ['HH'], 500, 70);
  stack(off, ['HH', 'SN'], 1000, (v) => (v === 'SN' ? 72 : 70));
  assert.equal(off.firstTry, 3);
  assert.equal(UT.counts(off).accents.n, 0, 'Dynamics off judges no accent');
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
  assert.equal(UT.settle(u, 2e6), null);
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
  stack(u, ['HH', 'KK'], 0);
  stack(u, ['HH'], 500);
  hit(u, 'HH', 1000);
  UT.pause(u);
  assert.equal(UT.current(u).notes[0].state, SC.PENDING);
  assert.equal(u.fault, '', 'a pause is not a mistake');
  stack(u, ['HH', 'SN'], 60000, accentSn);
  stack(u, ['HH'], 60500);
  stack(u, ['HH', 'KK'], 61000);
  assert.equal(u.gaps.length, 3, 'the gap across the pause is not measured');
  assert.equal(Math.round(u.pace), 120);
});

test('the live pace follows the recent stacks', () => {
  const u = setup({}, { repeats: 10 });
  const t = playClean(u, 1000, 0, 16);
  /* Seventeen: the first gap of the faster run still spans the change. */
  playClean(u, 400, t, 17);
  assert.ok(u.livePace > u.pace, `${u.livePace} vs ${u.pace}`);
  assert.equal(Math.round(u.livePace), 150);
});

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
  const u = UT.createUntimed(run, { togetherMs: WIN, from: SC.nextEntryIndex(run, 2) });
  assert.equal(UT.current(u).beat, 2);
  assert.equal(u.total, 6);
});
