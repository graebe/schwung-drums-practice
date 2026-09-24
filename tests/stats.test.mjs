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
  assert.deepEqual(ST.drillsWithHistory(s), ['a', 'b']);
});

test('the file cannot grow without bound', () => {
  const s = ST.emptyStats();
  for (let i = 0; i < 500; i++) ST.addRecord(s, rec('a', 100 + i));
  assert.equal(s.records.length, ST.MAX_RECORDS);
  assert.equal(s.records[s.records.length - 1].bpm, 599, 'the newest must survive');
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

test('the sparkline spans the series, not zero', () => {
  /* Every tempo in a drill sits in a narrow band; a zero-based axis would
   * flatten a month of progress into one straight line. */
  const recs = [rec('d', 100), rec('d', 104), rec('d', 108)];
  const pts = ST.sparkline(recs, 20, 10);
  assert.equal(pts.length, 3);
  assert.equal(pts[0][1], 9, 'the lowest sits on the floor');
  assert.equal(pts[2][1], 0, 'the highest sits on the ceiling');
  assert.equal(pts[0][0], 0);
  assert.equal(pts[2][0], 19);
});

test('a flat or single-point series does not divide by zero', () => {
  assert.deepEqual(ST.sparkline([], 20, 10), []);
  assert.equal(ST.sparkline([rec('d', 100)], 20, 10).length, 1);
  const flat = ST.sparkline([rec('d', 100), rec('d', 100)], 20, 10);
  assert.ok(flat.every(([, y]) => Number.isFinite(y)));
});

test('an empty summary is zeros, not NaN', () => {
  assert.deepEqual(ST.summarise([]), { n: 0, best: 0, last: 0, bestSd: 0, lastSd: 0 });
});

test('the drill id separates settings that change the task', () => {
  assert.notEqual(
    ST.drillId('drill', 'x', { strictness: 'tight', sticking: 'strict' }),
    ST.drillId('drill', 'x', { strictness: 'loose', sticking: 'strict' }),
  );
  assert.equal(ST.drillLabel('ladder:single-paradiddle:normal'), 'single-paradiddle');
});
