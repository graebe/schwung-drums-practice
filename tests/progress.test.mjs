// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/progress.mjs';

const DAY = 86400 * 1000;
const T0 = Date.UTC(2026, 9, 1, 12);
/* A whole take: clean and at what speed. */
const take = (speed, clean = true, at = T0) =>
  ({ speed, accuracy: clean ? 0.95 : 0.7, sd: 20, clean, bpm: speed, at });

/* ---- judging a take ------------------------------------------------------- */

test('accuracy: wrong hands, wrong dynamics and strays all count against you', () => {
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10 }), 1);
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10, stickErrors: 1 }), 0.9);
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10, dynErrors: 2 }), 0.8);
  /* Sweeping the pads under every note is not playing it. */
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10, strays: 10 }), 0.5);
  assert.equal(P.takeAccuracy({ asked: 0, hits: 0 }), 0);
  assert.equal(P.takeAccuracy({ asked: 4, hits: 1, stickErrors: 2, dynErrors: 2 }), 0);
});

test('accuracy is over the notes RESOLVED, not the notes built ahead of the playhead', () => {
  /* The Clock runs endless and builds two loops ahead; counting those as
   * asked held a flawless Clock at 89%, below the line for ever. */
  assert.equal(P.takeAccuracy({ asked: 384, total: 432, hits: 384 }), 1);
});

const RULE = { spreadMs: 60 };

test('a clean take is 90% right AND inside the good window — exactly on either still counts', () => {
  assert.equal(P.verdictOf({ asked: 10, hits: 10, stickErrors: 1 }, 60, RULE).clean, true,
    '90% and spread on the window');
  const sloppy = P.verdictOf({ asked: 10, hits: 9, misses: 1, stickErrors: 1 }, 20, RULE);
  assert.equal(sloppy.clean, false);
  const loose = P.verdictOf({ asked: 10, hits: 10 }, 72, RULE);
  assert.equal(loose.clean, false);
  assert.equal(loose.cause, 'spread');
  assert.match(loose.reason, /spread 72, max 60ms/);
  const none = P.verdictOf({ asked: 10, hits: 0, misses: 10 }, 0, RULE);
  assert.equal(none.cause, 'nothing');
  assert.equal(none.reason, 'nothing played');
});

test('a take that did not count says what cost the most, with its count', () => {
  /* The reported take: every note hit, the timing tight, every accented
   * snare too soft — it read "83% right" and nothing else. */
  const st = { asked: 96, hits: 96, dynErrors: 16, softAccents: { n: 16, vel: 16 * 74, need: 16 * 83 } };
  const v = P.verdictOf(st, 12, RULE);
  assert.equal(v.clean, false);
  assert.equal(v.cause, 'accents');
  assert.equal(v.reason, '16 soft accents 74<83');
  assert.equal(Math.floor(v.accuracy * 100), 83);
  const ghosts = P.verdictOf({ asked: 10, hits: 10, dynErrors: 2,
    loudGhosts: { n: 2, vel: 140, need: 100 } }, 0, RULE);
  assert.equal(ghosts.reason, '2 loud ghosts 70>50');
  /* The biggest cost is named, not the first in some fixed order. */
  const many = P.verdictOf({ asked: 20, hits: 19, misses: 1, strays: 4, stickErrors: 1 }, 0, RULE);
  assert.equal(many.cause, 'strays');
  assert.equal(many.reason, '4 stray hits');
  assert.equal(P.verdictOf({ asked: 10, hits: 8, misses: 2 }, 0, RULE).reason, '2 missed');
  assert.equal(P.verdictOf({ asked: 10, hits: 10, stickErrors: 2 }, 0, RULE).reason, '2 wrong hands');
  /* A tie goes to the earlier cause: a missed note before a stray. */
  assert.equal(P.verdictOf({ asked: 10, hits: 9, misses: 1, strays: 1 }, 0, { ...RULE, share: 1 }).cause,
    'missed');
});

test('a stricter rule is the same verdict: share and spread are parameters', () => {
  const st = { asked: 10, hits: 10, stickErrors: 1 };
  assert.equal(P.verdictOf(st, 20, RULE).clean, true);
  assert.equal(P.verdictOf(st, 20, { spreadMs: 30, share: 1 }).clean, false);
  assert.equal(P.verdictOf({ asked: 4, hits: 4 }, 0, { spreadMs: 60, minHits: 8 }).cause, 'few');
});

