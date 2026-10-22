// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ST from '../src/stats.mjs';

const rec = (drill, bpm, sd = 10, at = 0) => ST.makeRecord({ drill, bpm, sd, at });

test('a record keeps the tempo and the spread that earned it', () => {
  const r = ST.makeRecord({ drill: 'd', bpm: 104.4, sd: 11.26, mean: -3.31, n: 64, err: 2, at: 5.7 });
  assert.deepEqual(r, { t: 6, d: 'd', bpm: 104, sd: 11.3, mean: -3.3, n: 64, err: 2 });
});

test('history is kept per drill and never mixed', () => {
  /* Holding a paradiddle at 120 is not the same task as holding a samba at
   * 120, so the plot must never put them on one line. */
  const s = ST.emptyStats();
  ST.addRecord(s, rec('a', 100));
  ST.addRecord(s, rec('b', 200));
  ST.addRecord(s, rec('a', 110));
  assert.equal(ST.forDrill(s, 'a').length, 2);
  assert.equal(ST.summarise(ST.forDrill(s, 'a')).best, 110);
});

test('the file cannot grow without bound', () => {
  const s = ST.emptyStats();
  for (let i = 0; i < 500; i++) ST.addRecord(s, rec('a', 100 + i));
  assert.equal(s.records.length, ST.PER_DRILL, 'one drill keeps PER_DRILL takes');
  assert.equal(s.records[s.records.length - 1].bpm, 599, 'the newest must survive');
  for (let i = 0; i < 3000; i++) ST.addRecord(s, rec(`d${i % 100}`, 100));
  assert.equal(s.records.length, ST.MAX_RECORDS, 'and all of them together MAX_RECORDS');
});

test('a busy drill pushes out its own old takes, not other drills\' history', () => {
  const s = ST.emptyStats();
  ST.addRecord(s, rec('quiet', 90));
  for (let i = 0; i < 100; i++) ST.addRecord(s, rec('busy', 100 + i));
  assert.equal(ST.forDrill(s, 'quiet').length, 1);
  assert.equal(ST.forDrill(s, 'busy').length, ST.PER_DRILL);
  assert.equal(ST.forDrill(s, 'busy')[0].bpm, 100 + 100 - ST.PER_DRILL);
});

test('a record keeps its note count and whether it was clean', () => {
  const r = ST.makeRecord({ drill: 'drill:x:normal', bpm: 90, total: 32, clean: true });
  assert.equal(r.tot, 32);
  assert.equal(r.cl, 1);
  const back = ST.parseStats(ST.serialiseStats({ records: [r] })).records[0];
  assert.equal(back.tot, 32);
  assert.equal(back.cl, 1);
  assert.equal(ST.makeRecord({ drill: 'x', bpm: 90 }).cl, undefined);
});

test('a record keeps its dynamics: the score and what the misses were', () => {
  const r = ST.makeRecord({ drill: 'drill:x:normal', bpm: 90, dyn: 42.4, breakdown: {
    strays: 0, stickErrors: 0, dynErrors: 3,
    softAccents: { n: 2, vel: 148, need: 170 }, loudGhosts: { n: 1, vel: 61, need: 48 } } });
  assert.equal(r.dp, 42);
  assert.equal(r.dy, 3);
  assert.deepEqual([r.av, r.an, r.gv, r.gn], [74, 85, 61, 48]);
  assert.equal(ST.makeRecord({ drill: 'x', bpm: 90 }).dp, undefined, 'none judged, none kept');
});

test('a corrupt file reads as no history rather than failing to open', () => {
  /* Losing the plot is a great deal better than being unable to get back in —
   * and a file written while the power went is exactly that case. */
  for (const text of [null, '', '{trunc', 'null', '{"records":"nope"}', '[]']) {
    assert.deepEqual(ST.parseStats(text).records, [], JSON.stringify(text));
  }
});

test('individual bad records are dropped, good ones kept', () => {
  const s = ST.parseStats(JSON.stringify({
    records: [{ d: 'a', bpm: 100 }, null, { d: 'b' }, { bpm: 5 }, { d: 'c', bpm: 'x' }],
  }));
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].d, 'a');
});

test('stats round-trip through the file', () => {
  const s = ST.emptyStats();
  ST.addRecord(s, ST.makeRecord({ drill: 'x', bpm: 96, sd: 8.2, mean: 1.5, n: 32, err: 1, at: 99 }));
  assert.deepEqual(ST.parseStats(ST.serialiseStats(s)).records, s.records);
});

test('a personal best is the first time nothing has matched it', () => {
  const s = ST.emptyStats();
  const a = rec('d', 100);
  ST.addRecord(s, a);
  assert.equal(ST.isPersonalBest(s, a), true);
  const b = rec('d', 90);
  ST.addRecord(s, b);
  assert.equal(ST.isPersonalBest(s, b), false);
  const c = rec('d', 120);
  ST.addRecord(s, c);
  assert.equal(ST.isPersonalBest(s, c), true);
});

test('an empty summary is zeros, not NaN', () => {
  assert.deepEqual(ST.summarise([]), { n: 0, best: 0, last: 0, bestSd: 0, lastSd: 0 });
});

