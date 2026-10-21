// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/scoring.mjs';
import { beatsToMs } from '../src/chart.mjs';
import { stats, perVoice } from '../src/timing.mjs';

/* 120bpm: one beat is 500ms, so a 30ms perfect window is 0.06 beats. */
const para = {
  bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1, sticking: 'strict',
  events: [
    { beat: 0,    voices: ['SN'], hand: 'R', dyn: 'accent' },
    { beat: 0.25, voices: ['SN'], hand: 'L' },
    { beat: 0.5,  voices: ['SN'], hand: 'R' },
    { beat: 0.75, voices: ['SN'], hand: 'R' },
  ],
};
const groove = {
  bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1,
  events: [{ beat: 0, voices: ['KK', 'HH'] }, { beat: 1, voices: ['SN', 'HH'] }],
};

const mk = (chart, opts = {}) => S.createRun(chart, { sticking: 'off', ...opts });
const endless = (chart, opts = {}) => mk(chart, { repeats: 0, ...opts });

test('a run starts with every note pending and nothing scored', () => {
  const run = mk(para);
  assert.equal(run.entries.length, 4);
  assert.equal(run.totalNotes, 4);
  assert.deepEqual(S.runStats(run), {
    hits: 0, perfects: 0, misses: 0, strays: 0, stickErrors: 0, dynErrors: 0,
    softAccents: { n: 0, vel: 0, need: 0 }, loudGhosts: { n: 0, vel: 0, need: 0 },
    combo: 0, bestCombo: 0, asked: 0, total: 4,
  });
});

test('the windows come from the strictness setting', () => {
  assert.equal(mk(para, { strictness: 'tight' }).windows.perfectMs, 15);
  assert.equal(mk(para, { strictness: 'loose' }).windows.lateMs, 160);
  assert.equal(mk(para).windows.perfectMs, 30, 'normal by default');
  assert.equal(mk(para, { strictness: 'nonsense' }).windows.perfectMs, 30);
});

test('dead on the beat is perfect; inside good is good; outside is a stray', () => {
  const run = mk(para);
  assert.equal(S.judgeHit(run, { voice: 'SN' }, 0).result, 'perfect');
  /* 0.25 + 0.08 beats = 40ms late: past perfect (30) inside good (60). */
  assert.equal(S.judgeHit(run, { voice: 'SN' }, 0.33).result, 'good');
  /* Nowhere near anything pending. */
  assert.equal(S.judgeHit(run, { voice: 'SN' }, 2.5).result, 'stray');
  assert.equal(run.strays, 1);
});

test('a wrong hand played dead on the beat scores its timing AND a sticking error', () => {
  /* This is the whole point of the module: the axes do not contaminate each
   * other. A perfectly-timed stroke with the wrong stick is good news about
   * your time and bad news about your sticking, and must read as both. */
  const run = mk(para, { sticking: 'strict' });
  const j = S.judgeHit(run, { voice: 'SN', hand: 'L', velocity: 110 }, 0);
  assert.equal(j.result, 'perfect', 'the timing is still perfect');
  assert.equal(j.handOk, false);
  assert.equal(j.wantHand, 'R');
  assert.equal(run.hits, 1, 'it is a hit');
  assert.equal(run.misses, 0, 'it is not a miss');
  assert.equal(run.stickErrors, 1, 'and it is a sticking error');
  assert.equal(stats(run.timing).n, 1, 'its timing still counts towards sigma');
});

test('loose sticking shows the wrong hand without counting it', () => {
  const run = mk(para, { sticking: 'loose' });
  const j = S.judgeHit(run, { voice: 'SN', hand: 'L', velocity: 110 }, 0);
  assert.equal(j.handOk, false, 'still reported, so the amber still shows');
  assert.equal(run.stickErrors, 0, 'but the run is not marked down for it');
});

test('sticking off ignores hands entirely — right for a groove', () => {
  const run = mk(groove, { sticking: 'off' });
  const j = S.judgeHit(run, { voice: 'KK', hand: 'L' }, 0);
  assert.equal(j.handOk, true);
  assert.equal(run.stickErrors, 0);
});

/* Three normal strokes then a dynamic one, for the dynamics tests: an accent
 * or a ghost is judged against the strokes before it. */
const lastDyn = (dyn) => ({
  bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1,
  events: [
    { beat: 0, voices: ['SN'] }, { beat: 1, voices: ['SN'] }, { beat: 2, voices: ['SN'] },
    { beat: 3, voices: ['SN'], dyn },
  ],
});
function playDyn(dyn, normal, last, opts = {}) {
  const run = mk(lastDyn(dyn), { dynamics: true, ...opts });
  for (let b = 0; b < 3; b++) S.judgeHit(run, { voice: 'SN', velocity: normal }, b);
  return { run, j: S.judgeHit(run, { voice: 'SN', velocity: last }, 3) };
}

