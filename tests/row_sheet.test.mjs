// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The action sheet: what each kind of row offers, in the order and the words
 * both practice modules share.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SH from '../src/row_sheet.mjs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import * as R from '../src/path_rows.mjs';
import { drumsTree, leafIndex, CLOCK_ID } from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { builtins, RANDOM_DRILLS } from '../src/generator.mjs';
import { DRILLS } from '../src/guess.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const generated = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), CLOCK_ID]);
const program = PLAN.buildProgram({ entries, categories: manifest.categories, has: (id) => generated.has(id) });
const path = PLAN.programFolder(program);
const tree = drumsTree({ entries, categories: manifest.categories, drills: DRILLS, path });
const index = leafIndex(tree);
const T0 = Date.UTC(2026, 9, 1, 12);
const byLabel = (f, l) => f.children.find((c) => c.label === l || c.label.startsWith(l));
const env = (progress, extra = {}) => ({ progress, leafOf: (id) => index.get(id), hasCards: () => true,
  pick: R.continuePick(progress, program, T0), ...extra });
const labels = (row, e) => SH.sheetFor(row, e).map((a) => a.label);

test('the labels are the ones both modules use, word for word', () => {
  assert.deepEqual(Object.values(SH.LABELS), ['I know this: skip', 'I know it all: skip', 'Undo skip',
    'Start the path here', 'Test out: checkpoint', 'Lessons', 'Practise: Ladder', 'Practise: Clock',
    'Show as list', 'Show as map', 'Settings...']);
});

test('every label fits its row whole, the scrollbar showing beside it', async () => {
  /* drawList fits a label to SCREEN_W - 4: the row starts at x 2 and the
   * scrollbar takes the last column. 21 characters are 125 px and lose a letter. */
  const { createScreen } = await import('../tools/screen_buffer.mjs');
  const L = await import('../src/layout.mjs');
  const V = await import('../src/view.mjs');
  const ctx = createScreen();
  for (const l of Object.values(SH.LABELS)) {
    assert.ok(ctx.textWidth(l) <= L.SCREEN_W - 4, `"${l}" is ${ctx.textWidth(l)} px`);
  }
  /* And drawn on a sheet long enough to scroll, every label comes out whole. */
  const drawn = [];
  const text = ctx.text.bind(ctx);
  ctx.text = (x, y, s2, v) => { drawn.push(s2); text(x, y, s2, v); };
  const items = Object.values(SH.LABELS);
  for (let sel = 0; sel < items.length; sel++) V.drawList(ctx, { title: 'X', items, selected: sel });
  for (const l of items) assert.ok(drawn.includes(l), `"${l}" was cut`);
});

test('a stage: skip it all, start here, test out, its lessons, then Settings', () => {
  const p = P.emptyProgress();
  const stage = byLabel(path, '1 Eighth');
  const sheet = SH.sheetFor(stage, env(p));
  assert.deepEqual(sheet.map((a) => a.act), ['skipAll', 'start', 'testOut', 'lessons', 'settings']);
  assert.equal(sheet[1].index, 1);
  assert.equal(sheet[2].step.part, 'checkpoint', 'Test out plays the checkpoint');
  assert.deepEqual(labels(stage, env(p, { hasCards: () => false })),
    ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Settings...'],
    'no cards, no Lessons');
});

test('a folder skips what is open in it, and takes back what was skipped', () => {
  const p = P.emptyProgress();
  const ear = byLabel(byLabel(path, '0 Hello'), 'Ear');
  const first = SH.sheetFor(ear, env(p));
  assert.deepEqual(first.map((a) => a.act), ['skipAll', 'settings']);
  assert.deepEqual(first[0].ids, ['quiz:guess:voice:kit3', 'quiz:hear:voice:kit3']);
  P.skipItem(p, 'quiz:guess:voice:kit3', T0);
  const half = SH.sheetFor(ear, env(p));
  assert.deepEqual(half.map((a) => a.act), ['skipAll', 'unskip', 'settings']);
  assert.deepEqual(half[0].ids, ['quiz:hear:voice:kit3']);
  assert.deepEqual(half[1].ids, ['quiz:guess:voice:kit3']);
});