test('the drill id separates settings that change the task', () => {
  assert.notEqual(
    ST.drillId('drill', 'x', { strictness: 'tight', sticking: 'strict' }),
    ST.drillId('drill', 'x', { strictness: 'loose', sticking: 'strict' }),
  );
});

test('a drill\'s best is its tightest take at its tempo, not its tempo', () => {
  const s = ST.emptyStats();
  const r = (bpm, sd) => ST.makeRecord({ drill: 'drill:x:normal', bpm, sd, n: 10, clean: true });
  const a = r(90, 30); ST.addRecord(s, a);
  assert.equal(ST.isPersonalBest(s, a), true);
  const b = r(90, 25); ST.addRecord(s, b);
  assert.equal(ST.isPersonalBest(s, b), true, 'tighter at the same tempo is a best');
  const c = r(90, 28); ST.addRecord(s, c);
  assert.equal(ST.isPersonalBest(s, c), false);
});

test('a take that did not count is never a best, and is not measured against', () => {
  /* The reported take: the tightest spread ever on the drill, every accent
   * soft, 83% right — and it read "BEST YET". Replayed from the device. */
  const s = ST.emptyStats();
  const d = 'drill:rock-backbeat:l3:normal:strict';
  for (const [sd, err] of [[21, 43], [20.4, 16], [18.8, 18], [24.3, 16]]) {
    ST.addRecord(s, ST.makeRecord({ drill: d, bpm: 92, sd, n: 96, err }));
  }
  const failed = ST.makeRecord({ drill: d, bpm: 92, sd: 12, n: 96, err: 16 });
  ST.addRecord(s, failed);
  assert.equal(ST.isPersonalBest(s, failed), false);
  /* The first clean take is a best: the failed ones before it set no bar. */
  const clean = ST.makeRecord({ drill: d, bpm: 92, sd: 19, n: 96, err: 2, clean: true });
  ST.addRecord(s, clean);
  assert.equal(ST.isPersonalBest(s, clean), true);
  /* A quiz has no clean flag and is still judged on its rate. */
  const q = ST.emptyStats();
  const r1 = ST.makeRecord({ drill: 'guess:voice', bpm: 10, n: 20 });
  ST.addRecord(q, r1);
  assert.equal(ST.isPersonalBest(q, r1), true);
});

test('a record says what its errors were made of, and reads back', () => {
  const s = ST.emptyStats();
  const rec = ST.makeRecord({ drill: 'drill:x:normal', bpm: 92, sd: 12, n: 96, err: 16,
    breakdown: { strays: 1, stickErrors: 0, dynErrors: 16, softAccents: { n: 16, vel: 16 * 74, need: 16 * 83 } } });
  assert.equal(rec.st, 1);
  assert.equal(rec.sk, 0);
  assert.equal(rec.dy, 16);
  assert.equal(rec.av, 74);
  assert.equal(rec.an, 83);
  ST.addRecord(s, rec);
  assert.deepEqual(ST.parseStats(ST.serialiseStats(s)).records, s.records);
  const none = ST.makeRecord({ drill: 'x', bpm: 1, breakdown: { strays: 0, stickErrors: 0, dynErrors: 0,
    softAccents: { n: 0, vel: 0, need: 0 } } });
  assert.equal('av' in none, false, 'no accents missed, no velocity to report');
});

test('an L0 best is its fastest clean pace', () => {
  const s = ST.emptyStats();
  const a = ST.makeRecord({ drill: 'untimed:rock:l0:normal', bpm: 40, clean: true });
  ST.addRecord(s, a);
  const slow = ST.makeRecord({ drill: 'untimed:rock:l0:normal', bpm: 35, clean: true });
  ST.addRecord(s, slow);
  assert.equal(ST.isPersonalBest(s, slow), false);
  const messy = ST.makeRecord({ drill: 'untimed:rock:l0:normal', bpm: 60, clean: false });
  ST.addRecord(s, messy);
  assert.equal(ST.isPersonalBest(s, messy), false, 'a take that was not clean is no best');
  const fast = ST.makeRecord({ drill: 'untimed:rock:l0:normal', bpm: 48, clean: true });
  ST.addRecord(s, fast);
  assert.equal(ST.isPersonalBest(s, fast), true, 'measured against clean takes only');
});

test('a record\'s drill id reads back as it was written, colons in the id and all', () => {
  const opts = { strictness: 'tight', sticking: 'strict' };
  for (const [kind, id] of [['drill', 'rock-backbeat:l3'], ['ladder', 'subdiv:quarters'], ['untimed', 'songo:l0'],
    ['clock', 'reading:4'], ['drill', 'flam']]) {
    assert.deepEqual(ST.parseDrillId(ST.drillId(kind, id, opts)), { kind, id, strictness: 'tight', sticking: 'strict' });
    assert.equal(ST.parseDrillId(ST.drillId(kind, id, { strictness: 'normal' })).sticking, '');
  }
  assert.deepEqual(ST.parseDrillId('pick:subdiv:qe'), { kind: 'pick', id: 'subdiv:qe', strictness: '', sticking: '' });
  assert.deepEqual(ST.parseDrillId('guess:voice'), { kind: 'guess', id: 'voice', strictness: '', sticking: '' });
});
