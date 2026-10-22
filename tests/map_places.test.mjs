// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The Path as places on the map: what each island and each place is, and the
 * state it is drawn in, against the real path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as MP from '../src/map_places.mjs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import { CLOCK_ID } from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { builtins, RANDOM_DRILLS } from '../src/generator.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const generated = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), CLOCK_ID]);
const program = PLAN.buildProgram({ entries, categories: manifest.categories, has: (id) => generated.has(id) });
const folder = PLAN.programFolder(program);
const T0 = Date.UTC(2026, 9, 1, 12);
const take = (p, id, speed = 100, at = T0) =>
  P.recordTake(p, id, { speed, accuracy: 1, sd: 10, clean: true, bpm: 90, at });
const states = (r) => r.places.map((p) => p.state);

test('the world: an island per stage, the first current, the rest ahead', () => {
  const r = MP.worldPlaces(P.emptyProgress(), program);
  assert.equal(r.places.length, 7);
  assert.deepEqual(r.targets, [0, 1, 2, 3, 4, 5, 6], 'each island opens its stage, the Path\'s first rows');
  assert.ok(r.places.every((p) => p.kind === 'island'));
  assert.equal(r.places[0].label, '0 Hello, kit');
  assert.deepEqual(states(r), ['current', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
});

test('a stage passed is done, the start skips what is before it, a played stage is started', () => {
  const p = P.emptyProgress();
  take(p, 'first-beat:l3');                       /* stage 0's checkpoint */
  let r = MP.worldPlaces(p, program);
  assert.equal(r.places[0].state, 'done');
  assert.equal(r.places[1].state, 'current');
  take(p, 'house:l1', 50);                         /* something of stage 2 */
  r = MP.worldPlaces(p, program);
  assert.equal(r.places[2].state, 'started', 'played ahead is started, not ahead');
  P.setPath(p, 'start', 3);
  r = MP.worldPlaces(p, program);
  assert.deepEqual(states(r).slice(0, 4), ['done', 'skipped', 'skipped', 'current']);
});

test('an island\'s percent is its core done, and its due count today\'s reviews in it', () => {
  const p = P.emptyProgress();
  take(p, 'subdiv:quarters', 100, T0);
  const core = PLAN.coreSteps(program.stages[0], p.path);
  let r = MP.worldPlaces(p, program);
  assert.equal(r.places[0].percent, Math.round(100 / core.length));
  const later = T0 + 2 * 86400000;
  r = MP.worldPlaces(p, program, { dueIds: MP.dueIdsOf(p, later) });
  assert.equal(r.places[0].due, 1, 'quarters is due again');
  assert.equal(r.places[3].due, 0);
});

test('a stage\'s island: hut, a place per track, cove, fort — the folder\'s rows in its order', () => {
  const stage = folder.children[1];
  const r = MP.islandPlaces(P.emptyProgress(), program, stage, { atMs: T0 });
  assert.deepEqual(r.places.map((p) => [p.label, p.kind]),
    [['Lessons', 'hut'], ['Ear', 'place'], ['Time', 'place'], ['Grooves', 'place'], ['Electives', 'cove'],
      ['Checkpoint', 'fort']]);
  assert.deepEqual(r.targets, [0, 1, 2, 3, 4, 5]);
  assert.ok(r.places.slice(1).every((p) => p.state === 'ahead'), 'stage 1 is not yet: its places are ahead');
});

test('on the current island Continue\'s track is current, a skipped track skipped, a passed fort done', () => {
  const p = P.emptyProgress();
  const stage = folder.children[0];
  let r = MP.islandPlaces(p, program, stage, { atMs: T0, hutPercent: () => 50 });
  const by = (label) => r.places.find((x) => x.label === label);
  assert.equal(by('Time').state, 'current', 'Continue opens Quarters first');
  assert.equal(by('Lessons').state, 'started', 'half the cards read');
  assert.equal(by('Lessons').percent, 50);
  for (const st of stage.children.find((c) => c.label === 'Ear').steps) P.skipItem(p, st.id, T0);
  take(p, 'first-beat:l3');
  r = MP.islandPlaces(p, program, stage, { atMs: T0, hutPercent: () => 100 });
  assert.equal(by('Ear').state, 'skipped');
  assert.equal(by('Checkpoint').state, 'done');
  assert.equal(by('Checkpoint').percent, 100);
  assert.equal(by('Lessons').state, 'done');
});

test('the avatar starts on the current place, else the first open one; a row maps to its place', () => {
  const mk = (s) => s.map((state) => ({ state }));
  assert.equal(MP.startPlace(mk(['done', 'fresh', 'current'])), 2);
  assert.equal(MP.startPlace(mk(['done', 'skipped', 'fresh'])), 2);
  assert.equal(MP.startPlace(mk(['done', 'done'])), 0);
  assert.equal(MP.placeOfChild([0, 1, 2], 2), 2);
  assert.equal(MP.placeOfChild([0, 1, 2], 7), -1, 'Review is no place');
});

test('the title: the place and its percent, its reviews when they fit, the label giving way at a word', () => {
  const measure = (s) => s.length * 6 - 1;
  const place = (label, percent, due = 0) => ({ label, percent, due });
  assert.deepEqual(MP.mapTitle(place('2 Sixteenths', 64), 126, measure), { title: '2 Sixteenths', right: '64%' });
  assert.deepEqual(MP.mapTitle(place('2 Sixteenths', 64, 2), 126, measure), { title: '2 Sixteenths', right: '64%' },
    'a lone stage number names nothing: the due count goes');
  assert.deepEqual(MP.mapTitle(place('Time', 64, 2), 126, measure), { title: 'Time', right: '64% 2 due' });
  assert.deepEqual(MP.mapTitle(place('3 Ghosts & flams', 5, 3), 126, measure), { title: '3 Ghosts &', right: '5% 3 due' });
  assert.deepEqual(MP.mapTitle(place('Supercalifragilistic', 5, 3), 126, measure),
    { title: 'Supercalifragilistic', right: '5%' }, 'no word left: the due count goes first');
  assert.deepEqual(MP.mapTitle(null, 126, measure), { title: '', right: '' });
});
