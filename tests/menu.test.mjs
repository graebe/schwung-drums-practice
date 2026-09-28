/*
 * What the drill list contains, and in what order.
 *
 * This was untested logic inside ui.js, and it decides what somebody sees the
 * first time they open the module — which is the one decision in the whole
 * thing most likely to be got wrong and least likely to be noticed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMenu, menuRows } from '../src/menu.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { builtins } from '../src/generator.mjs';
import { DRILLS } from '../src/guess.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const fileCharts = manifest.entries.map((e) => parseExercise(read(e.file), e.id).chart);
const full = () => buildMenu({ fileCharts, generated: builtins(), quizzes: DRILLS });

test('the ear training leads — you cannot play a groove you cannot hear', () => {
  const items = full();
  assert.equal(items[0].kind, 'quiz', `opens with ${items[0].kind}`);
  const quizzes = items.filter((m) => m.kind === 'quiz');
  assert.deepEqual(items.slice(0, quizzes.length).map((m) => m.kind),
    quizzes.map(() => 'quiz'), 'the quizzes are not contiguous at the top');
});

test('the drills follow, and the screens ABOUT practising come last', () => {
  const items = full();
  const firstDrill = items.findIndex((m) => ['chart', 'levels'].includes(m.kind));
  const lastDrill = items.map((m) => m.kind).lastIndexOf('chart');
  const lastLevels = items.map((m) => m.kind).lastIndexOf('levels');
  const meta = items.findIndex((m) => ['progress', 'ladder', 'clock'].includes(m.kind));
  assert.ok(firstDrill > 0, 'no drills at all');
  assert.ok(meta > Math.max(lastDrill, lastLevels), 'Progress or the Ladder came before a drill');
  assert.equal(items[items.length - 1].kind, 'progress');
});

test('a groove with a ladder opens it; one without starts straight away', () => {
  const items = full();
  const withLadder = items.filter((m) => m.kind === 'levels');
  assert.ok(withLadder.length >= 12, `only ${withLadder.length} grooves offer a ladder`);
  for (const m of withLadder) {
    assert.equal(m.value, '>', 'a ladder must be marked as one');
    assert.ok(m.levels.length > 1);
  }
  /* A rudiment is one thing to play, not a ladder. */
  const rudiment = items.find((m) => m.label === 'Single paradiddle');
  assert.equal(rudiment.kind, 'chart');
});

test('every entry can be acted on — no dead rows', () => {
  for (const m of full()) {
    assert.ok(m.label && m.label.length > 0, 'an entry with no label');
    assert.ok(['chart', 'levels', 'ladder', 'clock', 'progress', 'quiz'].includes(m.kind), m.kind);
    if (m.kind === 'chart') assert.ok(m.chart, `${m.label} has no chart`);
    if (m.kind === 'levels') assert.ok(m.chart && m.levels.length, `${m.label} has no levels`);
    if (m.kind === 'quiz') assert.ok(m.quiz, `${m.label} has no quiz`);
  }
});

test('the rows carry only what the list draws', () => {
  const rows = menuRows(full());
  assert.equal(rows.length, full().length);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['label', 'value']);
    assert.equal(typeof r.value, 'string');
  }
});

test('an empty install still produces a usable list', () => {
  /* No exercises on disk is a real state — a failed install, or a first run
   * before the manifest is read. */
  const items = buildMenu({});
  assert.ok(items.length >= 3);
  assert.ok(items.some((m) => m.kind === 'progress'));
});

test('every label fits the list', () => {
  for (const r of menuRows(full())) {
    assert.ok(r.label.length <= 21, `"${r.label}" is ${r.label.length} chars`);
  }
});