test('an accent played softly is a dynamic error, not a miss', () => {
  const { run, j } = playDyn('accent', 70, 74);
  assert.equal(j.result, 'perfect');
  assert.equal(j.dynOk, false);
  assert.equal(j.wantDyn, 'accent');
  assert.equal(j.need, 70 + S.ACCENT_LIFT, 'judged against the strokes before it');
  assert.equal(run.hits, 4);
  assert.equal(run.misses, 0, 'a quiet accent is not a missed note');
  assert.equal(run.dynErrors, 1);
  assert.deepEqual(run.softAccents, { n: 1, vel: 74, need: 85 });
});

test('an accent is a CONTRAST: louder than your own strokes, at any level', () => {
  /* A soft player's accent passes well below the old fixed 90 ... */
  assert.equal(playDyn('accent', 50, 70).j.dynOk, true);
  /* ... and hitting everything flat out is no accent at all. */
  assert.equal(playDyn('accent', 127, 127).j.dynOk, false);
  assert.equal(playDyn('accent', 127, 127).j.need, 142, 'no room left above to accent');
  /* The lift is a setting. */
  assert.equal(playDyn('accent', 70, 80, { accentLift: 10 }).j.dynOk, true);
  assert.equal(playDyn('accent', 70, 79, { accentLift: 10 }).j.dynOk, false);
});

test('a ghost note played hard is a dynamic error', () => {
  assert.equal(playDyn('ghost', 80, 75).j.dynOk, false);
  assert.equal(playDyn('ghost', 80, 60).j.dynOk, true, 'GHOST_DROP under the strokes is a ghost');
  const { run } = playDyn('ghost', 80, 75);
  assert.deepEqual(run.loudGhosts, { n: 1, vel: 75, need: 60 });
});

test('with nothing to be louder than, a dynamic is not judged', () => {
  /* The first note of a take has no strokes before it. Judging it against a
   * fixed number instead is what failed every accent on some pads. */
  const run = mk(para, { dynamics: true });
  const j = S.judgeHit(run, { voice: 'SN', hand: 'R', velocity: 10 }, 0);
  assert.equal(j.dynOk, true);
  assert.equal(j.need, 0);
  assert.equal(run.dynErrors, 0);
});

test('the reference is the MEDIAN of the recent normal strokes', () => {
  const run = mk(lastDyn('accent'), { dynamics: true });
  /* One wild stroke does not move a median. */
  for (const [b, v] of [[0, 60], [1, 127], [2, 62]]) S.judgeHit(run, { voice: 'SN', velocity: v }, b);
  assert.equal(S.dynNeed(run, 'accent', 80), 62 + S.ACCENT_LIFT);
  assert.equal(S.dynNeed(run, 'normal', 80), 0, 'a normal stroke is not judged for loudness');
  assert.equal(S.dynNeed(run, 'accent', undefined), 0, 'nor a press the host gave no velocity');
  for (let i = 0; i < S.TOUCH_SPAN + 4; i++) run.touch.push(i < 4 ? 1 : 100);
  run.touch.splice(0, run.touch.length - S.TOUCH_SPAN);
  assert.equal(S.dynNeed(run, 'accent', 80), 100 + S.ACCENT_LIFT, 'and it follows the recent ones');
});

test('a dynamic error scrubbed back over is taken back with its kind', () => {
  const { run } = playDyn('accent', 70, 74);
  S.seekTo(run, 2.5);
  assert.equal(run.dynErrors, 0);
  assert.deepEqual(run.softAccents, { n: 0, vel: 0, need: 0 });
  const note = run.entries[3].notes[0];
  assert.equal(note.velocity, null);
  assert.equal(note.need, 0);
});

test('dynamics off, or a velocity the host did not send, never penalises', () => {
  const run = mk(para, { dynamics: false });
  assert.equal(S.judgeHit(run, { voice: 'SN', velocity: 1 }, 0).dynOk, true);
  const noVel = mk(para, { dynamics: true });
  assert.equal(S.judgeHit(noVel, { voice: 'SN' }, 0).dynOk, true);
  assert.equal(noVel.dynErrors, 0);
});

test('simultaneous voices are judged one at a time', () => {
  const run = mk(groove);
  S.judgeHit(run, { voice: 'KK' }, 0);
  assert.equal(run.entries[0].state, S.PENDING, 'the hat is still owed');
  S.expireMissed(run, 1.0);
  assert.equal(run.entries[0].state, 'partial', 'one hit, one missed, in one stack');
  assert.equal(run.hits, 1);
  assert.equal(run.misses, 1);
});

