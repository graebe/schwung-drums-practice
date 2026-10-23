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

test('accuracy: wrong hands and strays count against you, dynamics do not', () => {
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10 }), 1);
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10, stickErrors: 1 }), 0.9);
  /* A soft accent on the right drum, in time, is a right note. */
  assert.equal(P.takeAccuracy({ asked: 10, hits: 10, dynErrors: 2 }), 1);
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
   * snare too soft. It used to read "83% right, NOT CLEAN"; the notes were
   * right, so it is clean, and the accents are the dynamics' business. */
  const st = { asked: 96, hits: 96, dynErrors: 16, softAccents: { n: 16, vel: 16 * 74, need: 16 * 83 } };
  const v = P.verdictOf(st, 12, RULE);
  assert.equal(v.clean, true);
  assert.equal(v.accuracy, 1);
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
  for (const r of [
    P.verdictOf({ asked: 100, hits: 89, misses: 11 }, 0, RULE).reason,
    P.verdictOf({ asked: 10, hits: 10 }, 199, { spreadMs: 100 }).reason,
    /* Offsets are bounded by the widest late window (160ms), so a spread
     * never runs to four digits. */
    P.verdictOf({ asked: 10, hits: 10 }, 160, { spreadMs: 35 }).reason,
    P.verdictOf({ asked: 512, hits: 512, strays: 300 }, 0, RULE).reason,
    P.verdictOf({ asked: 512, hits: 512, stickErrors: 300 }, 0, RULE).reason,
    'nothing played']) {
    assert.ok(r.length <= P.REASON_MAX, r);
  }
});

const credit = (n, c) => ({ n, credit: c });

test('the dynamics score is the mean credit of the judged accents and ghosts', () => {
  const st = { accents: credit(4, 2), ghosts: credit(4, 4) };
  assert.deepEqual(P.dynamicsScore(st), { score: 75, accents: 50, ghosts: 100, judged: 8 });
  /* Too few judged to be a measurement: no overall score, but a kind with
   * any judged says what it got. */
  assert.deepEqual(P.dynamicsScore({ accents: credit(3, 3), ghosts: credit(0, 0) }),
    { score: -1, accents: 100, ghosts: -1, judged: 3 });
  assert.equal(P.dynamicsScore({}).score, -1, 'nothing judged, nothing to say');
  assert.equal(P.dynamicsScore({ accents: credit(4, 0) }).score, 0);
});

test('the dynamics advice names the kind that missed most, and fits beside the score', () => {
  const big = (n, vel, need) => ({ n, vel: n * vel, need: n * need });
  assert.equal(P.dynamicsAdvice({ softAccents: big(16, 74, 83), loudGhosts: big(2, 70, 50) }),
    '16 soft 74<83');
  assert.equal(P.dynamicsAdvice({ softAccents: big(1, 74, 83), loudGhosts: big(5, 61, 48) }),
    '5 loud 61>48');
  assert.equal(P.dynamicsAdvice({ softAccents: big(0, 0, 0), loudGhosts: big(0, 0, 0) }), '');
  assert.equal(P.dynamicsAdvice({}), '');
  /* Too long with its velocities, it keeps the count and the word. */
  const long = P.dynamicsAdvice({ softAccents: big(128, 120, 135) });
  assert.equal(long, '128 soft');
  for (const r of [long, P.dynamicsAdvice({ loudGhosts: big(999, 100, 90) })]) {
    assert.ok(r.length <= P.DYN_ADVICE_MAX, r);
  }
});

