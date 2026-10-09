// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * ui_coverage.mjs — line coverage of ui.js across the whole test suite.
 *
 * ui.js keeps its state at module level, so every smoke test loads its own
 * instance of it. Node's coverage report credits only one of those instances,
 * which makes most of the file look untested when the suite does drive it.
 * This runs the JS tests with V8's raw coverage on and takes the union over
 * every instance of the staged ui.js: a line counts as covered if any test
 * ran it.
 *
 *   npm run coverage:ui            human-readable summary
 *   npm run coverage:ui -- --json  the same as JSON, for a machine
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'drums-v8cov-'));
const tests = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('tests', f));
const run = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root, env: { ...process.env, NODE_V8_COVERAGE: dir }, encoding: 'utf8',
});
if (run.status !== 0) {
  process.stderr.write(run.stdout.slice(-2000));
  process.exit(run.status || 1);
}

/* Every instance of the staged ui.js, by its source. */
let source = null;
const instances = [];
for (const f of readdirSync(dir)) {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const script of data.result) {
    if (!/drums-ui-[^/]*\/ui\.js/.test(script.url)) continue;
    instances.push(script.functions);
    if (!source) {
      const path = fileURLToPath(script.url.split('?')[0]);
      try { source = readFileSync(path, 'utf8'); } catch (e) { /* removed with its temp dir */ }
    }
  }
}
rmSync(dir, { recursive: true, force: true });
if (!source) source = readFileSync(join(root, 'src', 'ui.js'), 'utf8');

/* Per character: run by any instance? V8 reports nested ranges, the
 * innermost deciding, so each instance is painted outer to inner. */
const ran = new Uint8Array(source.length);
for (const functions of instances) {
  const own = new Int8Array(source.length).fill(-1);
  const ranges = [];
  for (const fn of functions) for (const r of fn.ranges) ranges.push(r);
  ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) {
    const v = r.count > 0 ? 1 : 0;
    for (let i = r.startOffset; i < Math.min(r.endOffset, source.length); i++) own[i] = v;
  }
  for (let i = 0; i < source.length; i++) if (own[i] === 1) ran[i] = 1;
}

/* Lines with code on them: not blank, not only a comment. */
const lines = source.split('\n');
let offset = 0;
let inComment = false;
let total = 0;
let covered = 0;
const missed = [];
for (let n = 0; n < lines.length; n++) {
  const text = lines[n];
  let code = false;
  let hit = false;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (inComment) {
      if (two === '*/') { inComment = false; i++; }
      continue;
    }
    if (two === '/*') { inComment = true; i++; continue; }
    if (two === '//') break;
    if (/\s/.test(text[i])) continue;
    code = true;
    if (ran[offset + i]) hit = true;
  }
  if (code) {
    total++;
    if (hit) covered++;
    else missed.push(n + 1);
  }
  offset += text.length + 1;
}

/* Missed lines as ranges, for reading. */
const spans = [];
for (const n of missed) {
  const last = spans[spans.length - 1];
  if (last && n === last[1] + 1) last[1] = n;
  else spans.push([n, n]);
}
const pct = total ? (100 * covered) / total : 0;
const report = {
  file: 'src/ui.js', instances: instances.length, lines: total, covered,
  percent: Math.round(pct * 10) / 10,
  uncovered: spans.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)),
};
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(`ui.js: ${report.percent}% of ${total} code lines, over ${instances.length} instances\n`);
  process.stdout.write(`uncovered: ${report.uncovered.join(' ')}\n`);
}