test('a note past its late window is gone, and breaks the combo', () => {
  const run = mk(para);
  S.judgeHit(run, { voice: 'SN' }, 0);
  assert.equal(run.combo, 1);
  S.expireMissed(run, 1.0);
  assert.equal(run.misses, 3);
  assert.equal(run.combo, 0);
  assert.equal(run.bestCombo, 1);
});

test('latency is corrected once, at the door', () => {
  /* A rig 40ms late reports every stroke 40ms late. Left uncorrected the mean
   * is a lie no amount of practice can fix. */
  const raw = mk(para, { latencyMs: 0 });
  const j1 = S.judgeHit(raw, { voice: 'SN' }, 0.08);
  assert.ok(Math.abs(j1.offsetMs - 40) < 1e-6);

  const fixed = mk(para, { latencyMs: 40 });
  const j2 = S.judgeHit(fixed, { voice: 'SN' }, 0.08);
  assert.ok(Math.abs(j2.offsetMs) < 1e-6, 'corrected back to dead on');
  assert.equal(j2.result, 'perfect');
});

test('offsets feed the timing accumulator, per voice', () => {
  const run = mk(groove);
  S.judgeHit(run, { voice: 'KK' }, 0.02);   /* 10ms late */
  S.judgeHit(run, { voice: 'HH' }, -0.02);  /* 10ms early */
  const pv = perVoice(run.timing);
  assert.ok(Math.abs(pv.KK.meanMs - 10) < 1e-6);
  assert.ok(Math.abs(pv.HH.meanMs + 10) < 1e-6);
});

test('an endless drill materialises ahead of the playhead and never finishes', () => {
  const run = mk(para, { repeats: 0 });
  const first = run.entries.length;
  assert.ok(first > 4, 'more than one repeat is ready up front');
  S.ensureEntries(run, 40);
  assert.ok(run.entries.length > first);
  assert.equal(S.runFinished(run, 1e6), false, 'endless ends when you stop it');
  /* Repeat 1 sits exactly one loop later. */
  assert.equal(run.entries[4].beat, 4);
  assert.equal(run.entries[4].iter, 1);
});

test('a one-pass drill finishes once the last note has scrolled past', () => {
  const run = mk(para, { repeats: 1 });
  assert.equal(run.entries.length, 4, 'exactly one pass, no repeats');
  for (const b of [0, 0.25, 0.5, 0.75]) S.judgeHit(run, { voice: 'SN' }, b);
  assert.equal(S.runFinished(run, 0.75), false);
  assert.equal(S.runFinished(run, 5), true);
  assert.equal(S.runFinished(run, 5, true), false, 'not while frozen on a note');
});

test('pruning keeps memory flat and never strands a cursor', () => {
  const run = mk(para, { repeats: 0 });
  for (let i = 0; i < 40; i++) {
    S.ensureEntries(run, i);
    S.expireMissed(run, i);
    S.pruneEntries(run, i - 2);
    assert.ok(run.cursor >= 0 && run.cursor <= run.entries.length, `cursor at ${i}`);
    assert.ok(run.waitCursor >= 0 && run.waitCursor <= run.entries.length);
  }
  assert.ok(run.dropped > 0, 'something was actually pruned');
  assert.ok(run.entries.length < 100, 'the list does not grow without bound');
});

test('pruning never drops a note still owed', () => {
  const run = mk(para, { repeats: 0 });
  S.ensureEntries(run, 20);
  const before = run.entries.length;
  S.pruneEntries(run, 1e6);
  assert.equal(run.entries.length, before, 'nothing resolved yet, so nothing goes');
});

test('visible entries carry their own scoring state — one list, no correlation', () => {
  const run = mk(para, { repeats: 0 });
  S.judgeHit(run, { voice: 'SN' }, 0);
  const vis = S.visibleEntries(run, 0, 24);
  assert.ok(vis.length > 0);
  assert.equal(vis[0].entry.notes[0].state, S.HIT);
  assert.ok(vis.every((v, i) => i === 0 || v.x > vis[i - 1].x), 'left to right');
});

test('the seam is continuous — every repeat exact, none missing, none twice', () => {
  const run = mk(para, { repeats: 0 });
  const seen = new Set();
  for (let t = 0; t < 12; t += 0.1) {
    S.ensureEntries(run, t);
    for (const v of S.visibleEntries(run, t, 24)) seen.add(+v.beat.toFixed(3));
  }
  const beats = [...seen].sort((a, b) => a - b);
  /* The drill is four sixteenths at the top of a four-beat bar, so each
   * repeat is that figure shifted by exactly one loop — and the silence in
   * between is a rest, not a gap. */
  const loop = 4;
  const figure = [0, 0.25, 0.5, 0.75];
  const expected = [];
  for (let i = 0; i * loop <= beats[beats.length - 1]; i++) {
    for (const f of figure) {
      const b = i * loop + f;
      if (b <= beats[beats.length - 1]) expected.push(b);
    }
  }
  assert.deepEqual(beats, expected);
  assert.ok(beats.length >= 12, 'at least three repeats were walked');
});