test('a step: skip it or undo the skip; a drill with a tempo goes on the Ladder or the Clock', () => {
  const p = P.emptyProgress();
  const time = byLabel(byLabel(path, '0 Hello'), 'Time');
  const quarters = time.children.find((r) => r.step.id === 'subdiv:quarters');
  assert.deepEqual(labels(quarters, env(p)),
    ['I know this: skip', 'Practise: Ladder', 'Practise: Clock', 'Settings...']);
  P.skipItem(p, 'subdiv:quarters', T0);
  assert.deepEqual(labels(quarters, env(p)), ['Undo skip', 'Practise: Ladder', 'Practise: Clock', 'Settings...']);
  P.recordTake(p, 'subdiv:quarters', { speed: 100, accuracy: 1, sd: 5, clean: true, bpm: 60, at: T0 });
  P.unskipItem(p, 'subdiv:quarters');
  assert.deepEqual(labels(quarters, env(p)), ['Practise: Ladder', 'Practise: Clock', 'Settings...'],
    'nothing to skip once it is done');
  /* A quiz has no tempo to climb or keep. */
  const guess = byLabel(byLabel(path, '0 Hello'), 'Ear').children[0];
  assert.deepEqual(labels(guess, env(P.emptyProgress())), ['I know this: skip', 'Settings...']);
});

test('L0 and a Clock step are no drills for the Ladder or the Clock', () => {
  const p = P.emptyProgress();
  const grooves = byLabel(byLabel(path, '0 Hello'), 'Grooves');
  const firstBeat = byLabel(grooves, 'First beat');
  assert.deepEqual(labels(firstBeat.children[0], env(p)), ['I know this: skip', 'Settings...'], 'L0');
  assert.ok(labels(firstBeat.children[1], env(p)).includes('Practise: Ladder'), 'L1 has a tempo');
  const clock = byLabel(byLabel(path, '1 Eighth'), 'Time').children.find((r) => r.step.wrap);
  assert.ok(clock, 'stage 1 has a Clock step');
  assert.ok(!labels(clock, env(p)).includes('Practise: Clock'));
});

test('the checkpoint is tested out of, never skipped', () => {
  const p = P.emptyProgress();
  const s0 = byLabel(path, '0 Hello');
  const cp = s0.children[s0.children.length - 1];
  assert.equal(cp.label, 'Checkpoint');
  assert.ok(!labels(cp, env(p)).includes('I know this: skip'));
});

test('Continue skips the step it would open, never a review', () => {
  const p = P.emptyProgress();
  const row = tree.children[0];
  const sheet = SH.sheetFor(row, env(p));
  assert.deepEqual(sheet.map((a) => a.act), ['skip', 'settings']);
  assert.equal(sheet[0].step.id, 'subdiv:quarters');
  assert.deepEqual(labels(row, env(p, { pick: { kind: 'review', id: 'flam' } })), ['Settings...']);
  assert.deepEqual(labels(row, env(p, { pick: null })), ['Settings...']);
});

test('the library: the Ladder and the Clock on a drill, only Settings on anything else', () => {
  const p = P.emptyProgress();
  const practice = byLabel(tree, 'Practice');
  const flam = byLabel(byLabel(byLabel(practice, 'Rudiments'), 'Flams'), 'Flam');
  assert.deepEqual(labels(flam, env(p)), ['Practise: Ladder', 'Practise: Clock', 'Settings...']);
  assert.equal(SH.sheetFor(flam, env(p))[0].leaf, flam);
  assert.deepEqual(labels(practice, env(p)), ['Settings...']);
  assert.deepEqual(labels(byLabel(tree, 'Quiz').children[0], env(p)), ['Settings...']);
  assert.deepEqual(labels(null, env(p)), ['Settings...']);
  /* A review opens the drill it names. */
  assert.deepEqual(labels({ label: 'Flam', repId: 'flam' }, env(p)),
    ['Practise: Ladder', 'Practise: Clock', 'Settings...']);
});

test('a map folder offers its list, and its list the map again', () => {
  const p = P.emptyProgress();
  assert.deepEqual(labels(byLabel(path, '0 Hello'), env(p, { view: 'map', hasCards: () => false })),
    ['I know it all: skip', 'Start the path here', 'Test out: checkpoint', 'Show as list', 'Settings...']);
  assert.deepEqual(labels(null, env(p, { view: 'list' })), ['Show as map', 'Settings...']);
  assert.deepEqual(labels(null, env(p)), ['Settings...'], 'no view, no switch');
});
