import test from 'node:test';
import assert from 'node:assert/strict';
import * as LAD from '../src/ladder.mjs';
import { createRun, judgeHit, expireMissed } from '../src/scoring.mjs';

const chart = {
  bpm: 80, timeSig: [4, 4], loopBars: 1, sticking: 'strict',
  events: [
    { beat: 0, voices: ['SN'], hand: 'R', dyn: 'accent' },
    { beat: 1, voices: ['SN'], hand: 'L' },
    { beat: 2, voices: ['SN'], hand: 'R' },
    { beat: 3, voices: ['SN'], hand: 'L' },
  ],
};

function runFor(opts = {}) {
  return createRun(chart, {
    sticking: 'strict', dynamics: true, looping: true, strictness: 'normal', ...opts,
  });
}

function playBar(run, from, { hand = true, dyn = true, timing = 0, skip = -1 } = {}) {
  for (let b = 0; b < 4; b++) {
    if (b === skip) continue;
    const e = run.entries.find((x) => Math.abs(x.beat - (from + b)) < 1e-6);
    if (!e) continue;
    const n = e.notes[0];
    judgeHit(run, {
      voice: n.voice,
      hand: hand ? n.wantHand : (n.wantHand === 'R' ? 'L' : 'R'),
      velocity: dyn ? (n.wantDyn === 'accent' ? 110 : 90) : 30,
    }, e.beat + timing);
  }
}

test('a clean rung climbs and records the tempo', () => {
  const run = runFor();
  const l = LAD.createLadder({ bpm: 80, bars: 1, step: 5 });
  LAD.beginRung(l, run, 0);
  playBar(run, 0);
  const v = LAD.judgeRung(l, run, 4);
  assert.equal(v.clean, true, v.reason);
  LAD.applyVerdict(l, v);
  assert.equal(l.rungs, 1);
  assert.equal(l.topClean, 80, 'the score is the tempo it was HELD at');
  assert.equal(l.bpm, 85, 'and the next rung is harder');
  assert.equal(LAD.ladderFinished(l), false);
});

test('clean means all four axes at once', () => {
  /* A rung climbed on three of the four would put the tempo up on a pattern
   * the player is not actually playing. */
  const cases = [
    ['sticking', { hand: false }],
    ['dynamics', { dyn: false }],
    ['missed', { skip: 2 }],
  ];
  for (const [reason, opts] of cases) {
    const run = runFor();
    const l = LAD.createLadder({ bpm: 80, bars: 1 });
    LAD.beginRung(l, run, 0);
    playBar(run, 0, opts);
    expireMissed(run, 4);
    const v = LAD.judgeRung(l, run, 4);
    assert.equal(v.clean, false, `${reason} should have failed the rung`);
    assert.equal(v.reason, reason);
  }
});

test('a scattered bar fails even with every note hit', () => {
  const run = runFor();
  const l = LAD.createLadder({ bpm: 80, bars: 1 });
  LAD.beginRung(l, run, 0);
  /* Every note landed, and every one INSIDE its window — but alternately
   * early and late by 55ms, so the spread is 55 against a 30ms threshold.
   * Hitting everything is not the same as playing it. */
  for (let b = 0; b < 4; b++) {
    const e = run.entries.find((x) => Math.abs(x.beat - b) < 1e-6);
    const n = e.notes[0];
    judgeHit(run, { voice: n.voice, hand: n.wantHand, velocity: 100 },
      e.beat + (b % 2 ? 0.0733 : -0.0733));
  }
  assert.equal(run.hits, 4, 'every note must actually have counted as a hit');
  assert.equal(run.strays, 0);
  const v = LAD.judgeRung(l, run, 4);
  assert.equal(v.clean, false);
  assert.equal(v.reason, 'too loose');
});

test('playing nothing is not a clean rung', () => {
  const run = runFor();
  const l = LAD.createLadder({ bpm: 80, bars: 1 });
  LAD.beginRung(l, run, 0);
  const v = LAD.judgeRung(l, run, 4);
  assert.equal(v.clean, false);
  assert.equal(v.reason, 'nothing played');
});

test('failing ends the ladder with the last clean tempo standing', () => {
  const run = runFor();
  const l = LAD.createLadder({ bpm: 80, bars: 1, step: 10 });
  LAD.beginRung(l, run, 0);
  playBar(run, 0);
  LAD.applyVerdict(l, LAD.judgeRung(l, run, 4));
  assert.equal(l.topClean, 80);

  LAD.beginRung(l, run, 4);
  playBar(run, 4, { hand: false });
  LAD.applyVerdict(l, LAD.judgeRung(l, run, 8));
  assert.equal(l.failed, true);
  assert.equal(l.topClean, 80, 'the score is what was actually held, not what was attempted');
});

test('the ladder tops out rather than climbing forever', () => {
  const l = LAD.createLadder({ bpm: 200, step: 20, maxBpm: 240 });
  for (let i = 0; i < 10 && !l.failed; i++) {
    LAD.applyVerdict(l, { clean: true, sdMs: 1, meanMs: 0, n: 8 });
  }
  assert.ok(l.bpm <= 240);
  assert.equal(l.failed, true);
});

test('a rung spans the bars it was asked for, in the metre it is in', () => {
  const l = LAD.createLadder({ bars: 4 });
  LAD.beginRung(l, { hits: 0, misses: 0, strays: 0, stickErrors: 0, dynErrors: 0 }, 8);
  assert.equal(LAD.rungEnd(l, 4), 24);
  assert.equal(LAD.rungEnd(l, 3), 20, 'three-four has shorter bars');
});