test('the reasons fit a result line', () => {
  const big = (n, vel, need) => ({ n, vel: n * vel, need: n * need });
  for (const r of [
    P.verdictOf({ asked: 100, hits: 89, misses: 11 }, 0, RULE).reason,
    P.verdictOf({ asked: 10, hits: 10 }, 199, { spreadMs: 100 }).reason,
    /* Offsets are bounded by the widest late window (160ms), so a spread
     * never runs to four digits. */
    P.verdictOf({ asked: 10, hits: 10 }, 160, { spreadMs: 35 }).reason,
    P.verdictOf({ asked: 512, hits: 512, dynErrors: 128, softAccents: big(128, 120, 135) }, 0, RULE).reason,
    P.verdictOf({ asked: 512, hits: 512, dynErrors: 128, loudGhosts: big(128, 100, 90) }, 0, RULE).reason,
    P.verdictOf({ asked: 512, hits: 512, strays: 300 }, 0, RULE).reason,
    'nothing played']) {
    assert.ok(r.length <= P.REASON_MAX, r);
  }
  /* Too long with its velocities, it keeps the count and the word. */
  assert.equal(P.verdictOf({ asked: 512, hits: 512, dynErrors: 128, softAccents: big(128, 120, 135) },
    0, RULE).reason, '128 soft accents');
});

test('a take is judged on standard settings, or it is practice', () => {
  const std = { strictness: 'normal', dynamics: true, guide: false, study: false };
  assert.equal(P.easedBy(std), '');
  assert.equal(P.easedBy({ ...std, strictness: 'tight' }), '');
  assert.equal(P.easedBy({ ...std, strictness: 'loose' }), 'Loose');
  assert.equal(P.easedBy({ ...std, dynamics: false }), 'Dyn off');
  assert.equal(P.easedBy({ ...std, guide: true }), 'Guide');
  assert.equal(P.easedBy({ ...std, study: true, guide: true }), 'Study');
});

test('the status line comes from the verdict: a failed take is never BEST YET', () => {
  const s = (o) => P.takeStatus({ whole: true, study: false, learned: false, clean: true, best: false, ...o });
  assert.equal(s({ clean: false, best: true }), 'NOT CLEAN');
  assert.equal(s({ best: true }), 'BEST YET');
  assert.equal(s({}), 'CLEAN');
  assert.equal(s({ learned: true, best: true }), 'LEARNED');
  assert.equal(s({ study: true }), 'STUDY');
  assert.equal(s({ whole: false, study: true }), 'not kept');
  assert.equal(s({ eased: 'Loose', best: true }), 'PRACTICE', 'an eased take moved nothing');
  assert.equal(s({ eased: 'Loose', clean: false }), 'NOT CLEAN');
});

test('a take on eased settings is kept for its chart and moves nothing else', () => {
  const p = P.emptyProgress();
  const r = P.recordTake(p, 'x', { ...take(100), eased: 'Loose' });
  assert.equal(r.learned, false, 'a Loose take cannot learn a drill');
  assert.equal(P.item(p, 'x').best, 0, 'nor set its best');
  assert.equal(P.item(p, 'x').h.length, 1, 'but it is on the chart');
  const flags = P.item(p, 'x').h[0][4];
  assert.equal(flags & P.F_CLEAN, 0, 'drawn as a take that did not count');
  assert.equal(flags & P.F_STANDARD, 0);
  assert.equal(P.recordTake(p, 'x', take(100)).learned, true, 'the standard take learns it');
  assert.ok(P.item(p, 'x').h[1][4] & P.F_STANDARD);
  /* And an eased take at tempo of a learned item is not a slip. */
  const due = P.item(p, 'x').rep.due;
  P.recordTake(p, 'x', { ...take(100, false), eased: 'Guide' });
  assert.equal(P.item(p, 'x').rep.due, due);
  assert.equal(P.item(p, 'x').rep.at, 0);
});