test('a take is judged on standard settings, or it is practice', () => {
  const std = { strictness: 'normal', guide: false, study: false };
  assert.equal(P.easedBy(std), '');
  assert.equal(P.easedBy({ ...std, strictness: 'tight' }), '');
  assert.equal(P.easedBy({ ...std, strictness: 'loose' }), 'Loose');
  /* Dynamics no longer decide a ✓, so switching them off eases nothing. */
  assert.equal(P.easedBy({ ...std, dynamics: false }), '');
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

test('a drill keeps the best dynamics of a take that counted at tempo', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'x', { ...take(80), dyn: 95 });
  assert.equal(P.item(p, 'x').dyn, -1, 'a slow take does not set the dynamics');
  P.recordTake(p, 'x', { ...take(100), dyn: 40 });
  P.recordTake(p, 'x', { ...take(100), dyn: 70 });
  P.recordTake(p, 'x', { ...take(100), dyn: 55 });
  assert.equal(P.item(p, 'x').dyn, 70, 'the best, which never drops');
  P.recordTake(p, 'x', { ...take(100, false), dyn: 99 });
  assert.equal(P.item(p, 'x').dyn, 70, 'nor does a take that did not count');
  const h = P.item(p, 'x').h;
  assert.deepEqual(h.map((e) => e[5]), [95, 40, 70, 55, 99], 'every take keeps its own');
  P.recordTake(p, 'y', take(100));
  assert.equal(P.item(p, 'y').h[0][5], -1, 'none judged');
  const back = P.readProgress(P.serialiseProgress(p)).progress;
  assert.equal(back.items.x.dyn, 70);
});

