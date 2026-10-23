// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * A scene of the Learning Path on the screen and the pads (scene_view.mjs):
 * every kind draws from its first frame to its last, and the pads follow it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SCN from '../src/scenes.mjs';
import * as SV from '../src/scene_view.mjs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import { CLOCK_ID } from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { builtins, RANDOM_DRILLS } from '../src/generator.mjs';
import { createScreen, countOn } from '../tools/screen_buffer.mjs';
import { MAP_PALETTE, SCENE_PALETTE } from '../src/padmap.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const generated = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), CLOCK_ID]);
const program = PLAN.buildProgram({ entries, categories: manifest.categories, has: (id) => generated.has(id) });
const folders = PLAN.programFolder(program).children.filter((c) => c.stage);
const T0 = Date.UTC(2026, 9, 1, 12);
const env = { atMs: T0 };

/* The whole path through on its last checkpoint: every kind but the star. */
function finalePlan() {
  const p = P.emptyProgress();
  for (const stage of program.stages.slice(0, -1)) {
    for (const st of PLAN.coreSteps(stage)) {
      if (st.tour) P.recordTour(p, st.id, T0);
      else if (st.quiz) P.recordRound(p, st.id, { correct: 20, wrong: 0, hinted: 0, at: T0 });
      else if (/:l0$/.test(st.id)) P.recordUntimed(p, st.id, { pace: 100, accuracy: 1, clean: true, bpm: 90, dyn: 1, at: T0 });
      else P.recordTake(p, st.id, { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 90, at: T0 });
    }
  }
  const last = program.stages[program.stages.length - 1];
  const cp = PLAN.checkpointSteps(last)[0];
  const before = SCN.pathState(p, program, folders, env);
  P.recordTake(p, cp.id, { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 90, at: T0 });
  const change = SCN.changes(before, SCN.pathState(p, program, folders, env));
  return SCN.pathScenes({ progress: p, program, folders, step: cp, next: null, change, env });
}

const summary = { name: 'Rock backbeat', status: 'LEARNED', clean: true, speed: 100, accuracy: 1, series: null,
  footer: 'ANY KEY skip' };
const lastMs = (sc) => (sc.kind === 'walk' ? 2000 : SCN.sceneMs(sc));

test('every scene draws, from its first frame to its last, with the hint line kept', () => {
  const plan = finalePlan().concat([{ kind: 'star', under: 'summary' }]);
  assert.deepEqual(plan.map((s) => s.kind), ['celebrate', 'banner', 'zoom', 'banner', 'finale', 'star']);
  plan.forEach((sc, i) => {
    const args = SV.sceneArgs(sc, { seed: i + 1, big: '100' });
    const walk = SV.sceneWalk(sc, 0);
    for (const ms of [0, lastMs(sc) / 2, lastMs(sc)]) {
      const c = createScreen();
      let calls = 0;
      for (const k of ['fillRect', 'text', 'line']) {
        const f = c[k].bind(c);
        c[k] = (...a) => { calls++; return f(...a); };
      }
      SV.drawScene(c, { scene: sc, args, walk, now: ms, ms, footer: 'ANY KEY skip', under: { summary } });
      assert.ok(countOn(c, 0, 10, 128, 44) > 0, `${sc.kind} at ${ms} drew nothing`);
      assert.ok(countOn(c, 0, 56, 128, 8) > 0, `${sc.kind} at ${ms} lost its hint line`);
      assert.ok(calls < 400, `${sc.kind} at ${ms}: ${calls} calls`);
    }
  });
});

test('a celebration raises the flag over the place not yet done, then the map without its route', () => {
  const [party] = finalePlan();
  const a = SV.sceneArgs(party, { seed: 1 });
  assert.equal(a.before[party.at].state, 'started');
  assert.equal(a.place.state, 'done');
  assert.notEqual(a.before, party.map.places, 'the map\'s own places are left alone');
  assert.equal(party.map.places[party.at].state, 'done');
});

test('the pads follow the scene: a sweep as the flag rises, sparkles after, the map on a zoom', () => {
  const plan = finalePlan();
  const out = new Array(32);
  const [party, , out1] = plan;
  const walk = SV.sceneWalk(party, 0);
  SV.sceneLeds(out, { scene: party, walk, now: 0, ms: 300, seed: 1 });
  assert.ok(out.includes(SCENE_PALETTE.sweep) && out.every((c) => c === SCENE_PALETTE.sweep || c === SCENE_PALETTE.off));
  SV.sceneLeds(out, { scene: party, walk, now: 0, ms: 800, seed: 1 });
  assert.ok(out.includes(SCENE_PALETTE.sparkle));
  SV.sceneLeds(out, { scene: out1, walk: SV.sceneWalk(out1, 0), now: 0, ms: 100 });
  assert.ok(out.includes(MAP_PALETTE.done), 'the world\'s finished islands');
});