test('Study mode freezes on the note you owe, and playing it releases', () => {
  const run = mk(para, { repeats: 1 });
  S.expireMissed(run, 1.0, true);
  assert.equal(run.misses, 1, 'only the note the scroll is on can expire');
  const notes = S.blockingNotes(run);
  assert.equal(notes.length, 1, 'stuck on the first unplayed note');
  assert.equal(S.blockingEntryIndex(run), 0);
  const j = S.judgeHit(run, { voice: 'SN' }, 1.0);
  assert.equal(j.result, 'late', 'the miss stands; it is not taken back');
  assert.equal(run.hits, 0);
  assert.equal(S.blockingEntryIndex(run), 1, 'and the freeze moves on');
});

test('Study freezes on the note itself, on the hit line', () => {
  /* It used to freeze a beat or more past the note — off the left edge, so the
   * note it was waiting for was the one not drawn. */
  const run = mk(para);
  assert.equal(S.blockingBeat(run), 0);
  S.judgeHit(run, { voice: 'SN', hand: 'R' }, 0);
  assert.equal(S.blockingBeat(run), run.entries[1].beat);
});

/*
 * ONE PRESS RELEASES A HALT — Piano Practice's bug, which drums had too. The
 * judge's clock runs on while the scroll is frozen, so the NEXT snare drifted
 * into the window and took the press, leaving the frozen one unplayed.
 */
test('frozen on a missed snare, one press of it releases the scroll', () => {
  const run = mk(para, { repeats: 1 });
  /* Scroll pinned at beat 0; the honest clock has run on to 0.25, where the
   * next snare is. */
  S.expireMissed(run, 0.25, true);
  assert.equal(run.entries[0].notes[0].state, S.MISSED);
  const j = S.judgeHit(run, { voice: 'SN', hand: 'L' }, 0.25, 0);
  assert.equal(j.result, 'late', 'the press is the frozen note, released late');
  assert.equal(run.entries[0].notes[0].played, true);
  assert.equal(run.entries[1].notes[0].state, S.PENDING, 'the unseen next snare is untouched');
  assert.equal(S.blockingEntryIndex(run), 1);
});

test('frozen inside the window, the press is an ordinary hit on the honest clock', () => {
  const run = mk(para, { repeats: 1 });
  const t = run.good / 2;
  const j = S.judgeHit(run, { voice: 'SN', hand: 'R' }, t, 0);
  assert.equal(j.result === 'good' || j.result === 'perfect', true);
  assert.equal(j.entryIndex, 0);
  assert.ok(Math.abs(j.offsetBeats - t) < 1e-9, 'scored on real time, not the frozen 0');
});

test('frozen past the window but not yet expired: the press releases it as a miss', () => {
  /* The dead zone between `good` and `late`: before, nothing matched and the
   * right pad scored a stray while the scroll sat there. */
  const run = mk(para, { repeats: 1 });
  const t = (run.good + run.late) / 2;
  assert.equal(run.entries[0].notes[0].state, S.PENDING);
  const j = S.judgeHit(run, { voice: 'SN', hand: 'R' }, t, 0);
  assert.equal(j.result, 'late');
  assert.equal(run.misses, 1, 'counted as the miss it was about to become');
  assert.equal(run.strays, 0);
  assert.equal(S.blockingEntryIndex(run), 1);
});

test('the wrong drum while frozen is a stray and releases nothing', () => {
  const run = mk(para, { repeats: 1 });
  S.expireMissed(run, 0.2, true);
  assert.equal(S.judgeHit(run, { voice: 'KK' }, 0.2, 0).result, 'stray');
  assert.equal(S.blockingEntryIndex(run), 0);
});

test('waiting never expires a note the scroll has not reached', () => {
  const run = mk(para, { repeats: 1 });
  /* Frozen on note 0 for a whole bar of real time. */
  S.expireMissed(run, 4, true);
  assert.equal(run.misses, 1, 'only the note being waited for');
  assert.equal(run.entries[1].notes[0].state, S.PENDING);
});

test('resyncWait does not let the clock jump backwards', () => {
  const run = mk(para, { repeats: 1 });
  S.resyncWait(run, 0.6);
  assert.equal(S.blockingEntryIndex(run), 3, 'everything behind the playhead is let go');
});

