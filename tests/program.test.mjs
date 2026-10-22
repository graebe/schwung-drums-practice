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
import { builtins, RANDOM_DRILLS } from '../src/generator.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
/* What ui.js says is installed beside the files: the generated drills and the Clock. */
const generated = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), CLOCK_ID]);
const build = (extra = {}) => PLAN.buildProgram({
  entries, categories: manifest.categories, has: (id) => generated.has(id), ...extra,
});
const T0 = Date.UTC(2026, 9, 1, 12);
const take = (p, id, speed = 100, at = T0, o = {}) =>
  P.recordTake(p, id, { speed, accuracy: 1, sd: 10, clean: true, bpm: 90, at, ...o });
/* Meet the pads walked: Continue's first offer out of the way. */
const walked = (p = P.emptyProgress()) => { P.recordTour(p, 'tour:pads', T0); return p; };
const all = (prog, part = 'core') => prog.stages.flatMap((s) =>
  (part === 'core' ? PLAN.coreSteps(s) : PLAN.electiveSteps(s)).map((st) => ({ ...st, stageIndex: s.index })));
const RUDIMENTS = manifest.entries.filter((e) => ['rolls', 'diddles', 'flams', 'drags'].includes(e.category));
const GROOVES = manifest.entries.filter((e) => !['rolls', 'diddles', 'flams', 'drags'].includes(e.category));

test('seven stages, four tracks in the order a first session walks them', () => {
  const prog = build();
  assert.equal(prog.stages.length, 7);
  assert.deepEqual(prog.tracks.map((t) => t.key), ['time', 'hands', 'grooves', 'ear']);
  for (const s of prog.stages) assert.ok(s.checkpoint, `stage ${s.index} has no checkpoint installed`);
});

test('every one of the forty rudiments and every groove is on the path', () => {
  const prog = build();
  const ids = new Set([...all(prog), ...all(prog, 'elective')].map((st) => st.id.replace(/:l[0-4]$/, '')));
  assert.equal(RUDIMENTS.length, 40);
  for (const e of RUDIMENTS.concat(GROOVES)) assert.ok(ids.has(e.id), `${e.id} is not on the path`);
});

test('a drill is never asked before the stage that teaches what it is made of', () => {
  /* The old path asked for sixteenth-note single strokes before an eighth
   * note, and triplet rudiments long before triplets. */
  const at = (id) => Math.min(...all(build()).filter((st) => st.id === id).map((st) => st.stageIndex));
  const triplets = at('subdiv:triplets');
  for (const id of ['single-stroke-four', 'single-stroke-seven', 'triple-stroke-roll', 'flam-accent',
    'swiss-army-triplet', 'paradiddle-diddle', 'double-paradiddle', 'shuffle:l1', 'jazz-ride:l1']) {
    assert.ok(at(id) >= triplets, `${id} comes before triplets`);
  }
  const sixteenths = at('subdiv:sixteenths');
  for (const id of ['single-stroke-roll', 'single-paradiddle', 'sixteenth-funk:l1', 'house:l1']) {
    assert.ok(at(id) >= sixteenths, `${id} comes before sixteenths`);
  }
  assert.ok(at('subdiv:eighths') > at('subdiv:quarters'));
  assert.equal(at('first-beat:l0'), 0, 'the first beat is in the first stage');
});

test('a drill new to the path arrives slow and comes back faster', () => {
  const singles = all(build()).filter((st) => st.id === 'single-stroke-roll');
  assert.deepEqual(singles.map((st) => [st.stageIndex, st.target]), [[2, 75], [3, 100], [5, 120]]);
  for (const st of all(build())) {
    assert.ok(st.target <= PLAN.MAX_TARGET, `${st.id} asks more than Speed can be set to`);
  }
});

test('a groove the table does not name joins the last stage, as an elective', () => {
  const mine = { chart: { ...entries[2].chart, id: 'mine', name: 'Mine' }, category: 'rock' };
  const prog = PLAN.buildProgram({ entries: entries.concat([mine]), categories: manifest.categories });
  const last = prog.stages[prog.stages.length - 1];
  assert.ok(PLAN.electiveSteps(last).some((st) => st.id === 'mine:l0'));
});

