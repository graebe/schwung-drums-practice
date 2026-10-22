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
const folder = PLAN.programFolder(program, () => [], manifest.categories.filter((c) => c.folder === 'Grooves'));
const T0 = Date.UTC(2026, 9, 1, 12);
const byLabel = (f, l) => f.children.find((c) => c.label === l || c.label.startsWith(l));

test('Continue and Skip name the step; a step row reads its best against its target', () => {
  const p = P.emptyProgress();
  let pc = R.pathContext(p, program, T0);
  assert.equal(R.pathRow(byLabel(folder, 'Continue'), pc).label, 'Next: Quarters');
  assert.equal(R.pathRow(byLabel(folder, 'Skip next'), pc).label, 'Skip: Quarters');
  P.recordTake(p, 'subdiv:quarters', { speed: 45, accuracy: 1, sd: 10, clean: true, bpm: 45, at: T0 });
  pc = R.pathContext(p, program, T0);
  const time = byLabel(byLabel(folder, '0 Hello'), 'Time');
  const quarters = time.children.find((c) => c.step && c.step.id === 'subdiv:quarters');
  /* Played, so Continue has moved on to the track left longest. */
  assert.deepEqual(R.pathRow(quarters, pc), { label: 'Quarters', value: '45/60', mark: null });
  assert.equal(R.pathRow(byLabel(folder, 'Continue'), pc).label, 'Next: First beat L0');
  P.recordTake(p, 'subdiv:quarters', { speed: 60, accuracy: 1, sd: 10, clean: true, bpm: 60, at: T0 + 1 });
  assert.equal(R.pathRow(quarters, R.pathContext(p, program, T0)).mark, P.MARK_DONE);
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

test('Skip all here skips the open steps, then turns round and takes them back', () => {
  const p = P.emptyProgress();
  const ear = byLabel(byLabel(folder, '0 Hello'), 'Ear');
  const row = byLabel(ear, 'Skip all here');
  const first = R.skipAllChange(row.scope, p);
  assert.deepEqual(first.skip, ['quiz:guess:voice:kit3', 'quiz:hear:voice:kit3']);
  for (const id of first.skip) P.skipItem(p, id, T0);
  assert.equal(R.pathRow(row, R.pathContext(p, program, T0)).label, 'Unskip all here');
  assert.deepEqual(R.skipAllChange(row.scope, p).unskip, first.skip);
});

test('Your path rows show their value and say what a click changes', () => {
  const path = P.defaultPath();
  const yours = byLabel(folder, 'Your path');
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
