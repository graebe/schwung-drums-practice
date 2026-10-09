// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';

import * as T from '../src/transport.mjs';
import { msToBeats } from '../src/chart.mjs';

const BPM = 120;           /* 500 ms a beat */
const beatsAt = (t, nowMs) => msToBeats(nowMs - t.startedAt, BPM) - t.waitedBeats;

test('a start from home counts in, and from a scrubbed bar does not', () => {
  const t = T.createTransport();
  assert.equal(T.start(t, { mode: T.PRACTICE, nowMs: 1000, bpm: BPM, countInBeats: 4 }), 0);
  assert.equal(t.songBeats, -4, 'four beats of count-in');
  assert.equal(beatsAt(t, 1000), -4);
  assert.equal(t.scrubbed, false, 'a run from the top is a whole attempt');

  T.home(t);
  T.seek(t, 8, 5000, BPM);
  assert.equal(T.start(t, { mode: T.PRACTICE, nowMs: 6000, bpm: BPM, countInBeats: 4 }), 8);
  assert.equal(t.songBeats, 8);
  assert.equal(t.scrubbed, true, 'a run from a scrubbed bar is passage practice');
});

test('home puts the playhead at the top, so a run after a result does not start at its end', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 16000, BPM, false, null);
  assert.equal(t.songBeats, 32, 'the run played to its end');
  T.home(t);
  assert.equal(t.songBeats, 0);
  assert.equal(t.mode, T.IDLE);
  assert.equal(T.start(t, { mode: T.PRACTICE, nowMs: 20000, bpm: BPM, countInBeats: 4 }), 0,
    'starting again starts from the top');
});

test('pause holds the playhead, and resume carries on from it', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.LISTEN, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 2000, BPM, false, null);
  assert.equal(t.songBeats, 4);
  T.pause(t, 2000);
  assert.equal(T.advance(t, 9000, BPM, false, null), false, 'a paused clock does not move');
  assert.equal(t.songBeats, 4);
  T.resume(t, 9000);
  T.advance(t, 9500, BPM, false, null);
  assert.equal(t.songBeats, 5, 'one beat after resuming, not seven seconds on');
  assert.equal(T.pause(t, 9500), true);
  assert.equal(T.pause(t, 9600), false, 'pausing twice is one pause');
  assert.equal(T.resume(t, 9700), true);
  assert.equal(T.resume(t, 9800), false);
});

test('a scrub while paused is where the resume carries on from', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.LISTEN, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 4000, BPM, false, null);          /* beat 8 */
  T.pause(t, 4000);
  T.seek(t, 16, 7000, BPM);                       /* three seconds paused, then scrub */
  T.resume(t, 7000);
  T.advance(t, 7000, BPM, false, null);
  assert.equal(t.songBeats, 16, 'not 10: the pause must not be paid for twice');
  assert.equal(t.scrubCue, false, 'and running hands the pads back');
});

test('a scrub on the ready screen marks the cue, and moving a started run marks it scrubbed', () => {
  const t = T.createTransport();
  T.seek(t, 4, 0, BPM);
  assert.equal(t.scrubCue, true);
  assert.equal(t.scrubbed, false, 'not started yet: nothing to spoil');
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 4 });
  T.home(t);
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 4 });
  T.pause(t, 100);
  T.seek(t, 2, 200, BPM);
  assert.equal(t.scrubbed, true);
  const quiet = T.createTransport();
  T.seek(quiet, 2, 0, BPM, false);
  assert.equal(quiet.scrubCue, false, 'a seek the module makes itself is not a scrub');
});

test('switching Listen to practice re-bases in place; practice joined late is passage practice', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.LISTEN, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 3000, BPM, false, null);           /* beat 6 */
  assert.equal(T.switchMode(t, T.PRACTICE, 3000, BPM), 6);
  T.advance(t, 3500, BPM, false, null);
  assert.equal(t.songBeats, 7);
  assert.equal(t.scrubbed, true);
  const paused = T.createTransport();
  T.start(paused, { mode: T.LISTEN, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(paused, 1000, BPM, false, null);
  T.pause(paused, 1000);
  T.switchMode(paused, T.PRACTICE, 5000, BPM);
  T.resume(paused, 5000);
  T.advance(paused, 5000, BPM, false, null);
  assert.equal(paused.songBeats, 2, 'switching while paused keeps the place too');
});

test('a tempo change rebases the clock without moving the playhead, Study wait and all', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 2000, BPM, true, 3);               /* Study holds at beat 3 */
  T.advance(t, 4000, BPM, true, 3);
  assert.equal(t.songBeats, 3);
  assert.ok(t.waitedBeats > 0);
  T.advance(t, 4000, BPM, true, null);            /* released */
  const at = t.songBeats;
  T.rebaseTempo(t, 4000, 150);
  T.advance(t, 4000, 150, true, null);
  assert.ok(Math.abs(t.songBeats - at) < 1e-9, 'the same beat at the new tempo');
  T.advance(t, 4400, 150, true, null);
  assert.ok(Math.abs(t.songBeats - at - 1) < 1e-9, '400ms is a beat at 150');
});

test('Study holds the drawn clock while the judging clock runs on', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 0 });
  T.advance(t, 3000, BPM, true, 2);
  assert.equal(t.songBeats, 2);
  assert.equal(t.blocked, true);
  assert.ok(t.scoreBeats > 2, 'the judge keeps real time');
  T.advance(t, 3000, BPM, true, null);              /* the note was played */
  assert.equal(t.blocked, false);
  assert.equal(t.songBeats, t.scoreBeats, 'and the two clocks are one again');
});

test('a press is judged only while practising and running', () => {
  const t = T.createTransport();
  assert.equal(T.judging(t), false);
  T.start(t, { mode: T.PRACTICE, nowMs: 0, bpm: BPM, countInBeats: 0 });
  assert.equal(T.judging(t), true);
  T.pause(t, 10);
  assert.equal(T.judging(t), false, 'a pad pressed while paused is not part of the attempt');
  T.resume(t, 20);
  T.switchMode(t, T.LISTEN, 30, BPM);
  assert.equal(T.judging(t), false);
});

test('advance reports the frame a new beat starts', () => {
  const t = T.createTransport();
  T.start(t, { mode: T.LISTEN, nowMs: 0, bpm: BPM, countInBeats: 0 });
  assert.equal(T.advance(t, 100, BPM, false, null), false);
  assert.equal(T.advance(t, 520, BPM, false, null), true);
  assert.equal(T.advance(t, 600, BPM, false, null), false);
});