test('a step whose drill is not installed is left out; an alternative stands in', () => {
  const prog = build();
  const ids = all(prog).map((st) => st.id);
  assert.ok(!ids.includes('read:1'), 'read:1 is not written yet');
  /* Stage 1's Clock with one bar off is not written yet: the Clock stands in. */
  const clock = all(prog).find((st) => st.id === CLOCK_ID);
  assert.equal(clock.stageIndex, 1);
  assert.equal(clock.wrap, 'subdiv:quarters');
  /* Stage 1's checkpoint, a phrase, is not written yet: the backbeat stands in. */
  assert.equal(PLAN.checkpointSteps(prog.stages[1])[0].id, 'rock-backbeat:l3', 'its top rung');
});

test('every step opens a row of the real tree', () => {
  const tree = drumsTree({ entries, categories: manifest.categories, drills: DRILLS });
  const index = leafIndex(tree);
  for (const st of all(build()).concat(all(build(), 'elective'))) {
    if (st.quiz) {
      assert.equal(st.quiz.kind, st.id.split(':')[2], st.id);
      continue;
    }
    if (st.tour) {
      assert.ok(PLAN.TOURS[st.tour], st.id);
      continue;
    }
    assert.ok(index.get(st.wrap || st.id), `${st.id} opens nothing`);
  }
});

test('a pooled quiz is its own item: three drums are not the whole kit', () => {
  const steps = all(build()).filter((st) => st.quiz);
  const guess = steps.find((st) => st.quiz.mode === 'guess');
  assert.equal(guess.id, 'quiz:guess:voice:kit3');
  assert.deepEqual(guess.pool.voices, ['KK', 'SN', 'HH']);
  const subdivs = steps.filter((st) => st.quiz.kind === 'subdiv').map((st) => st.id);
  assert.deepEqual(subdivs, ['quiz:pick:subdiv:qe', 'quiz:pick:subdiv:qes', 'quiz:pick:subdiv']);
});

test('Meet the pads leads Hello, kit: Continue offers it before anything else', () => {
  const prog = build();
  const s0 = PLAN.coreSteps(prog.stages[0]);
  assert.deepEqual([s0[0].id, s0[0].label, s0[0].track, s0[0].lead], ['tour:pads', 'Meet the pads', 'ear', true]);
  assert.deepEqual(s0[0].cards, ['your-pads']);
  const p = P.emptyProgress();
  assert.equal(PLAN.continueStep(p, prog, T0).step.id, 'tour:pads', 'first, though Time has the tie');
  assert.ok(!PLAN.stepDone(p, s0[0]));
  P.recordTour(p, 'tour:pads', T0);
  assert.ok(PLAN.stepDone(p, s0[0]));
  assert.equal(PLAN.continueStep(p, prog, T0).step.id, 'subdiv:quarters', 'then the tracks take turns');
  assert.equal(PLAN.stepAfter(p, prog, s0[0], T0).id, 'quiz:guess:voice:kit3', 'on along the Ear track');
  const q = P.emptyProgress();
  P.skipItem(q, 'tour:pads', T0);
  assert.equal(PLAN.continueStep(q, prog, T0).step.id, 'subdiv:quarters', 'skipped, it leads no more');
  assert.equal(PLAN.coreSteps(prog.stages[1]).filter((st) => st.lead).length, 0, 'only the first stage has one');
});

test('Continue: the current stage only, the track left longest first', () => {
  const prog = build();
  const p = walked();
  const first = PLAN.continueStep(p, prog, T0);
  assert.equal(first.stage.index, 0);
  assert.equal(first.step.id, 'subdiv:quarters', 'Time first on a first session');
  assert.equal(first.step.target, 60);
  take(p, 'subdiv:quarters', 60, T0);
  assert.equal(PLAN.continueStep(p, prog, T0).step.id, 'first-beat:l0', 'then the track left longest');
});

test('a stage is through when its checkpoint is passed — testing out of it', () => {
  const prog = build();
  const p = P.emptyProgress();
  take(p, 'first-beat:l3', 100);
  assert.equal(PLAN.currentStage(p, prog).index, 1, 'the checkpoint closes stage 0');
  assert.ok(!PLAN.stepDone(p, PLAN.coreSteps(prog.stages[0]).find((st) => st.quiz)),
    'and ticks nothing it did not play');
});

test('a stage is through when its core is done or skipped', () => {
  const prog = build();
  const p = P.emptyProgress();
  for (const st of PLAN.coreSteps(prog.stages[0])) P.skipItem(p, st.id, T0);
  assert.equal(PLAN.currentStage(p, prog).index, 1);
});