test('progress rebuilt from stats judges each take by today\'s rule', () => {
  const written = () => 100;
  const recs = [
    /* Every note on time, its eight errors all dynamics: clean today. */
    { t: 10, d: 'drill:a:normal', bpm: 100, sd: 9, n: 32, err: 8, tot: 32, st: 0, sk: 0, dy: 8, dp: 20 },
    /* Four wrong hands in thirty-two: 87.5% right, not clean. */
    { t: 20, d: 'drill:b:normal', bpm: 100, sd: 9, n: 32, err: 4, tot: 32, st: 0, sk: 4, dy: 0 },
    /* An old record with no breakdown: any error is read as a miss. */
    { t: 30, d: 'drill:c:normal', bpm: 100, sd: 9, n: 32, err: 1 },
    /* A rung's id has a colon in it: its strictness is still found. */
    { t: 40, d: 'drill:g:l2:loose', bpm: 100, sd: 9, n: 32, err: 0, tot: 32, st: 0, sk: 0 },
    /* L0 keeps the verdict it was given. */
    { t: 50, d: 'untimed:g:l0:normal', bpm: 50, n: 16, err: 0, tot: 16, cl: 1, dp: 80 },
  ];
  const p = P.importStats(P.emptyProgress(), recs, (r) => r.d.split(':').slice(1, -1).join(':'), written);
  assert.ok(P.item(p, 'a').done, 'failed only on its accents, and learned now');
  assert.equal(P.item(p, 'a').dyn, 20);
  assert.equal(P.item(p, 'b').done, 0);
  assert.equal(P.item(p, 'c').done, 0);
  assert.equal(P.item(p, 'g:l2').done, 0, 'a Loose take is practice');
  assert.ok(P.item(p, 'g:l0').done);
  assert.equal(P.item(p, 'g:l0').best, 50);
  assert.equal(P.item(p, 'g:l0').dyn, 80);
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

test('the tips already shown are saved with the progress, and can be cleared', () => {
  const p = P.emptyProgress();
  assert.deepEqual(p.tips, []);
  const rev = p.rev;
  P.addTip(p, 'welcome');
  P.addTip(p, 'welcome');
  P.addTip(p, 'sheet');
  assert.deepEqual(p.tips, ['welcome', 'sheet'], 'a tip is recorded once');
  assert.ok(p.rev > rev, 'a new tip moves rev on, so it is saved');
  const back = P.readProgress(P.serialiseProgress(p)).progress;
  assert.equal(P.hasTip(back, 'sheet'), true);
  assert.equal(P.hasTip(back, 'quiz'), false);
  P.clearTips(back);
  assert.deepEqual(back.tips, []);
  /* A file from before tips, or with junk in them, reads as none seen. */
  const old = P.readProgress(JSON.stringify({ version: P.PROGRESS_VERSION, items: {}, tips: [1, 'quiz'] }));
  assert.deepEqual(old.progress.tips, ['quiz']);
  assert.deepEqual(P.readProgress(JSON.stringify({ version: P.PROGRESS_VERSION, items: {} })).progress.tips, []);
});

test('bad fields read as defaults rather than failing the file', () => {
  const r = P.readProgress(JSON.stringify({ version: P.PROGRESS_VERSION, items: {
    a: { best: 'x', plays: 3, h: [[1, 50, 90, 20, 1, -1], 'junk', [1], [1, 50, 90, 20, 1]],
      rep: { due: 'soon' } },
    b: null,
  } }));
  assert.equal(r.ok, true);
  assert.equal(r.progress.items.a.best, 0);
  assert.equal(r.progress.items.a.dyn, -1);
  assert.equal(r.progress.items.a.plays, 3);
  assert.equal(r.progress.items.a.h.length, 1, 'a five-value entry is from version 1');
  assert.equal(r.progress.items.a.rep.due, 0);
  assert.equal(r.progress.items.b, undefined);
});

test('a progress file of an earlier version reads as stale, not as damaged', () => {
  const v1 = JSON.stringify({ version: 1, items: { a: { best: 80, h: [[1, 80, 95, 20, 1]] } } });
  const r = P.readProgress(v1);
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
  assert.deepEqual(r.progress.items, {});
  assert.equal(P.readProgress('{').stale, false, 'damaged is not stale');
  assert.equal(P.readProgress(P.serialiseProgress(P.emptyProgress())).ok, true);
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

test('the dynamics ride the chart on a scale of their own, only where judged', () => {
  const h = [[0, 80, 0, 0, 1, 0], [1, 90, 0, 0, 1, -1], [2, 100, 0, 0, 1, 50], [3, 100, 0, 0, 1, 100]];
  const s = P.percentSeries(h, 31, 41);
  assert.deepEqual(s.dyn, [
    { x: 0, y: 40, percent: 0 }, { x: 20, y: 20, percent: 50 }, { x: 30, y: 0, percent: 100 },
  ]);
  assert.deepEqual(P.percentSeries([], 31, 41).dyn, []);
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

/* ---- L0: own pace ------------------------------------------------------------ */

const counts = (stacks, firstTry, extra = {}) => ({
  stacks, firstTry, wrong: 0, apart: 0, again: 0, hand: 0,
  softAccents: { n: 0, vel: 0, need: 0 }, loudGhosts: { n: 0, vel: 0, need: 0 }, ...extra,
});

test('L0 is clean at 90% right first time, and says what cost the most', () => {
  assert.equal(P.untimedVerdictOf(counts(20, 18)).clean, true, 'exactly 90% counts');
  const v = P.untimedVerdictOf(counts(20, 17, { wrong: 1, apart: 2 }));
  assert.equal(v.clean, false);
  assert.equal(v.cause, 'apart');
  assert.equal(v.reason, '2 not together');
  assert.equal(P.untimedVerdictOf(counts(20, 15, { wrong: 5 })).reason, '5 wrong pads');
  assert.equal(P.untimedVerdictOf(counts(0, 0)).cause, 'nothing');
  assert.equal(P.untimedVerdictOf(counts(16, 12, { hand: 4 })).reason, '4 wrong hands');
  assert.ok(v.reason.length <= P.REASON_MAX);
});

test('L0 is learned at any pace, keeps its best pace, and never comes back for repetition', () => {
  const p = P.emptyProgress();
  const r = P.recordUntimed(p, 'rock:l0', { pace: 31, accuracy: 1, clean: true, eased: '', bpm: 28, at: T0 });
  assert.equal(r.learned, true, 'a slow clean take learns it');
  const it = P.item(p, 'rock:l0');
  assert.equal(it.best, 31);
  assert.equal(it.rep, null, 'no repetition: L0 cannot answer "still clean at tempo?"');
  P.recordUntimed(p, 'rock:l0', { pace: 25, accuracy: 1, clean: true, eased: '', bpm: 23, at: T0 + DAY });
  assert.equal(it.best, 31, 'a slower take never lowers the best');
  P.recordUntimed(p, 'rock:l0', { pace: 60, accuracy: 0.5, clean: false, eased: '', bpm: 55, at: T0 + DAY });
  assert.equal(it.best, 31, 'a fast take that was not clean is not a best');
  assert.equal(P.repetitionSession(p, T0 + 40 * DAY).length, 0);
  assert.equal(it.h[it.h.length - 1][4] & P.F_TEMPO, 0, 'never flagged at tempo');
});

test('a guided L0 take is practice: kept, but not learned', () => {
  const p = P.emptyProgress();
  const r = P.recordUntimed(p, 'rock:l0', { pace: 40, accuracy: 1, clean: true, eased: 'Guide', bpm: 37, at: T0 });
  assert.equal(r.learned, false);
  assert.equal(P.item(p, 'rock:l0').best, 0);
  assert.equal(P.item(p, 'rock:l0').plays, 1);
});

/*
 * An L0 row shows what L0 asks — the best share right first time, never above
 * 100% — not its pace against the written tempo, which read like a grade.
 * The pace stays in the history, and the chart plots it.
 */
test('an L0 row shows its best share right first time, never its pace', () => {
  const p = P.emptyProgress();
  P.recordUntimed(p, 'rock:l0', { pace: 114, accuracy: 1, clean: true, eased: '', bpm: 103, at: T0 });
  assert.equal(P.itemValue(p, 'rock:l0'), '100%', 'not 114%');
  assert.equal(P.item(p, 'rock:l0').best, 114, 'the pace is kept as it was');
  const q = P.emptyProgress();
  P.recordUntimed(q, 'rock:l0', { pace: 80, accuracy: 0.94, clean: true, eased: '', bpm: 74, at: T0 });
  P.recordUntimed(q, 'rock:l0', { pace: 90, accuracy: 0.97, clean: true, eased: '', bpm: 83, at: T0 + DAY });
  P.recordUntimed(q, 'rock:l0', { pace: 70, accuracy: 0.95, clean: true, eased: '', bpm: 65, at: T0 + 2 * DAY });
  assert.equal(P.itemValue(q, 'rock:l0'), '97%', 'the best of the takes, not the last');
  assert.equal(P.itemValue(p, 'rock:l1'), '', 'nothing played, nothing shown');
});

test('an L0 take that does not count — eased, or not clean — is no first-try best', () => {
  const p = P.emptyProgress();
  P.recordUntimed(p, 'rock:l0', { pace: 60, accuracy: 0.92, clean: true, eased: '', bpm: 55, at: T0 });
  P.recordUntimed(p, 'rock:l0', { pace: 70, accuracy: 1, clean: true, eased: 'Guide', bpm: 64, at: T0 + DAY });
  P.recordUntimed(p, 'rock:l0', { pace: 70, accuracy: 0.99, clean: false, eased: '', bpm: 64, at: T0 + DAY });
  assert.equal(P.itemValue(p, 'rock:l0'), '92%');
  const eased = P.emptyProgress();
  P.recordUntimed(eased, 'rock:l0', { pace: 70, accuracy: 1, clean: true, eased: 'Study', bpm: 64, at: T0 });
  assert.equal(P.itemValue(eased, 'rock:l0'), '', 'an eased take alone shows nothing');
  assert.equal(P.firstTryBest(P.item(eased, 'rock:l0')), 0);
});

test('the L0 chart still plots the pace, whatever the row shows', () => {
  const p = P.emptyProgress();
  P.recordUntimed(p, 'rock:l0', { pace: 40, accuracy: 1, clean: true, eased: '', bpm: 37, at: T0 });
  P.recordUntimed(p, 'rock:l0', { pace: 110, accuracy: 1, clean: true, eased: '', bpm: 101, at: T0 + DAY });
  const s = P.percentSeries(P.item(p, 'rock:l0').h, 50, 20, P.UNTIMED_SCALE);
  assert.ok(s.points[1].y < s.points[0].y, 'the faster pace plots higher, though both were 100% first try');
});

test('a higher rung learned ticks L0; L0 learned ticks nothing above it', () => {
  const p = P.emptyProgress();
  assert.deepEqual(P.higherLevels('rock:l0'), ['rock:l1', 'rock:l2', 'rock:l3', 'rock:l4']);
  P.recordTake(p, 'rock:l1', take(100));
  assert.equal(P.isDone(p, 'rock:l0'), true);
  const q = P.emptyProgress();
  P.recordUntimed(q, 'rock:l0', { pace: 40, accuracy: 1, clean: true, eased: '', bpm: 37, at: T0 });
  assert.equal(P.isDone(q, 'rock:l1'), false);
});

test('the L0 chart scale starts at nothing, so a slow first pace still shows', () => {
  const s = P.percentSeries([[0, 20, 100, 0, 9], [1, 30, 100, 0, 9]], 50, 20, P.UNTIMED_SCALE);
  assert.ok(s.points[0].y > s.points[1].y, 'a faster pace is higher');
  assert.ok(s.points[0].y < 19, 'and 20% is above the floor');
});

test('a version 1 file is read for what it reached, and merged into the rebuild', () => {
  const v1 = JSON.stringify({ version: 1, items: {
    old: { best: 100, bpm: 92, plays: 30, t: 50, done: 40, rep: { due: 99, step: 2, at: 60, ok: true },
      h: [[40, 100, 98, 12, 13]] },
    skipped: { skip: 7, plays: 0 },
    slow: { best: 60, plays: 3, t: 10 },
  } });
  const r = P.readProgress(v1);
  assert.equal(r.stale, true);
  assert.equal(r.legacy.old.best, 100, 'the old file is read');
  /* The stats log had long trimmed the drill learned first; it rebuilt a
   * slower best for another. */
  const rebuilt = P.emptyProgress();
  P.recordTake(rebuilt, 'slow', { speed: 80, accuracy: 1, sd: 10, clean: true, bpm: 80, at: 20000 });
  const p = P.mergeLegacy(rebuilt, r.legacy);
  assert.equal(P.item(p, 'old').best, 100);
  assert.equal(P.item(p, 'old').done, 40, 'the ✓ earned under the stricter rule holds');
  assert.deepEqual(P.item(p, 'old').rep, { due: 99, step: 2, at: 60, ok: true });
  assert.equal(P.item(p, 'skipped').skip, 7);
  assert.equal(P.item(p, 'slow').best, 80, 'the better of the two');
  assert.equal(P.item(p, 'slow').h.length, 1, 'the rebuilt history, which carries the dynamics');
});

test('a tour walked is learned, with no number to show and nothing to repeat', () => {
  const p = P.emptyProgress();
  const r = P.recordTour(p, 'tour:pads', T0);
  assert.equal(r.learned, true);
  assert.ok(P.isDone(p, 'tour:pads'));
  assert.equal(P.itemMark(p, 'tour:pads'), P.MARK_DONE);
  assert.equal(P.itemValue(p, 'tour:pads'), '');
  assert.equal(P.item(p, 'tour:pads').rep, null, 'never in Repetition');
  assert.equal(P.recordTour(p, 'tour:pads', T0 + 1000).learned, false, 'learned once');
  assert.equal(P.repetitionSession(p, T0 + 40 * 86400 * 1000).length, 0);
});