test('clean speed is the tempo played over the tempo written', () => {
  assert.equal(P.speedOf(70, 100), 70);
  assert.equal(P.speedOf(92, 92), 100);
  assert.equal(P.speedOf(138, 120), 115);
  assert.equal(P.speedOf(90, 0), 100, 'nothing to measure against reads as at tempo');
});

test('a quiz round: hinted answers are right but not known', () => {
  assert.equal(P.roundScore(20, 0), 100);
  assert.equal(P.roundScore(20, 5), 80);
  assert.equal(P.roundScore(20, 0, 2), 90);
  assert.equal(P.roundScore(0, 0), 0);
  assert.equal(P.roundScore(1, 0, 5), 0, 'never below zero');
});

/* ---- recording -------------------------------------------------------------- */

test('the best clean speed never drops, and only clean takes set it', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', take(80));
  P.recordTake(p, 'x', take(70));
  P.recordTake(p, 'x', take(95, false));
  const it = P.item(p, 'x');
  assert.equal(it.best, 80);
  assert.equal(it.plays, 3);
  assert.equal(it.h.length, 3);
  assert.equal(P.itemValue(p, 'x'), '80%');
  assert.equal(P.itemMark(p, 'x'), null);
});

test('learned at 100% clean, once; a Ladder can carry it past 120%', () => {
  const p = P.emptyProgress();
  assert.equal(P.recordTake(p, 'x', take(95)).learned, false);
  const r = P.recordTake(p, 'x', take(100));
  assert.equal(r.learned, true);
  assert.equal(r.before, 95);
  assert.equal(P.itemMark(p, 'x'), P.MARK_DONE);
  assert.equal(P.recordTake(p, 'x', take(135)).learned, false, 'learned only the first time');
  assert.equal(P.item(p, 'x').best, 135);
});

test('played but never clean reads as tried; skipped as skipped, until played', () => {
  const p = P.emptyProgress();
  assert.equal(P.itemMark(p, 'x'), null);
  P.recordTake(p, 'x', take(100, false));
  assert.equal(P.itemMark(p, 'x'), P.MARK_TRIED);
  assert.equal(P.itemValue(p, 'x'), '');
  P.skipItem(p, 'y', T0);
  assert.equal(P.itemMark(p, 'y'), P.MARK_SKIP);
  P.recordTake(p, 'y', take(60));
  assert.equal(P.item(p, 'y').skip, 0, 'playing it means you are on it after all');
});

test('a quiz round sets its best whether or not it passes', () => {
  const p = P.emptyProgress();
  assert.equal(P.recordRound(p, 'quiz:pick:groove', { correct: 20, wrong: 5 }).learned, false);
  assert.equal(P.item(p, 'quiz:pick:groove').best, 80);
  assert.equal(P.recordRound(p, 'quiz:pick:groove', { correct: 20, wrong: 1, hinted: 0 }).learned, true);
  assert.equal(P.isDone(p, 'quiz:pick:groove'), true);
});

test('every take moves rev on, so a cache can tell it is stale', () => {
  const p = P.emptyProgress();
  const r0 = p.rev;
  P.recordTake(p, 'x', take(80));
  P.skipItem(p, 'y');
  assert.equal(p.rev, r0 + 2);
});

test('a higher groove level learned counts the lower ones, never the other way', () => {
  const p = P.emptyProgress();
  assert.deepEqual(P.higherLevels('rock:l2'), ['rock:l3', 'rock:l4']);
  assert.deepEqual(P.higherLevels('single-paradiddle'), []);
  P.recordTake(p, 'rock:l3', take(100));
  assert.equal(P.isDone(p, 'rock:l1'), true);
  assert.equal(P.isDone(p, 'rock:l2'), true);
  assert.equal(P.isDone(p, 'rock:l4'), false);
  assert.equal(P.itemMark(p, 'rock:l1'), P.MARK_DONE);
  assert.equal(P.item(p, 'rock:l1'), null, 'only read that way, never written');
});

test('the history is capped, the best kept whole', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', take(110));
  for (let i = 0; i < 40; i++) P.recordTake(p, 'x', take(60));
  assert.equal(P.item(p, 'x').h.length, P.HISTORY_CAP);
  assert.equal(P.item(p, 'x').best, 110);
});