test('the step target is the speed it asks; a higher rung or a ✓ carries it', () => {
  const prog = build();
  const p = P.emptyProgress();
  const rb = all(prog).filter((st) => st.id.startsWith('rock-backbeat:'));
  const l1 = rb.find((st) => st.id === 'rock-backbeat:l1');
  assert.equal(l1.target, 90);
  take(p, 'rock-backbeat:l1', 85);
  assert.ok(!PLAN.stepDone(p, l1), '85 is short of 90');
  take(p, 'rock-backbeat:l3', 90);
  assert.ok(PLAN.stepDone(p, l1), 'the top rung at 90 carries L1');
  assert.ok(PLAN.stepDone(p, rb.find((st) => st.id === 'rock-backbeat:l0')), 'and L0');
});

test('a dynamics target needs the dynamics as well as the speed', () => {
  const prog = build();
  const cp = PLAN.checkpointSteps(prog.stages[3])[0];
  assert.equal(cp.id, 'ghost-note-funk:l3');
  assert.equal(cp.dyn, 80);
  const p = P.emptyProgress();
  take(p, cp.id, 100, T0, { dyn: 60 });
  assert.ok(!PLAN.stepDone(p, cp), 'clean at tempo, but the ghosts were not there yet');
  take(p, cp.id, 100, T0 + 1000, { dyn: 85 });
  assert.ok(PLAN.stepDone(p, cp));
});

test('Your path: a track switched off leaves Continue, the short ladder drops L1-L3', () => {
  const prog = build();
  const p = walked();
  P.togglePath(p, 'tracks', 'time');
  assert.equal(PLAN.continueStep(p, prog, T0).step.track, 'grooves');
  P.togglePath(p, 'tracks', 'grooves');
  P.togglePath(p, 'tracks', 'ear');
  assert.equal(P.togglePath(p, 'tracks', 'hands'), false, 'the last track stays on');
  const p2 = P.emptyProgress();
  P.setPath(p2, 'rungs', 'short');
  const fb = PLAN.coreSteps(prog.stages[0], p2.path).filter((st) => st.id.startsWith('first-beat'));
  assert.deepEqual(fb.map((st) => st.id), ['first-beat:l0', 'first-beat:l3']);
});

test('Your path: a style switched off swaps a checkpoint for its alternative', () => {
  const prog = build();
  const p = P.emptyProgress();
  assert.equal(PLAN.checkpointSteps(prog.stages[4], p.path)[0].id, 'jazz-ride:l2');
  P.togglePath(p, 'styles', 'jazz');
  assert.equal(PLAN.checkpointSteps(prog.stages[4], p.path)[0].id, 'half-time-shuffle:l3');
});

test('Your path: a style switched off leaves the core, but never empties a stage', () => {
  const prog = build();
  const p = P.emptyProgress();
  P.togglePath(p, 'styles', 'jazz');
  const s4 = PLAN.coreSteps(prog.stages[4], p.path).map((st) => st.id);
  assert.ok(!s4.some((id) => id.startsWith('jazz-ride') || id.startsWith('two-beat')), 'jazz is still asked');
  assert.ok(s4.some((id) => id.startsWith('half-time-shuffle')), 'the shuffle (funk) stays');
  assert.ok(s4.includes('subdiv:triplets'), 'the time track is no style');
  for (const k of P.PATH_STYLES) if (p.path.styles[k]) P.togglePath(p, 'styles', k);
  for (const stage of prog.stages) {
    assert.ok(PLAN.coreSteps(stage, p.path).length > 0, `stage ${stage.index} is empty with no style on`);
  }
});

test('Your path: start at a later stage; earlier stages stay open, nothing is ticked', () => {
  const prog = build();
  const p = P.emptyProgress();
  P.setPath(p, 'start', 3);
  assert.equal(PLAN.currentStage(p, prog).index, 3);
  assert.equal(PLAN.continueStep(p, prog, T0).stage.index, 3);
  assert.ok(!PLAN.stageComplete(p, prog.stages[0]));
});

test('a parked step leaves Continue for a day, then comes back', () => {
  const prog = build();
  const p = walked();
  P.parkItem(p, 'subdiv:quarters', T0);
  assert.notEqual(PLAN.continueStep(p, prog, T0).step.id, 'subdiv:quarters');
  const later = T0 + (P.PARK_HOURS + 1) * 3600 * 1000;
  assert.equal(PLAN.continueStep(p, prog, later).step.id, 'subdiv:quarters');
});

test('stuck: suggest after three failed takes in a row, park after six', () => {
  const p = P.emptyProgress();
  for (let i = 0; i < 6; i++) {
    take(p, 'x', 100, T0 + i, { clean: false });
    assert.equal(PLAN.stuckLevel(P.failStreak(p, 'x')), i + 1 >= 6 ? 2 : i + 1 >= 3 ? 1 : 0);
  }
  take(p, 'x', 100, T0 + 9);
  assert.equal(P.failStreak(p, 'x'), 0, 'a clean take ends the streak');
});