test('markers record the exact moment of every press, and are pruned', () => {
  const run = mk(para);
  S.addMarker(run, 'SN', 0.02, 'R');
  S.addMarker(run, 'SN', 1.02, 'L');
  assert.deepEqual(run.markers[0], { beat: 0.02, voice: 'SN', hand: 'R' });
  S.pruneMarkers(run, 1.0);
  assert.equal(run.markers.length, 1);
  for (let i = 0; i < 200; i++) S.addMarker(run, 'SN', i, 'R', 64);
  assert.equal(run.markers.length, 64, 'bounded');
});

test('a snapshot measures a window without resetting the run', () => {
  const run = mk(para, { sticking: 'strict' });
  S.judgeHit(run, { voice: 'SN', hand: 'R' }, 0);
  const snap = S.snapshot(run, 0.25);
  S.judgeHit(run, { voice: 'SN', hand: 'R' }, 0.25);  /* wanted L */
  const d = S.since(run, snap);
  assert.equal(d.hits, 1);
  assert.equal(d.stickErrors, 1);
  assert.equal(snap.beat, 0.25);
  assert.equal(run.hits, 2, 'the run itself is untouched');
});

test('a chart with no sticking written never raises a sticking error', () => {
  const run = mk(groove, { sticking: 'strict' });
  S.judgeHit(run, { voice: 'KK', hand: 'L' }, 0);
  S.judgeHit(run, { voice: 'HH', hand: 'R' }, 0);
  assert.equal(run.stickErrors, 0, 'strict cannot invent a hand the chart did not ask for');
});

/* ---- a practice has an end ---------------------------------------------- */

test('a practice ENDS by itself after the repeats its file declares', () => {
  /*
   * The bug this closes: runFinished began `if (run.looping) return false`,
   * so a drill ran until the player interrupted it — which meant it never
   * showed a summary and never recorded a score unless they thought to. The
   * file now says how long the practice is, and it finishes on its own.
   */
  const chart = { ...para, repeats: 4 };
  const run = mk(chart);
  assert.equal(run.repeats, 4);
  assert.equal(run.endBeat, 16, 'four repeats of a four-beat bar');

  let finishedAt = null;
  for (let t = 0; t <= 24 && finishedAt === null; t += 0.25) {
    S.ensureEntries(run, t + 8);
    S.expireMissed(run, t);
    if (S.runFinished(run, t)) finishedAt = t;
  }
  assert.ok(finishedAt !== null, 'the practice never finished');
  assert.ok(finishedAt >= 16, `finished at beat ${finishedAt}, before the declared bars ran out`);
  assert.ok(finishedAt < 18, `finished at beat ${finishedAt}, long after the end`);
});

test('exactly the declared repeats are materialised, and no more', () => {
  const run = mk({ ...para, repeats: 3 });
  for (let t = 0; t < 40; t += 0.5) S.ensureEntries(run, t + 8);
  assert.equal(run.iters, 3);
  const last = run.entries[run.entries.length - 1];
  assert.ok(last.beat < 12, `an entry at beat ${last.beat} is past the end`);
  assert.equal(run.entries.length, para.events.length * 3);
});

test('repeats 0 is endless, and stays endless — the Ladder depends on it', () => {
  const run = endless(para);
  for (let t = 0; t < 60; t += 1) S.ensureEntries(run, t + 8);
  assert.equal(S.runFinished(run, 1e6), false);
  assert.equal(S.runProgress(run, 100), 0, 'there is no fraction of forever');
});

test('progress runs 0 to 1 across the whole practice', () => {
  const run = mk({ ...para, repeats: 4 });
  assert.equal(S.runProgress(run, 0), 0);
  assert.ok(Math.abs(S.runProgress(run, 8) - 0.5) < 1e-9);
  assert.equal(S.runProgress(run, 16), 1);
  assert.equal(S.runProgress(run, 999), 1, 'it clamps rather than running past the end');
});

test('a run cannot finish before every repeat has been materialised', () => {
  /* Otherwise the first pass being fully scored would end the practice. */
  const run = mk({ ...para, repeats: 4 });
  S.ensureEntries(run, 0);
  for (const e of run.entries) for (const n of e.notes) { n.state = S.HIT; n.played = true; }
  S.expireMissed(run, 5);
  assert.equal(S.runFinished(run, 5), false, 'it finished after one repeat of four');
});

