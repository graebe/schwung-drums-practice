// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The Learning Path in motion (scenes.mjs): what a step finished, and the
 * scenes on along the path, in their order, against the real path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SCN from '../src/scenes.mjs';
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
const folders = PLAN.programFolder(program).children.filter((c) => c.stage);
const T0 = Date.UTC(2026, 9, 1, 12);
const env = { atMs: T0 };

/* A step played to its end, as the module records it. */
function finish(p, st) {
  if (st.tour) P.recordTour(p, st.id, T0);
  else if (st.quiz) P.recordRound(p, st.id, { correct: 20, wrong: 0, hinted: 0, at: T0 });
  else if (/:l0$/.test(st.id)) P.recordUntimed(p, st.id, { pace: 100, accuracy: 1, clean: true, bpm: 90, dyn: 1, at: T0 });
  else P.recordTake(p, st.id, { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 90, at: T0 });
}

const stage0 = program.stages[0];
const core0 = PLAN.coreSteps(stage0);
const step = (id) => core0.find((st) => st.id === id);

/* Play `st` on `p`: the scenes from it to the step after, and that step. */
function playOn(p, st) {
  const before = SCN.pathState(p, program, folders, env);
  finish(p, st);
  const change = SCN.changes(before, SCN.pathState(p, program, folders, env));
  const next = PLAN.stepAfter(p, program, st, T0);
  return { change, next, scenes: SCN.pathScenes({ progress: p, program, folders, step: st, next, change, env }) };
}

const kinds = (scenes) => scenes.map((s) => (s.kind === 'zoom' ? `zoom ${s.dir}` : s.kind));

test('a step tells what it finished: a place, a stage, the whole path', () => {
  const p = P.emptyProgress();
  P.recordTour(p, 'tour:pads', T0);
  const { change } = playOn(p, step('subdiv:quarters'));      /* Time's only step in stage 0 */
  assert.deepEqual(change.places, ['s0:time']);
  assert.deepEqual(change.stages, []);
  assert.equal(change.all, false);
  assert.deepEqual(SCN.changes(null, null), { places: [], stages: [], all: false });
});

test('a place finished, the next step in another: celebrate it, then walk there', () => {
  const p = P.emptyProgress();
  P.recordTour(p, 'tour:pads', T0);
  const { scenes, next } = playOn(p, step('subdiv:quarters'));
  assert.deepEqual(kinds(scenes), ['celebrate', 'walk']);
  const folder = SCN.folderOf(folders, 's0');
  const [party, walk] = scenes;
  assert.equal(party.big, false);
  assert.equal(party.map.level, 'island');
  assert.equal(party.at, MP.placeOfStep(folder, step('subdiv:quarters')));
  assert.equal(party.say, 'Time done');
  assert.equal(walk.from, party.at);
  assert.equal(walk.to, MP.placeOfStep(folder, next));
  assert.notEqual(walk.to, walk.from);
  assert.match(walk.say, /^Walking to /);
  assert.equal(walk.map, party.map, 'the walk is on the island just celebrated');
});

test('nothing finished, or the next step in the same place: no scene', () => {
  const p = P.emptyProgress();
  P.recordTour(p, 'tour:pads', T0);
  assert.deepEqual(playOn(p, step('quiz:guess:voice:kit3')).scenes, [], 'Ear is not through yet');
  assert.deepEqual(SCN.pathScenes({ progress: p, program, folders, step: null, next: null, change: null }), []);
  /* The same place: a finished place whose next step is in it again. */
  const st = step('subdiv:quarters');
  const change = { places: ['s0:time'], stages: [], all: false };
  assert.deepEqual(SCN.pathScenes({ progress: p, program, folders, step: st, next: st, change, env }), []);
});

test('a stage through: fireworks, zoom out, sail, zoom in, walk to the next step', () => {
  const p = P.emptyProgress();
  for (const st of core0) if (!st.tour && st.id !== 'first-beat:l3') finish(p, st);
  P.skipItem(p, 'first-beat:l3', T0);                          /* core through but for the tour */
  const { scenes, next, change } = playOn(p, step('tour:pads'));
  assert.deepEqual(change.stages, ['s0']);
  assert.equal(next.stage, 's1');
  const want = ['celebrate', 'zoom out', 'walk', 'zoom in'];
  const arrive = MP.placeOfStep(SCN.folderOf(folders, 's1'), next);
  if (arrive > 0) want.push('walk');
  assert.deepEqual(kinds(scenes), want);
  const [party, out, sail, into] = scenes;
  assert.equal(party.big, true);
  assert.equal(party.say, 'Stage 0 complete');
  assert.equal(out.at, 0);
  assert.equal(out.world.level, 'world');
  assert.deepEqual([sail.map.level, sail.from, sail.to], ['world', 0, 1]);
  assert.deepEqual([into.at, into.island.level, into.say], [1, 'island', '1 Eighth notes']);
  if (arrive > 0) assert.deepEqual([scenes[4].from, scenes[4].to, scenes[4].map], [0, arrive, into.island]);
});

test('the whole path through: the stage\'s fireworks, zoom out, the finale', () => {
  const p = P.emptyProgress();
  const last = program.stages[program.stages.length - 1];
  /* Every stage before the last through; the last's checkpoint played now. */
  for (const stage of program.stages.slice(0, -1)) for (const st of PLAN.coreSteps(stage)) finish(p, st);
  const cp = PLAN.checkpointSteps(last)[0];
  const { scenes, next, change } = playOn(p, cp);
  assert.equal(next, null);
  assert.equal(change.all, true);
  assert.deepEqual(kinds(scenes), ['celebrate', 'zoom out', 'finale']);
  assert.equal(scenes[0].big, true);
  assert.equal(scenes[2].say, 'Learning Path complete');
  assert.equal(scenes[2].at, last.index, 'the avatar on the last island');
});

test('a scene lasts its engine frame; a big celebration adds its fireworks', () => {
  assert.equal(SCN.sceneMs({ kind: 'celebrate' }), SCN.SCENE_MS.celebrate);
  assert.equal(SCN.sceneMs({ kind: 'celebrate', big: true }), SCN.SCENE_MS.celebrate + SCN.SCENE_MS.fireworks);
  for (const k of ['zoom', 'star', 'finale']) assert.equal(SCN.sceneMs({ kind: k }), SCN.SCENE_MS[k]);
  assert.equal(SCN.sceneMs({ kind: 'walk' }), 0, 'a walk lasts until it arrives');
});

test('a step finds its place on the island: a track, the checkpoint, or none', () => {
  const folder = SCN.folderOf(folders, 's0');
  const labels = (st) => folder.children[MP.placeOfStep(folder, st)].label;
  assert.equal(labels(step('subdiv:quarters')), 'Time');
  assert.equal(labels(PLAN.checkpointSteps(stage0)[0]), 'Checkpoint');
  assert.equal(MP.placeOfStep(folder, { key: 'nowhere' }), -1);
  assert.equal(MP.placeOfStep(null, step('subdiv:quarters')), -1);
  assert.equal(SCN.folderOf(folders, 'nope'), null);
});
