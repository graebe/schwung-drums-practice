import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as IO from '../src/exercise_io.mjs';
import { chartTotalBeats, loopBeats } from '../src/chart.mjs';
import { layoutForChart } from '../src/padmap.mjs';
import { createRun } from '../src/scoring.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');

test('a malformed file is refused whole, never half-loaded', () => {
  assert.ok(IO.parseExercise('{not json', 'x').error);
  assert.ok(IO.parseExercise('null', 'x').error);
  assert.ok(IO.parseExercise('{"name":"x"}', 'x').error, 'no events');
  assert.ok(IO.parseExercise('{"events":[{"beat":0,"voices":["SN"]}]}', 'x').error, 'no name');
});

test('every field is checked against what the module can actually play', () => {
  const bad = (o) => IO.validateExercise({ name: 'n', events: [{ beat: 0, voices: ['SN'] }], ...o });
  assert.ok(bad({ bpm: 5 }).length);
  assert.ok(bad({ timeSig: [0, 4] }).length);
  assert.ok(bad({ loopBars: 99 }).length);
  assert.ok(bad({ sticking: 'maybe' }).length);
  assert.ok(bad({ events: [{ beat: 0, voices: ['ZZ'] }] }).length, 'unknown voice');
  assert.ok(bad({ events: [{ beat: 0, voices: ['SN'], hand: 'X' }] }).length);
  assert.ok(bad({ events: [{ beat: 0, voices: ['SN'], dyn: 'loud' }] }).length);
  assert.ok(bad({ events: [{ beat: -1, voices: ['SN'] }] }).length, 'negative beat');
  assert.equal(bad({}).length, 0);
});

test('beats must run forwards — everything downstream walks the list once', () => {
  const r = IO.parseExercise(JSON.stringify({
    name: 'x', events: [{ beat: 2, voices: ['SN'] }, { beat: 1, voices: ['SN'] }],
  }), 'x');
  assert.ok(/backwards/.test(r.error));
});

test('hits on the same beat are folded into one stack', () => {
  /* Two entries on one beat would draw twice and read as a zero-length note. */
  const r = IO.parseExercise(JSON.stringify({
    name: 'x', events: [{ beat: 0, voices: ['KK'] }, { beat: 0, voices: ['HH'] }],
  }), 'x');
  assert.equal(r.chart.events.length, 1);
  assert.deepEqual(r.chart.events[0].voices, ['KK', 'HH']);
});

test('a drill asking for a voice no layout reaches says so', () => {
  const warn = IO.playabilityWarnings({ events: [{ voices: ['HF'] }], sticking: 'off' });
  assert.ok(warn.some((w) => /no pad/.test(w)));
  assert.deepEqual(IO.playabilityWarnings({ events: [{ voices: ['SN'] }], sticking: 'off' }), []);
});

test('sticking on with no hands written is called out', () => {
  const warn = IO.playabilityWarnings({ events: [{ voices: ['SN'] }], sticking: 'strict' });
  assert.ok(warn.some((w) => /no hands/.test(w)));
});

test('the manifest survives rubbish without losing the good entries', () => {
  const m = IO.parseManifest(JSON.stringify({
    exercises: [{ id: 'a', file: 'a.json' }, null, { id: 'b' }, { file: 'c.json' }],
  }));
  assert.equal(m.entries.length, 1);
  assert.equal(IO.parseManifest('{[').entries.length, 0);
});

/* ---- the bundled material ---------------------------------------------- */

const manifest = IO.parseManifest(read('index.json'));

test('the manifest names every bundled file, and every file is named', () => {
  const onDisk = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const named = manifest.entries.map((e) => e.file).sort();
  assert.deepEqual(named, onDisk, 'the manifest and the directory disagree');
  assert.equal(new Set(manifest.entries.map((e) => e.id)).size, manifest.entries.length);
});

test('all 30 bundled drills load, validate and are playable', () => {
  assert.equal(manifest.entries.length, 30);
  let rudiments = 0;
  let grooves = 0;
  for (const e of manifest.entries) {
    const r = IO.parseExercise(read(e.file), e.id);
    assert.equal(r.error, undefined, `${e.id}: ${r.error}`);
    const c = r.chart;
    assert.deepEqual(IO.playabilityWarnings(c), [], `${e.id} is not playable`);
    assert.ok(layoutForChart(c), `${e.id} needs a layout that does not exist`);
    /* A drill must fit inside its own loop, or it overlaps its own repeat. */
    assert.ok(chartTotalBeats(c) < loopBeats(c), `${e.id} overruns its loop`);
    if (e.group === 'rudiment') rudiments++;
    if (e.group === 'groove') grooves++;
  }
  assert.equal(rudiments, 16);
  assert.equal(grooves, 14);
});

test('every rudiment enforces sticking and writes a hand on every stroke', () => {
  for (const e of manifest.entries.filter((x) => x.group === 'rudiment')) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    assert.equal(c.sticking, 'strict', `${e.id}`);
    for (const ev of c.events) assert.ok(ev.hand, `${e.id} has a stroke with no hand`);
  }
});

test('every rudiment alternates into something a pair of hands could play', () => {
  /* Two strokes on the same hand at the same instant is not a rudiment, it is
   * a typo. */
  for (const e of manifest.entries.filter((x) => x.group === 'rudiment')) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    for (let i = 1; i < c.events.length; i++) {
      const gap = c.events[i].beat - c.events[i - 1].beat;
      if (gap > 1e-6) continue;
      assert.notEqual(c.events[i].hand, c.events[i - 1].hand, `${e.id} at beat ${c.events[i].beat}`);
    }
  }
});

test('every groove leaves sticking off and every drill builds a run', () => {
  for (const e of manifest.entries) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    if (e.group === 'groove') assert.equal(c.sticking, 'off', e.id);
    const run = createRun(c, { looping: true });
    assert.ok(run.entries.length > 0, e.id);
    assert.ok(run.totalNotes > 0, e.id);
  }
});