test('dynamics belong to a voice, not to the stack it arrived in', () => {
  const backbeat = {
    bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1,
    events: [{ beat: 0, voices: ['HH', 'SN'], dyn: { SN: 'accent' } }],
  };
  const run = mk(backbeat, { dynamics: true });
  const notes = run.entries[0].notes;
  const hh = notes.find((n) => n.voice === 'HH');
  const sn = notes.find((n) => n.voice === 'SN');
  assert.equal(hh.wantDyn, 'normal', 'the hi-hat was accented along with the snare');
  assert.equal(sn.wantDyn, 'accent');
  /* And a quiet hi-hat under a loud snare is not a dynamic error. */
  run.touch.push(70, 70, 70);
  assert.equal(S.judgeHit(run, { voice: 'HH', velocity: 70 }, 0).dynOk, true);
  assert.equal(S.judgeHit(run, { voice: 'SN', velocity: 70 }, 0).dynOk, false);
});

test('a stack-wide dynamic still applies to every voice in it', () => {
  const chart = {
    bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1,
    events: [{ beat: 0, voices: ['HH', 'SN'], dyn: 'ghost' }],
  };
  const run = mk(chart);
  for (const n of run.entries[0].notes) assert.equal(n.wantDyn, 'ghost');
});

test('LISTENING ends too, and does not pile up entries', () => {
  /*
   * The reported bug: "the drum practice never ends (I had 11/8 bars)".
   *
   * Listen mode settled its notes by hand instead of through takeDue, so
   * entry.state stayed PENDING, the cursor never left zero, nothing could be
   * pruned and runFinished — which waits for the cursor to reach the end —
   * could never fire. It ran past the end of the practice for ever.
   */
  const chart = { ...para, repeats: 4 };
  const run = mk(chart);
  let finishedAt = null;
  let peak = 0;
  for (let t = 0; t <= 40 && finishedAt === null; t += 0.25) {
    S.ensureEntries(run, t + 8);
    S.takeDue(run, t);
    S.pruneEntries(run, t - 2);
    peak = Math.max(peak, run.entries.length);
    if (S.runFinished(run, t)) finishedAt = t;
  }
  assert.ok(finishedAt !== null, 'listening never finished');
  assert.ok(finishedAt >= 16, `finished at ${finishedAt}, before the declared bars ran out`);
  assert.ok(finishedAt < 18, `finished at ${finishedAt}, long after the end`);
  assert.ok(peak < 60, `${peak} entries — the cursor is stuck and nothing is pruning`);
});

test('listening settles what it plays, so the cursor keeps moving', () => {
  const run = mk({ ...para, repeats: 2 });
  S.ensureEntries(run, 8);
  assert.equal(run.cursor, 0);
  const due = S.takeDue(run, 1);
  assert.ok(due.length > 0, 'nothing came due');
  assert.ok(run.cursor > 0, 'the cursor did not move past what was played');
  for (const e of due) assert.notEqual(e.state, S.PENDING, 'an entry was left unsettled');
});

test('listening is not an attempt — nothing is scored', () => {
  const run = mk({ ...para, repeats: 1 });
  S.ensureEntries(run, 8);
  S.takeDue(run, 8);
  assert.equal(run.hits, 0, 'listening counted as hits');
  assert.equal(run.misses, 0);
  assert.equal(S.runStats(run).asked, 0);
});

test('an entry only comes due once, however often it is asked for', () => {
  const run = mk({ ...para, repeats: 2 });
  S.ensureEntries(run, 8);
  const first = S.takeDue(run, 4).length;
  assert.ok(first > 0);
  assert.equal(S.takeDue(run, 4).length, 0, 'the same entries sounded twice');
});

test('the next entry is the first at or after the playhead', () => {
  const run = mk(para, { repeats: 1 });
  assert.equal(S.nextEntryIndex(run, 0), 0, 'exactly on a note');
  assert.equal(S.nextEntryIndex(run, 0.1), 1, 'between notes');
  assert.equal(S.nextEntryIndex(run, 0.75), 3);
  assert.equal(S.nextEntryIndex(run, 0.9), -1, 'past the last');
});

/* ---- Tempo changes and seeking back (found in review) ------------------------ */

test('setTempo works the windows out again in beats, so they stay the same in milliseconds', async () => {
  const SC = await import('../src/scoring.mjs');
  const { beatsToMs } = await import('../src/chart.mjs');
  const chart = { id: 't', bpm: 80, timeSig: [4, 4], events: [{ beat: 0, voices: ['SN'] }] };
  const run = SC.createRun(chart, { latencyMs: 20 });
  const goodMs = beatsToMs(run.good, 80);
  SC.setTempo(run, 160);
  assert.equal(run.bpm, 160);
  assert.ok(Math.abs(beatsToMs(run.good, 160) - goodMs) < 1e-9, 'the good window is still the same milliseconds');
  assert.ok(Math.abs(beatsToMs(run.latencyBeats, 160) - 20) < 1e-9, 'and so is the latency');
});

