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
  assert.equal(P.takeAccuracy({ total: 10, hits: 10 }), 1);
  assert.equal(P.takeAccuracy({ total: 10, hits: 10, stickErrors: 1 }), 0.9);
  assert.equal(P.takeAccuracy({ total: 10, hits: 10, dynErrors: 2 }), 0.8);
  /* Sweeping the pads under every note is not playing it. */
  assert.equal(P.takeAccuracy({ total: 10, hits: 10, strays: 10 }), 0.5);
  assert.equal(P.takeAccuracy({ total: 0, hits: 0 }), 0);
  assert.equal(P.takeAccuracy({ total: 4, hits: 1, stickErrors: 2, dynErrors: 2 }), 0);
});

test('a clean take is 90% right AND inside the good window — exactly on either still counts', () => {
  const st = { total: 10, hits: 10, stickErrors: 1 };
  assert.equal(P.judgeTake(st, 60, 60).clean, true, '90% and spread on the window');
  const sloppy = P.judgeTake({ total: 10, hits: 9, stickErrors: 1 }, 20, 60);
  assert.equal(sloppy.clean, false);
  assert.match(sloppy.reason, /80% right, need 90/);
  const loose = P.judgeTake({ total: 10, hits: 10 }, 72, 60);
  assert.equal(loose.clean, false);
  assert.match(loose.reason, /spread 72, max 60ms/);
  assert.equal(P.judgeTake({ total: 10, hits: 0 }, 0, 60).reason, 'nothing played');
});

test('the reasons fit a result line', () => {
  for (const r of [P.judgeTake({ total: 100, hits: 89 }, 0, 60).reason,
    P.judgeTake({ total: 10, hits: 10 }, 199, 100).reason,
    /* Offsets are bounded by the widest late window (160ms), so a spread
     * never runs to four digits. */
    P.judgeTake({ total: 10, hits: 10 }, 160, 35).reason, 'nothing played']) {
    assert.ok(r.length <= 21, r);
  }
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