/* ---- the file --------------------------------------------------------------- */

test('it survives a round trip, and a damaged file reads as not ok', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', take(100));
  P.skipItem(p, 'y', T0);
  const back = P.readProgress(P.serialiseProgress(p));
  assert.equal(back.ok, true);
  assert.deepEqual(back.progress.items, p.items);
  for (const text of [null, '', '{trunc', 'null', '{"items":3}', '[]']) {
    const r = P.readProgress(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.deepEqual(r.progress.items, {});
  }
});

test('bad fields read as defaults rather than failing the file', () => {
  const r = P.readProgress(JSON.stringify({ items: {
    a: { best: 'x', plays: 3, h: [[1, 50, 90, 20, 1], 'junk', [1]], rep: { due: 'soon' } },
    b: null,
  } }));
  assert.equal(r.ok, true);
  assert.equal(r.progress.items.a.best, 0);
  assert.equal(r.progress.items.a.plays, 3);
  assert.equal(r.progress.items.a.h.length, 1);
  assert.equal(r.progress.items.a.rep.due, 0);
  assert.equal(r.progress.items.b, undefined);
});

/* ---- repetition --------------------------------------------------------------- */

test('a learned item comes back after a day, and further out with every repeat at tempo', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', take(100, true, T0));
  assert.deepEqual(P.repetitionSession(p, T0 + 0.5 * DAY), []);
  assert.deepEqual(P.repetitionSession(p, T0 + DAY).map((r) => r.id), ['x']);
  P.recordTake(p, 'x', take(100, true, T0 + DAY));
  assert.equal(P.item(p, 'x').rep.step, 1);
  const today = P.repetitionSession(p, T0 + DAY + 1000);
  assert.deepEqual(today, [{ id: 'x', done: true, at: Math.round((T0 + DAY) / 1000) }]);
  assert.equal(P.dueCount(today), 0);
  assert.deepEqual(P.repetitionSession(p, T0 + 3 * DAY), []);
  assert.equal(P.repetitionSession(p, T0 + 4 * DAY)[0].id, 'x');
});

test('a slow take of a learned item is practice, not a slip', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', take(100, true, T0));
  P.recordTake(p, 'x', take(70, true, T0 + DAY));
  assert.equal(P.item(p, 'x').rep.at, 0, 'the schedule did not move');
  assert.equal(P.item(p, 'x').best, 100);
});

test('a repeat at tempo that falls apart comes first next time, and best stays', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'a', take(100, true, T0));
  P.recordTake(p, 'b', take(100, true, T0));
  P.recordTake(p, 'b', take(100, false, T0 + DAY));
  const s = P.repetitionSession(p, T0 + DAY + 1000);
  assert.deepEqual(s.map((r) => r.id), ['b', 'a']);
  assert.equal(P.item(p, 'b').best, 100);
  assert.equal(P.item(p, 'b').rep.step, 0);
  assert.ok(P.item(p, 'b').h[1][4] & P.F_REPEAT);
});

test('a session is at most REP_SESSION items, most overdue first', () => {
  const p = P.emptyProgress();
  for (let i = 0; i < 8; i++) P.recordTake(p, `r${i}`, take(100, true, T0 + i * 1000));
  const s = P.repetitionSession(p, T0 + 2 * DAY);
  assert.equal(s.length, P.REP_SESSION);
  assert.equal(s[0].id, 'r0');
});

/* ---- folders ------------------------------------------------------------------ */

test('a folder counts its learned leaves once each, cached against rev', () => {
  const p = P.emptyProgress();
  const leaf = (id) => ({ label: id, id, kind: 'chart' });
  const tree = { label: 'root', children: [
    { label: 'A', children: [leaf('a'), leaf('b'), leaf('a')] },
    leaf('c'),
    { label: 'Rep', untracked: true, children: [leaf('z')] },
  ] };
  const agg = P.createAggregator();
  assert.deepEqual(P.leafIds(agg, tree), ['a', 'b', 'c']);
  assert.deepEqual(P.folderSummary(agg, p, tree), { count: 3, done: 0, played: 0 });
  P.recordTake(p, 'a', take(100));
  P.recordTake(p, 'b', take(50));
  assert.deepEqual(P.folderSummary(agg, p, tree), { count: 3, done: 1, played: 2 });
  P.resetShape(agg);
  assert.equal(agg.leaves.size, 0);
});