test('seeking back takes back what it re-arms, so a passage is never counted twice', async () => {
  const SC = await import('../src/scoring.mjs');
  const { stats } = await import('../src/timing.mjs');
  const chart = { id: 't', bpm: 120, timeSig: [4, 4], events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: ['SN'] })) };
  const run = SC.createRun(chart, { repeats: 1 });
  for (const b of [0, 1, 2]) SC.judgeHit(run, { voice: 'SN', hand: null, velocity: 100 }, b, b);
  assert.equal(run.hits, 3);
  SC.expireMissed(run, 10);
  assert.equal(run.misses, 1);
  SC.seekTo(run, 1);
  assert.equal(run.hits, 1, 'the two hits from beat 1 on are taken back');
  assert.equal(run.misses, 0, 'and the miss');
  assert.equal(stats(run.timing).n, 1, 'and their timing');
  SC.judgeHit(run, { voice: 'SN', hand: null, velocity: 100 }, 1, 1);
  assert.equal(run.hits, 2, 'played again, counted once');
});

test('seeking back lets Listen play the re-armed notes again', async () => {
  const SC = await import('../src/scoring.mjs');
  const chart = { id: 't', bpm: 120, timeSig: [4, 4], events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: ['SN'] })) };
  const run = SC.createRun(chart, { repeats: 1 });
  assert.equal(SC.takeDue(run, 2.5).length, 3);
  SC.seekTo(run, 1);
  assert.equal(SC.takeDue(run, 2.5).length, 2, 'beats 1 and 2 sound again');
  assert.equal(SC.takeDue(run, 3.5).length, 1, 'and the cursor carries on to the end');
  assert.equal(SC.runFinished(run, 99), true);
});

/* ---- the take's record, for looking back over it ------------------------- */

test('what scrolls off is kept, in order, and a review joins it to what is live', () => {
  const chart = { id: 'r', name: 'R', bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 4,
    events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: ['SN'] })) };
  const run = S.createRun(chart);
  S.ensureEntries(run, 16);
  S.judgeHit(run, { voice: 'SN' }, 0);
  S.addMarker(run, 'SN', 0);
  S.expireMissed(run, 6);
  S.pruneEntries(run, 5);
  S.pruneMarkers(run, 5);
  assert.deepEqual(run.past.map((e) => e.beat), [0, 1, 2, 3, 4]);
  assert.equal(run.pastMarkers.length, 1);
  assert.equal(run.past[0].notes[0].state, 'hit', 'kept as it was judged');
  const r = S.reviewOf(run);
  assert.deepEqual(r.entries.slice(0, 6).map((e) => e.beat), [0, 1, 2, 3, 4, 5]);
  assert.equal(r.markers.length, 1);
  assert.equal(run.entries[0].beat, 5, 'the live run is untouched');
  /* The binary search finds the same window a walk from the front would. */
  const seen = S.visibleEntries(r, 3, 32).map((v) => v.beat);
  assert.ok(seen.includes(3) && seen.every((b) => b >= 0));
});

test('markers past the live limit are kept for the review, not lost', () => {
  const run = S.createRun({ id: 'm', name: 'M', bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1,
    events: [{ beat: 0, voices: ['SN'] }] });
  for (let i = 0; i < 70; i++) S.addMarker(run, 'SN', i / 10);
  assert.equal(run.markers.length, 64);
  assert.equal(run.pastMarkers.length, 6);
  assert.equal(S.reviewOf(run).markers.length, 70);
});

test('a seek back takes what will be played again out of the record', () => {
  const chart = { id: 's', name: 'S', bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 4,
    events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: ['SN'] })) };
  const run = S.createRun(chart);
  S.ensureEntries(run, 16);
  S.expireMissed(run, 9);
  S.addMarker(run, 'SN', 7);
  S.pruneMarkers(run, 8);
  S.pruneEntries(run, 8);
  S.seekTo(run, 6);
  assert.deepEqual(run.past.map((e) => e.beat), [0, 1, 2, 3, 4, 5]);
  assert.equal(run.pastMarkers.length, 0);
});

test('the record is bounded, however long an endless run goes', () => {
  const run = S.createRun({ id: 'e', name: 'E', bpm: 120, timeSig: [4, 4], loopBars: 1,
    events: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => ({ beat: b, voices: ['HH'] })) }, { repeats: 0 });
  for (let b = 0; b < 2200; b += 8) {
    S.ensureEntries(run, b + 8);
    S.expireMissed(run, b + 8);
    S.pruneEntries(run, b + 7);
  }
  assert.ok(run.past.length <= S.PAST_MAX);
  for (let i = 1; i < run.past.length; i++) assert.ok(run.past[i].beat > run.past[i - 1].beat);
});