test('on from a step: the next open one of its track in its stage, never itself', () => {
  const prog = build();
  const p = walked();
  const quarters = PLAN.continueStep(p, prog, T0).step;
  const next = PLAN.stepAfter(p, prog, quarters, T0);
  assert.notEqual(next.key, quarters.key);
  const fb0 = PLAN.coreSteps(prog.stages[0]).find((st) => st.id === 'first-beat:l0');
  assert.equal(PLAN.stepAfter(p, prog, fb0, T0).id, 'first-beat:l1', 'the next rung');
});

test('the Path: Continue, the stages, then Review only while something is due', () => {
  let due = [];
  const f = PLAN.programFolder(build(), () => due);
  const stages = ['Continue', '0 Hello, kit', '1 Eighth notes', '2 Sixteenths', '3 Ghosts & flams',
    '4 Triplets/swing', '5 Clave & world', '6 Pro'];
  assert.deepEqual(f.children.map((c) => c.label), stages, 'nothing due, no Review');
  assert.equal(f.children[0].continueRow, true, 'Continue lives in the Path now');
  due = [{ label: 'due', repId: 'x' }];
  assert.deepEqual(f.children.map((c) => c.label), stages.concat('Review'));
  assert.equal(f.children[8].children[0].repId, 'x', 'asked for each time');
});

test('a stage lists its places in teaching order, the checkpoint last, and no rows with a job', () => {
  const f = PLAN.programFolder(build());
  const s0 = f.children[1];
  assert.deepEqual(s0.children.map((c) => c.label),
    ['Lessons', 'Ear', 'Time', 'Grooves', 'Electives', 'Checkpoint'], 'Hello, kit has no Hands');
  assert.deepEqual(f.children[3].children.map((c) => c.label),
    ['Lessons', 'Ear', 'Time', 'Hands', 'Grooves', 'Electives', 'Checkpoint']);
  const cp = s0.children[s0.children.length - 1];
  assert.equal(cp.checkpoint, true);
  assert.equal(cp.step.id, 'first-beat:l3', 'the checkpoint is the stage\'s exam');
  /* Skip, Skip all here, Start here: all in the action sheet now. */
  const walk = (n) => {
    for (const c of n.children) {
      assert.ok(!/^Skip|^Start here|^Check:/.test(c.label), `"${c.label}" is a control row`);
      if (isFolder(c) && !c.review) {
        assert.ok(c.label.length <= 16, `folder "${c.label}" overflows its title`);
        walk(c);
      }
    }
  };
  walk(f);
});

test('Settings › Path: tracks, styles, rungs, the start and the intros', () => {
  const styles = manifest.categories.filter((c) => c.folder === 'Grooves');
  const f = PLAN.pathSettingsFolder(styles);
  assert.deepEqual(f.children.map((c) => c.label), ['Tracks', 'Styles', 'Rungs', 'Start at', 'Intros']);
  assert.equal(f.children[1].children.length, 6, 'one row a style');
  assert.equal(f.untracked, true, 'nothing to count in it');
});

test('every id the table names is installed or planned — a typo cannot vanish', () => {
  const quizzes = new Set(DRILLS.map((d) => `quiz:${d.mode}:${d.kind}`));
  const installed = (id) => entries.some((e) => e.chart.id === id) || generated.has(id);
  for (const spec of PLAN.STAGES) {
    for (const s of spec.core.concat(spec.electives, [spec.checkpoint])) {
      if (s.tour) {
        assert.ok(PLAN.TOURS[s.tour], `${spec.key}: no tour "${s.tour}"`);
        continue;
      }
      if (s.quiz) {
        const id = `quiz:${s.quiz.mode}:${s.quiz.kind}`;
        assert.ok(quizzes.has(id) || PLAN.PLANNED.has(id), `${spec.key}: ${id} is neither a quiz nor planned`);
        assert.ok(!(quizzes.has(id) && PLAN.PLANNED.has(id)), `${id} ships: take it off PLANNED`);
        continue;
      }
      for (const id of [s.groove || s.id].concat(s.alt || [])) {
        assert.ok(installed(id) || PLAN.PLANNED.has(id), `${spec.key}: ${id} is neither installed nor planned`);
        assert.ok(!(installed(id) && PLAN.PLANNED.has(id)), `${id} ships: take it off PLANNED`);
      }
    }
  }
});
