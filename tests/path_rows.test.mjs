// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/path_rows.mjs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { builtins, RANDOM_DRILLS } from '../src/generator.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const generated = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), 'clock']);
const names = new Map([...builtins({}).map((c) => [c.family, c.name]), ...RANDOM_DRILLS.map((d) => [d.family, d.name])]);
const program = PLAN.buildProgram({ entries, categories: manifest.categories, has: (id) => generated.has(id),
  label: (id) => names.get(id) || id });
const folder = PLAN.programFolder(program, () => []);
const prefs = PLAN.pathSettingsFolder(manifest.categories.filter((c) => c.folder === 'Grooves'));
const CONTINUE = { label: 'Continue', value: '', continueRow: true };
const T0 = Date.UTC(2026, 9, 1, 12);
const byLabel = (f, l) => f.children.find((c) => c.label === l || c.label.startsWith(l));

test('Continue names the step it opens; a step row reads its best against its target', () => {
  const p = P.emptyProgress();
  let pc = R.pathContext(p, program, T0);
  assert.deepEqual(R.pathRow(CONTINUE, pc), { label: 'Continue', value: 'Quarters', mark: null },
    'the step\'s title, cut to what the row leaves it');
  assert.equal(pc.pick.step.id, 'subdiv:quarters');
  P.recordTake(p, 'subdiv:quarters', { speed: 45, accuracy: 1, sd: 10, clean: true, bpm: 45, at: T0 });
  pc = R.pathContext(p, program, T0);
  const time = byLabel(byLabel(folder, '0 Hello'), 'Time');
  const quarters = time.children.find((c) => c.step && c.step.id === 'subdiv:quarters');
  assert.deepEqual(R.pathRow(quarters, pc), { label: 'Quarters', value: '45/60', mark: null });
  P.recordTake(p, 'subdiv:quarters', { speed: 60, accuracy: 1, sd: 10, clean: true, bpm: 60, at: T0 + 1 });
  assert.equal(R.pathRow(quarters, R.pathContext(p, program, T0)).mark, P.MARK_DONE);
});

test('a due review alternates with the next step, one each, and Continue says which', () => {
  const p = P.emptyProgress();
  P.recordTake(p, 'flam', { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 100, at: T0 });
  const later = T0 + 2 * 86400000;
  assert.deepEqual(R.dueReviews(p, later), ['flam']);
  const titleOf = (id) => (id === 'flam' ? 'A very long review title' : id);
  const review = R.pathContext(p, program, later, { turn: 'review', titleOf });
  assert.deepEqual(review.pick, { kind: 'review', id: 'flam' });
  assert.deepEqual(R.pathRow(CONTINUE, review), { label: 'Review', value: 'A very long re', mark: null });
  const step = R.pathContext(p, program, later, { turn: 'step', titleOf });
  assert.equal(step.pick.kind, 'step');
  assert.equal(R.pathRow(CONTINUE, step).label, 'Continue');
  /* Nothing due: new steps only, whatever the turn. */
  assert.equal(R.continuePick(p, program, T0, 'review').kind, 'step');
  /* Nothing left on the path: reviews only, then all learned. */
  const done = { stages: [] };
  assert.equal(R.continuePick(p, done, later, 'step').kind, 'review');
  assert.equal(R.continuePick(p, done, T0, 'step'), null);
  assert.deepEqual(R.pathRow(CONTINUE, R.pathContext(p, done, T0)),
    { label: 'Continue', value: 'all learned', mark: null });
});

test('a value is cut to its room, never past a space', () => {
  assert.equal(R.fitValue('Rock backbeat L2', 12), 'Rock backbeat'.slice(0, 12).trimEnd());
  assert.equal(R.fitValue('Short', 12), 'Short');
  assert.equal(R.fitValue('Guess: drum (kick, snare)', 12), 'Guess: drum');
});

test('a parked step reads ~; the current stage is marked next, a finished one done', () => {
  const p = P.emptyProgress();
  P.parkItem(p, 'subdiv:quarters', T0);
  const pc = R.pathContext(p, program, T0);
  const time = byLabel(byLabel(folder, '0 Hello'), 'Time');
  const quarters = time.children.find((c) => c.step && c.step.id === 'subdiv:quarters');
  assert.equal(R.pathRow(quarters, pc).value, '~');
  assert.equal(R.pathRow(byLabel(folder, '0 Hello'), pc).mark, P.MARK_NEXT);
  P.recordTake(p, 'first-beat:l3', { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 70, at: T0 });
  assert.equal(R.pathRow(byLabel(folder, '0 Hello'), R.pathContext(p, program, T0)).mark, P.MARK_DONE);
});

test('a folder skip names the open steps; Undo skip names the skipped ones', () => {
  const p = P.emptyProgress();
  const ear = byLabel(byLabel(folder, '0 Hello'), 'Ear');
  const first = R.skipAllChange(ear.steps, p);
  assert.deepEqual(first.skip, ['quiz:guess:voice:kit3', 'quiz:hear:voice:kit3']);
  assert.deepEqual(first.unskip, []);
  for (const id of first.skip) P.skipItem(p, id, T0);
  assert.deepEqual(R.skipAllChange(ear.steps, p), { skip: [], unskip: first.skip });
});

test('Settings › Path rows show their value and say what a click changes', () => {
  const path = P.defaultPath();
  const yours = prefs;
  assert.equal(byLabel(yours, 'Styles').children.length, 6, 'one row a style');
  const time = byLabel(byLabel(yours, 'Tracks'), 'Time');
  assert.equal(R.prefValue(time, path), 'on');
  assert.deepEqual(R.prefChange(time, path, 7), { toggle: ['tracks', 'time'] });
  assert.deepEqual(R.prefChange(byLabel(yours, 'Rungs'), path, 7), { set: ['rungs', 'short'] });
  assert.deepEqual(R.prefChange(byLabel(yours, 'Intros'), path, 7), { set: ['intros', 'always'] });
  assert.deepEqual(R.prefChange(byLabel(yours, 'Start at'), { ...path, start: 6 }, 7), { set: ['start', 0] });
  assert.equal(R.prefValue(byLabel(yours, 'Start at'), { ...path, start: 3 }), 'Stage 3');
  assert.equal(R.pathRow({ label: 'X', id: 'flam' }, R.pathContext(P.emptyProgress(), program, T0)), null,
    'a library row is not the path\'s to decorate');
});
