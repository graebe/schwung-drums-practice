/*
 * preview.mjs — render the real drawing code into a 128x64 buffer and print
 * it as ASCII. Not shipped.
 *
 * Every frame is a pure function of (run, songBeats, settings), so any
 * instant of any drill can be dumped and looked at without a Move. That is
 * also how the rendering tests work, and why they can assert on pixels.
 *
 *   npm run preview -- --list
 *   npm run preview -- --exercise single-paradiddle --beats 0.5
 *   npm run preview -- --exercise rock-backbeat --view grid --film 0,1,2,3
 *   npm run preview -- --screen summary
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createScreen, toAscii } from './screen_buffer.mjs';
import * as V from '../src/view.mjs';
import { createRun, ensureEntries, judgeHit, expireMissed } from '../src/scoring.mjs';
import { builtins } from '../src/generator.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { createLadder } from '../src/ladder.mjs';
import { DEFAULTS } from '../src/settings_def.mjs';

const exDir = new URL('../src/exercises/', import.meta.url);

function allDrills() {
  const out = builtins({ bpm: DEFAULTS.bpm }).slice();
  const man = parseManifest(readFileSync(new URL('index.json', exDir), 'utf8'));
  for (const e of man.entries) {
    const r = parseExercise(readFileSync(new URL(e.file, exDir), 'utf8'), e.id);
    if (r.chart) out.push(r.chart);
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const drills = allDrills();
if (arg('list', false)) {
  for (const d of drills) console.log(`${d.id}\t${d.name}`);
  process.exit(0);
}

const id = String(arg('exercise', 'single-paradiddle'));
const chart = drills.find((d) => d.id === id) || drills[0];
const view = String(arg('view', 'staff'));
const px = Number(arg('px', DEFAULTS.pxPerBeat));
const looping = !arg('once', false);
const screen = arg('screen', null);

/* Play everything behind the playhead, so the picture shows a drill in
 * progress rather than a wall of misses. */
function runAt(beats, { sloppy = false } = {}) {
  const run = createRun(chart, {
    looping, sticking: chart.sticking, strictness: DEFAULTS.strictness, dynamics: true,
  });
  ensureEntries(run, beats + 8);
  for (const e of run.entries) {
    if (e.beat >= beats) break;
    for (const n of e.notes) {
      const off = sloppy ? (Math.sin(e.beat * 7.3) * 0.04) : 0.004;
      judgeHit(run, {
        voice: n.voice,
        hand: sloppy && Math.sin(e.beat * 3.1) > 0.7
          ? (n.wantHand === 'R' ? 'L' : 'R') : n.wantHand,
        velocity: n.wantDyn === 'accent' ? (sloppy ? 60 : 115) : 95,
      }, e.beat + off);
    }
  }
  expireMissed(run, beats);
  return run;
}

function dump(label, ctx) {
  console.log(`--- ${label} ---`);
  console.log(toAscii(ctx, { ruler: Boolean(arg('ruler', false)) }));
  console.log();
}

if (screen) {
  const ctx = createScreen();
  const run = runAt(8, { sloppy: true });
  if (screen === 'summary') V.drawSummary(ctx, { run, tightMs: 30 });
  else if (screen === 'ladder') {
    V.drawLadder(ctx, { ladder: Object.assign(createLadder({ bpm: 112 }), { rungs: 6 }), barsDone: 2 });
  } else if (screen === 'ready') {
    V.drawReady(ctx, {
      chart, bpm: chart.bpm, looping, loopBars: chart.loopBars, title: 'READY',
      songBeats: 0, run, outLabel: 'kit',
    });
  } else if (screen === 'menu') {
    V.drawList(ctx, { title: 'DRUMS', items: drills.map((d) => d.name), selected: 3 });
  } else if (screen === 'progress') {
    const records = [90, 95, 100, 98, 105, 110, 108, 115].map((bpm, i) => ({
      bpm, sd: 24 - i * 2, t: i, d: 'x',
    }));
    V.drawProgress(ctx, {
      drillLabel: chart.name, records,
      summary: { best: 115, last: 115 },
    });
  } else {
    console.error(`unknown screen: ${screen}`);
    process.exit(1);
  }
  dump(`${screen} (${chart.name})`, ctx);
} else {
  const frames = String(arg('film', arg('beats', '0'))).split(',').map(Number);
  for (const beats of frames) {
    const ctx = createScreen();
    V.drawReadingView(ctx, {
      run: runAt(beats), chart, songBeats: beats, pxPerBeat: px, view,
      title: chart.name, bpm: chart.bpm, looping, dynamics: true,
      beatFlash: Math.abs(beats % 1) < 0.02,
    });
    dump(`${chart.name} @ beat ${beats} (${view})`, ctx);
  }
}
