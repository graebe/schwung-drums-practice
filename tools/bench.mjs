/*
 * bench.mjs — what a frame costs. Not shipped.
 *
 * Run with `node --expose-gc tools/bench.mjs`. The numbers are only
 * meaningful relative to each other and to the history: the pitched module
 * records killing a 34,000-allocations-per-second path as a real problem, and
 * this module's reading view runs at about 3% of that.
 *
 * The committed guard is tests/perf.test.mjs, which asserts the INVARIANT —
 * a draw reads, it does not compute. This file is for when you want to know
 * how much, rather than whether.
 */
import { readFileSync } from 'node:fs';
import { createScreen } from './screen_buffer.mjs';
import { parseExercise } from '../src/exercise_io.mjs';
import { createRun, ensureEntries } from '../src/scoring.mjs';
import { drawReadingView } from '../src/view.mjs';
import { lanes } from '../src/grid_render.mjs';
import { voicesInChart } from '../src/kit.mjs';
import { settingsRows, loadSettings } from '../src/settings_def.mjs';
import { playabilityWarnings } from '../src/exercise_io.mjs';

const chart = parseExercise(
  readFileSync(new URL('../src/exercises/sixteenth-funk.json', import.meta.url), 'utf8'), 'x').chart;
const run = createRun(chart, { repeats: 0 });
ensureEntries(run, 64);
const ctx = createScreen();
const precomputed = lanes(voicesInChart(chart));
const { settings } = loadSettings(null);

function bench(label, fn, n = 20000) {
  for (let i = 0; i < 2000; i++) fn(i);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const t1 = process.hrtime.bigint();
  console.log('  ' + label.padEnd(34) + (Number(t1 - t0) / 1000 / n).toFixed(2).padStart(7) + ' us');
}

console.log('the draw, per frame:');
for (const view of ['grid', 'staff']) {
  bench(`reading view (${view})`, (i) => drawReadingView(ctx, {
    run, chart, songBeats: (i % 200) * 0.05, pxPerBeat: 32, view, lanes: precomputed,
    title: chart.name, bpm: chart.bpm, dynamics: true, timing: run.timing,
  }));
}
console.log('\nmoved OFF the draw and onto their change events:');
bench('settingsRows  (was every frame)', () => settingsRows(settings));
bench('playability   (was every frame)', () => playabilityWarnings(chart));