test('recent items come most recent first', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'old', take(50, true, T0));
  P.recordTake(p, 'new', take(50, true, T0 + 5000));
  P.skipItem(p, 'never');
  assert.deepEqual(P.recentIds(p), ['new', 'old']);
});

/* ---- charts --------------------------------------------------------------------- */

test('the chart is on a fixed scale with the line to reach where it belongs', () => {
  const h = [[0, 40, 0, 0, 0], [1, 140, 0, 0, 1], [2, 200, 0, 0, 1]];
  const s = P.percentSeries(h, 101, 41);
  assert.equal(s.points[0].y, 40, '40% sits on the floor');
  assert.equal(s.points[1].y, 0, '140% on the ceiling');
  assert.equal(s.points[2].y, 0, 'past the top is clamped');
  assert.equal(s.lineY, 16);
  assert.equal(s.points[0].clean, false);
  assert.equal(s.points[2].x, 100);
  assert.equal(P.percentSeries([[0, 50, 0, 0, 1]], 101, 41).points[0].x, 100);
  const q = P.percentSeries([], 101, 41, { lo: 0, hi: 100, line: 90 });
  assert.equal(q.lineY, 4);
});

/* ---- from the stats log ----------------------------------------------------------- */

test('takes in stats.json from before progress existed are read in once', () => {
  const recs = [
    { t: 100, d: 'ladder:flam:normal', bpm: 70, sd: 12, n: 30, err: 0 },
    { t: 200, d: 'drill:rock:l2:normal', bpm: 92, sd: 20, n: 32, err: 0, sp: 100 },
    { t: 300, d: 'drill:rock:l3:normal', bpm: 92, sd: 20, n: 32, err: 4, sp: 100 },
    { t: 400, d: 'drill:rock:l4:normal', bpm: 92, sd: 20, n: 32, err: 0, s: 1 },
    { t: 500, d: 'pick:groove', bpm: 12, sd: 0, n: 20, err: 1 },
    { t: 600, d: 'drill:gone:normal', bpm: 92, sd: 20, n: 32, err: 0 },
  ];
  const itemOf = (r) => {
    if (r.d === 'pick:groove') return 'quiz:pick:groove';
    const id = r.d.split(':').slice(1, -1).join(':');
    return id === 'gone' ? null : id;
  };
  const written = { flam: 70, 'rock:l2': 92, 'rock:l3': 92 };
  const p = P.importStats(P.emptyProgress(), recs, itemOf, (id) => written[id]);
  assert.equal(P.isDone(p, 'flam'), true, 'a Ladder record is clean');
  assert.equal(P.isDone(p, 'rock:l2'), true);
  assert.equal(P.itemMark(p, 'rock:l3'), P.MARK_TRIED, 'errors: played, not clean');
  assert.equal(P.item(p, 'rock:l4'), null, 'a Study take never counted');
  assert.equal(P.item(p, 'quiz:pick:groove').best, 95);
  assert.equal(P.item(p, 'gone'), null);
  assert.equal(P.item(p, 'flam').t, 100);
});

test('learned over time: a step per drill, at its first ✓, a higher level carrying the lower', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'a', take(100, true, T0));
  P.recordTake(p, 'rock:l3', take(100, true, T0 + 2 * DAY));
  P.recordTake(p, 'b', take(60, true, T0 + DAY));
  assert.equal(P.learnedAt(p, 'rock:l1'), Math.round((T0 + 2 * DAY) / 1000));
  assert.equal(P.learnedAt(p, 'b'), 0, 'clean but slow is not learned');
  const tl = P.learnedTimeline(p, ['a', 'b', 'rock:l1', 'rock:l3'], 101, 41, T0 + 4 * DAY);
  assert.equal(tl.total, 3);
  assert.deepEqual(tl.points.map((pt) => pt.x), [0, 50, 50]);
  assert.equal(tl.points[2].y, 0, 'the last step reaches the top');
  assert.deepEqual(P.learnedTimeline(p, ['b'], 101, 41, T0), { points: [], total: 0 });
});