test('a press after the good window costs ONE error: the note is missed, no stray', () => {
  /* 70ms late at 120bpm: past good (60), inside late (120). It used to count
   * a stray now and the miss when the window closed — twice for one stroke. */
  const run = mk(groove);
  const j = S.judgeHit(run, { voice: 'HH' }, 0.14);
  assert.equal(j.result, 'late');
  assert.equal(run.strays, 0);
  assert.equal(run.misses, 1);
  assert.equal(run.entries[0].notes.find((n) => n.voice === 'HH').state, S.MISSED);
  S.expireMissed(run, 0.5);
  assert.equal(run.misses, 2, 'the kick, never played, is the only other miss');
});

test('an early press stays a stray, and the note can still be hit', () => {
  /* The note is ahead: taking it on an early tap would charge a mistake the
   * player has not finished making. */
  const run = mk(groove);
  assert.equal(S.judgeHit(run, { voice: 'SN' }, 0.86).result, 'stray');
  assert.equal(S.judgeHit(run, { voice: 'SN' }, 1).result, 'perfect');
  assert.equal(run.misses, 0);
  assert.equal(run.strays, 1);
});

test('past the late window a press is a stray again', () => {
  const run = mk(groove);
  S.judgeHit(run, { voice: 'KK' }, 0);
  assert.equal(S.judgeHit(run, { voice: 'HH' }, 0.3).result, 'stray', '150ms late is no longer that note');
});

test('a late miss undoes like any other when scrubbed back over', () => {
  const run = mk(groove);
  S.judgeHit(run, { voice: 'HH' }, 0.14);
  S.seekTo(run, 0);
  assert.equal(run.misses, 0);
});

test('a flawless Clock is 100% right: it is judged on the notes that came due', () => {
  /* Endless under the hood, and built two loops ahead: those notes were in
   * the count, and a perfect Clock scored 89%. */
  for (const loopBars of [1, 2]) {
    const chart = { ...groove, loopBars, repeats: 0,
      events: loopBars === 1 ? groove.events : groove.events.concat(groove.events.map((e) => ({ ...e, beat: e.beat + 4 }))) };
    const run = endless(chart);
    const end = 32 * 4;
    /* As ui.js stops it: a late window past the end, so its last notes resolve. */
    for (let b = 0; b <= end + run.late; b += 0.5) {
      S.ensureEntries(run, b + 8);
      for (const e of run.entries) {
        if (Math.abs(e.beat - b) < 1e-9 && e.beat < end) for (const n of e.notes) S.judgeHit(run, { voice: n.voice }, b);
      }
      S.expireMissed(run, b);
      S.pruneEntries(run, b - 4);
    }
    const st = S.runStats(run);
    assert.ok(st.total > st.asked, 'notes were built past the end');
    assert.equal(st.misses, 0);
    assert.equal(st.hits, st.asked);
  }
});

/* ---- shared with L0 ------------------------------------------------------- */

test('judgeStroke judges a hand and a dynamic exactly as a timed hit does', () => {
  const chart = { id: 'x', name: 'x', bpm: 100, timeSig: [4, 4], loopBars: 1, repeats: 1,
    sticking: 'strict',
    events: [0, 1, 2].map((b) => ({ beat: b, voices: ['SN'], hand: 'R' }))
      .concat([{ beat: 3, voices: ['SN'], hand: 'R', dyn: 'accent' }]) };
  const run = S.createRun(chart, { sticking: 'strict' });
  for (let i = 0; i < 3; i++) S.judgeStroke(run, run.entries[i].notes[0], 'R', 70);
  const acc = S.judgeStroke(run, run.entries[3].notes[0], 'L', 80);
  assert.equal(acc.handOk, false);
  assert.equal(acc.need, 70 + S.ACCENT_LIFT);
  assert.equal(acc.dynOk, false);
  assert.deepEqual(run.touch, [70, 70, 70], 'an accent does not join the touch');
});

test('entriesIn lays a bar out on a still page', () => {
  const chart = { id: 'x', name: 'x', bpm: 100, timeSig: [4, 4], loopBars: 1, repeats: 2,
    events: [0, 1, 2, 3].map((b) => ({ beat: b, voices: ['SN'] })) };
  const run = S.createRun(chart);
  const page = S.entriesIn(run, 4, 8, 20, 24);
  assert.deepEqual(page.map((p) => p.beat), [4, 5, 6, 7], 'the second bar, and only it');
  assert.deepEqual(page.map((p) => p.x), [20, 44, 68, 92]);
  assert.equal(page[0].index, 4);
});
