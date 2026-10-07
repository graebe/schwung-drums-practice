/*
 * The lesson ladder, as projections.
 *
 * Three hand-written "basics" files used to spell out what these derive: one
 * groove, copied three times with voices removed. The tests that matter are
 * the ones that would have caught the copies drifting apart — that every rung
 * is the SAME groove with less in it, and that nothing moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as LV from '../src/levels.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { validateExercise } from '../src/exercise_io.mjs';

/* The rudiment families; every other category is a groove family. */
const RUDIMENT_CATS = ['rolls', 'diddles', 'flams', 'drags'];

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const chartOf = (id) => parseExercise(read(`${id}.json`), id).chart;

test('the ladder is ordered, and every rung is a real level', () => {
  assert.deepEqual(LV.LEVELS.map((l) => l.id), ['l1', 'l2', 'l3', 'l4']);
  for (const lv of LV.LEVELS) {
    assert.ok(lv.step && lv.label, `${lv.id} needs a label`);
    assert.equal(LV.levelById(lv.id), lv);
  }
  assert.equal(LV.levelById('nope'), null);
  assert.equal(LV.projectLevel(chartOf('rock-backbeat'), 'nope'), null);
});

test('a projection is the same groove with voices removed — nothing moves', () => {
  /* The property the whole idea rests on: the kick is the same pad at L2 as
   * at L4, so what you learn at the bottom transfers literally. */
  const full = chartOf('sixteenth-funk');
  for (const lv of LV.availableLevels(full)) {
    const p = LV.projectLevel(full, lv.id);
    for (const e of p.events) {
      const original = full.events.find((o) => Math.abs(o.beat - e.beat) < 1e-9);
      assert.ok(original, `${lv.id} invented an event at beat ${e.beat}`);
      for (const v of e.voices) {
        assert.ok(original.voices.includes(v), `${lv.id} invented ${v} at beat ${e.beat}`);
      }
    }
  }
});

test('each rung is a superset of the one below it', () => {
  const full = chartOf('sixteenth-funk');
  const rungs = LV.availableLevels(full).map((lv) => LV.projectLevel(full, lv.id));
  for (let i = 1; i < rungs.length; i++) {
    const below = new Set(rungs[i - 1].events.flatMap((e) => e.voices));
    const here = new Set(rungs[i].events.flatMap((e) => e.voices));
    for (const v of below) assert.ok(here.has(v), `level ${i} dropped ${v}`);
    assert.ok(here.size > below.size, `level ${i} added nothing`);
  }
});

test('the ladder starts with the timekeeper and ends as written', () => {
  const full = chartOf('rock-backbeat');
  const first = LV.projectLevel(full, 'l1');
  assert.deepEqual([...new Set(first.events.flatMap((e) => e.voices))], ['HH'],
    'the first rung is the hi-hat alone');
  const last = LV.projectLevel(full, 'l4');
  assert.equal(last.events.length, full.events.length, 'the last rung is the whole groove');
});

test('a projection keeps each surviving voice its own dynamic', () => {
  /* And a stack-wide string must become a map: once the snare is removed, its
   * accent must not be left applying to the hi-hat that survived. */
  const chart = {
    id: 'x', name: 'x', bpm: 90, timeSig: [4, 4], loopBars: 1, repeats: 4, sticking: 'off',
    events: [{ beat: 0, voices: ['HH', 'SN'], dyn: { SN: 'accent' } },
             { beat: 1, voices: ['HH', 'SN'], dyn: 'ghost' }],
  };
  const l1 = LV.projectLevel(chart, 'l1');
  assert.deepEqual(l1.events[0].voices, ['HH']);
  assert.equal(l1.events[0].dyn, undefined, 'the snare accent followed the snare out');
  assert.deepEqual(l1.events[1].dyn, { HH: 'ghost' }, 'a shared ghost still applies');
});

test('an event left with no voices is dropped, not left empty', () => {
  const chart = { id: 'x', name: 'x', events: [{ beat: 0, voices: ['SN'] }, { beat: 1, voices: ['HH'] }] };
  const l1 = LV.projectLevel(chart, 'l1');
  assert.equal(l1.events.length, 1);
  assert.equal(l1.events[0].beat, 1);
});

test('availableLevels collapses rungs that would play the same notes', () => {
  /* A hi-hat drill has ONE level, not four identical ones. */
  const hatOnly = { id: 'h', name: 'h', events: [{ beat: 0, voices: ['HH'] }] };
  assert.equal(LV.availableLevels(hatOnly).length, 1);

  const hatKick = { id: 'k', name: 'k', events: [{ beat: 0, voices: ['HH', 'KK'] }] };
  assert.equal(LV.availableLevels(hatKick).length, 2);

  /* And a groove with no cymbal at all still has rungs. */
  const noCym = { id: 'n', name: 'n', events: [{ beat: 0, voices: ['KK'] }, { beat: 1, voices: ['SN'] }] };
  assert.ok(LV.availableLevels(noCym).length >= 1);
  assert.equal(LV.projectLevel(noCym, 'l1'), null, 'no material at the bottom rung');
});

test('every bundled groove has a ladder, and every rung is a valid drill', () => {
  const grooves = manifest.entries.filter((e) => !RUDIMENT_CATS.includes(e.category));
  assert.equal(grooves.length, 14);
  let withLadder = 0;
  for (const e of grooves) {
    const c = chartOf(e.id);
    const levels = LV.availableLevels(c);
    assert.ok(levels.length >= 1, `${e.id} has no levels at all`);
    if (levels.length > 1) withLadder++;
    for (const lv of levels) {
      const p = LV.projectLevel(c, lv.id);
      assert.deepEqual(validateExercise(p), [], `${e.id} ${lv.id}`);
      assert.equal(p.repeats, c.repeats, 'a rung keeps the practice length');
      assert.equal(p.bpm, c.bpm, 'a rung keeps the tempo');
      assert.ok(p.id.endsWith(lv.id), 'a rung is identifiable for the stats');
    }
  }
  assert.ok(withLadder >= 12, `only ${withLadder} of 14 grooves gained a ladder`);
});

test('a rung is recorded against its own id, so the plot never mixes them', () => {
  const c = chartOf('rock-backbeat');
  const ids = LV.availableLevels(c).map((lv) => LV.projectLevel(c, lv.id).id);
  assert.equal(new Set(ids).size, ids.length);
});
