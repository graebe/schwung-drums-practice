// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The Learning Path, against the drills the module really ships: a step that
 * points at nothing is a row that does nothing on the device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import { drumsTree, leafIndex, isFolder, CLOCK_ID } from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { DRILLS } from '../src/guess.mjs';
import { builtins } from '../src/generator.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const tracks = () => PLAN.buildProgram({ entries, categories: manifest.categories });
const T0 = Date.UTC(2026, 9, 1, 12);
const learn = (p, id, at = T0) =>
  P.recordTake(p, id, { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 90, at });

test('four tracks, in the order a first session walks them', () => {
  assert.deepEqual(tracks().map((t) => t.key), ['time', 'rudiments', 'grooves', 'ear']);
});

test('every one of the forty rudiments is on the path, once, in teaching order', () => {
  const rud = tracks().find((t) => t.key === 'rudiments');
  const ids = PLAN.trackSteps(rud).map((s) => s.id);
  const shipped = entries.filter((e) => ['rolls', 'diddles', 'flams', 'drags'].includes(e.category));
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, 40);
  assert.deepEqual([...ids].sort(), shipped.map((e) => e.chart.id).sort());
  assert.deepEqual(ids.slice(0, 3), ['single-stroke-roll', 'double-stroke-roll', 'single-paradiddle']);
});

test('every groove is on the path rung by rung, family by family', () => {
  const g = tracks().find((t) => t.key === 'grooves');
  const grooves = entries.filter((e) => PLAN.GROOVE_FAMILIES.includes(e.category));
  assert.equal(g.units.length, grooves.length);
  assert.equal(g.units[0].name, 'Rock backbeat');
  assert.deepEqual(g.units[0].steps.map((s) => s.id),
    ['rock-backbeat:l1', 'rock-backbeat:l2', 'rock-backbeat:l3']);
  assert.equal(g.units[0].steps[1].title, 'Rock backbeat L2');
  const families = [...new Set(g.units.map((u) => u.group))];
  assert.deepEqual(families, ['Rock & Pop', 'Funk & Soul', 'Latin & World', 'Jazz & Swing',
    'Electronic', 'Techno']);
});

test('a groove the order does not name joins the end of its family', () => {
  const mine = { ...entries[0].chart, id: 'mine', name: 'Mine' };
  const t = PLAN.buildProgram({ entries: [{ chart: mine, category: 'rock' }, entries[0]],
    categories: manifest.categories });
  const g = t.find((x) => x.key === 'grooves');
  assert.deepEqual(g.units.map((u) => u.name), ['Rock backbeat', 'Mine']);
});

test('every step opens a row of the real tree', () => {
  const tree = drumsTree({ entries, categories: manifest.categories, drills: DRILLS });
  const index = leafIndex(tree);
  for (const t of tracks()) {
    for (const s of PLAN.trackSteps(t)) {
      if (s.quiz) {
        assert.equal(index.get(s.id).kind, 'quiz', s.id);
        continue;
      }
      assert.ok(index.get(s.wrap || s.id), `${t.name}: ${s.id} opens nothing`);
    }
  }
  assert.equal(index.get(CLOCK_ID).kind, 'clock');
});

test('a step id is the id its takes are filed under', () => {
  /* A generated drill files under its family, a level under "<id>:l<n>". */
  for (const c of builtins({})) assert.ok(c.family, c.id);
  const time = tracks().find((t) => t.key === 'time');
  const fams = new Set(builtins({}).map((c) => c.family));
  for (const s of PLAN.trackSteps(time)) assert.ok(fams.has(s.wrap || s.id), s.id);
  for (const id of Object.keys(PLAN.BASIC_TARGETS)) {
    assert.ok(fams.has(id), `${id} has a target but no drill`);
    assert.ok(PLAN.targetBpm(id) >= 60);
  }
  assert.equal(PLAN.targetBpm('rock-backbeat'), 0, 'a file has its own tempo');
});

test('next: the first step neither learned nor skipped; a higher level carries the lower', () => {
  const p = P.emptyProgress();
  const g = tracks().find((t) => t.key === 'grooves');
  assert.equal(PLAN.nextStep(p, g).id, 'rock-backbeat:l1');
  learn(p, 'rock-backbeat:l3');
  assert.equal(PLAN.nextStep(p, g).id, 'straight-eights:l1');
  P.skipItem(p, 'straight-eights:l1');
  assert.equal(PLAN.nextStep(p, g).id, 'straight-eights:l2');
});

test('Continue walks the tracks in turn, the one left longest first', () => {
  const p = P.emptyProgress();
  const ts = tracks();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const c = PLAN.continueStep(p, ts);
    seen.push(c.track.key);
    P.recordTake(p, c.step.id, { speed: 60, accuracy: 1, sd: 10, clean: true, bpm: 60, at: T0 + i * 1000 });
  }
  assert.deepEqual(seen, ['time', 'rudiments', 'grooves', 'ear']);
  assert.equal(PLAN.continueStep(p, ts).track.key, 'time', 'and round again');
});

test('a learned track drops out of Continue; all learned is null', () => {
  const p = P.emptyProgress();
  const ts = tracks().slice(3);
  for (const s of PLAN.trackSteps(ts[0])) learn(p, s.id);
  assert.equal(PLAN.continueStep(p, ts), null);
  assert.equal(PLAN.nextStep(p, ts[0]), null);
});

test('on from a step: the next open one after it, wrapping, never itself', () => {
  const p = P.emptyProgress();
  const time = tracks().find((t) => t.key === 'time');
  assert.equal(PLAN.stepAfter(p, time, 'subdiv:quarters').id, 'subdiv:eighths');
  learn(p, 'subdiv:triplets');
  assert.equal(PLAN.stepAfter(p, time, 'subdiv:eighths').id, 'subdiv:sixteenths');
  assert.equal(PLAN.stepAfter(p, time, CLOCK_ID).id, 'subdiv:quarters', 'wraps to the top');
  const one = { units: [{ steps: [{ id: 'only' }] }] };
  assert.equal(PLAN.stepAfter(p, one, 'only'), null);
});

test('steps and tracks are found by id', () => {
  const ts = tracks();
  assert.equal(PLAN.trackOf(ts, 'flam-tap').key, 'rudiments');
  assert.equal(PLAN.trackOf(ts, 'nope'), null);
  assert.equal(PLAN.stepTitle(PLAN.findStep(ts, 'samba:l2')), 'Samba L2');
  assert.equal(PLAN.findStep(ts, 'nope'), null);
  assert.equal(PLAN.quizItemId(DRILLS[0]), 'quiz:guess:voice');
});

test('the folder: Continue, Skip, the tracks, Repetition — and every row fits', () => {
  const f = PLAN.programFolder(tracks(), () => [{ label: 'due', repId: 'x' }]);
  assert.deepEqual(f.children.map((c) => c.label),
    ['Continue', 'Skip next', 'Time', 'Rudiments', 'Grooves', 'Ear', 'Repetition']);
  assert.equal(f.children[6].children[0].repId, 'x', 'asked for each time');
  const grooves = f.children[4];
  assert.equal(grooves.children[0].label, 'Rock & Pop', 'grooves are grouped by family');
  const walk = (n) => {
    for (const c of n.children) {
      assert.ok(c.label.length <= 21, `"${c.label}" is ${c.label.length} chars`);
      if (isFolder(c) && !c.untracked) {
        assert.ok(c.label.length <= 16, `folder "${c.label}" overflows its title`);
        walk(c);
      }
    }
  };
  walk(f);
});
