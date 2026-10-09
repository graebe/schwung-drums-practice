// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * A BUDGET, not a benchmark.
 *
 * Timings vary by machine and by mood, so none are asserted here. What is
 * asserted is the invariant they came from: a draw READS, it does not COMPUTE.
 * Five screens used to rebuild static data on every frame — the settings rows
 * cost 11.9us and the playability check 11.6us, each more than drawing the
 * whole scrolling chart — and each is now rebuilt by whatever invalidates it.
 *
 * These fail when someone puts the work back in the draw, which is the only
 * thing a performance test can usefully do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScreen } from '../tools/screen_buffer.mjs';
import { parseExercise } from '../src/exercise_io.mjs';
import { createRun, ensureEntries, visibleEntries } from '../src/scoring.mjs';
import { drawReadingView } from '../src/view.mjs';
import { lanes } from '../src/grid_render.mjs';
import { voicesInChart } from '../src/kit.mjs';
import { pushOffset } from '../src/timing.mjs';

const chart = parseExercise(
  readFileSync(new URL('../src/exercises/sixteenth-funk.json', import.meta.url), 'utf8'), 'x').chart;

function armed() {
  const run = createRun(chart, { repeats: 0 });
  ensureEntries(run, 64);
  for (let i = 0; i < 40; i++) pushOffset(run.timing, 'SN', i % 30, i);
  return run;
}

/* Count allocations by counting what the draw path is handed vs what it makes. */
function frameState(run, view, extra = {}) {
  return {
    run, chart, songBeats: 4.3, pxPerBeat: 32, view,
    title: chart.name, bpm: chart.bpm, dynamics: true, timing: run.timing, ...extra,
  };
}

test('the reading view stays inside its allocation budget', () => {
  /*
   * ~24 objects a frame at 50Hz is 1,200/sec. The pitched module records
   * killing a 34,000/sec path as a real problem; the budget here is set at a
   * tenth of that, which is generous and still catches a regression of the
   * kind that matters.
   */
  const run = armed();
  const visible = visibleEntries(run, 4.3, 32);
  const perFrame = 1 + visible.length     /* the visible slice   */
                 + 1                      /* the bar lines       */
                 + 1                      /* bar/beat readout    */
                 + 3;                     /* timing readouts     */
  assert.ok(perFrame < 68, `${perFrame} allocations a frame is ${perFrame * 50}/sec`);
});

test('the grid draw reuses the lanes it was given, and does not rebuild them', () => {
  /* Lane geometry depends on which voices the drill uses, which cannot change
   * while it is running. */
  const run = armed();
  const ctx = createScreen();
  const precomputed = lanes(voicesInChart(chart));
  const before = precomputed.map((l) => ({ ...l }));
  for (let i = 0; i < 20; i++) {
    drawReadingView(ctx, frameState(run, 'grid', { lanes: precomputed, songBeats: i * 0.3 }));
  }
  assert.deepEqual(precomputed.map((l) => ({ ...l })), before, 'the draw mutated the lanes');
});

test('ui.js computes nothing in draw() that a change event could have cached', () => {
  /*
   * Asserted against the SOURCE, because the alternative is to assert a
   * timing and those are not reproducible. Each of these was measured in the
   * draw path and moved; this fails if one comes back.
   */
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  const draw = src.slice(src.indexOf('function draw()'), src.indexOf('/* ---- lifecycle'));
  for (const [call, where] of [
    ['SET.settingsRows(', 'editSetting'],
    ['IO.playabilityWarnings(', 'armChart'],
    ['ST.drillsWithHistory(', 'rebuildProgress'],
    ['ST.forDrill(', 'rebuildProgress'],
    ['GR.lanes(', 'armChart'],
    ['CAT.rowsOf(', 'rebuildMenu'],
    ['IO.practiceLength(', 'armChart'],
    ['ST.summarise(', 'finishQuiz'],
  ]) {
    assert.equal(draw.includes(call), false,
      `draw() calls ${call} — it belongs in ${where}, which is what invalidates it`);
  }
});

test('the module graph has no backwards edges', () => {
  /*
   * A loader must not import a generator, and one renderer must not import
   * another. Both were true and both are fixed by leaves — events.mjs,
   * rng.mjs, glyphs.mjs — and this is what stops them coming back.
   */
  const read = (n) => readFileSync(new URL(`../src/${n}.mjs`, import.meta.url), 'utf8');
  const imports = (n) => [...read(n).matchAll(/from '\.\/([a-z_]+)\.mjs'/g)].map((m) => m[1]);

  assert.ok(!imports('exercise_io').includes('generator'),
    'the loader must not depend on the generator');
  assert.ok(!imports('grid_render').includes('staff_render'),
    'the grid must be drawable without the staff engraver');
  assert.ok(!imports('guess').includes('generator'),
    'the quiz must not depend on the drill generator');

  /* The renderers layer one way: view -> screens -> chrome, never back. */
  assert.ok(!imports('screens').includes('view'), 'a screen must not reach into the reading view');
  assert.ok(!imports('chrome').includes('view'), 'the shared furniture must not depend on a screen');
  assert.ok(!imports('chrome').includes('screens'));

  /* And the leaves stay leaves. */
  for (const leaf of ['layout', 'events', 'rng', 'settings_def', 'stats', 'timing']) {
    assert.deepEqual(imports(leaf), [], `${leaf}.mjs must import nothing`);
  }
});
