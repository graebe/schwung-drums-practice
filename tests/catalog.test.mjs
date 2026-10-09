// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The drill tree, and how the list walks it.
 *
 * The list decides what somebody sees the first time they open the module —
 * the one decision most likely to be got wrong and least likely to be noticed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLDER, folder, lazyFolder, isFolder, chartNode, buildCatalog, drumsTree, rowsOf,
  navStart, navTop, navCurrent, navPush, navPop, navPath, navRestore, nodeAt,
} from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { DRILLS } from '../src/guess.mjs';
import { validateExercise } from '../src/exercise_io.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const tree = () => drumsTree({ entries, categories: manifest.categories, drills: DRILLS });
const labels = (n) => n.children.map((c) => c.label);
const child = (n, label) => n.children.find((c) => c.label === label);

function leavesOf(node, path = [], out = []) {
  node.children.forEach((c, i) => {
    if (isFolder(c)) leavesOf(c, path.concat(i), out);
    else out.push({ node: c, path: path.concat(i) });
  });
  return out;
}

test('the top of the list: Basics, the material, then what is ABOUT practising', () => {
  assert.deepEqual(labels(tree()), ['Basics', 'Grooves', 'Rudiments', 'Training', 'Quiz', 'Progress']);
});

test('grooves and rudiments are filed by family, in manifest order', () => {
  const t = tree();
  assert.deepEqual(labels(child(t, 'Grooves')).slice(0, 4), ['Rock & Pop', 'Funk & Soul', 'Latin & World', 'Jazz & Swing']);
  assert.deepEqual(labels(child(t, 'Rudiments')), ['Rolls', 'Diddles', 'Flams', 'Drags']);
});

test('every bundled drill is filed, and none lands in Other', () => {
  const t = tree();
  assert.equal(labels(t).indexOf('Other'), -1);
  let filed = 0;
  for (const g of ['Grooves', 'Rudiments']) for (const f of child(t, g).children) filed += f.children.length;
  assert.equal(filed, entries.length);
});

test('a groove opens its ladder; a rudiment arms straight away', () => {
  const rock = child(child(child(tree(), 'Grooves'), 'Rock & Pop'), 'Rock backbeat');
  assert.ok(isFolder(rock));
  assert.deepEqual(rock.children.map((c) => c.value), ['L1', 'L2', 'L3']);
  const para = child(child(child(tree(), 'Rudiments'), 'Diddles'), 'Single paradiddle');
  assert.equal(isFolder(para), false);
  assert.equal(para.kind, 'chart');
});

test('a drill with no category, or an unknown one, lands in Other', () => {
  const c = entries[0].chart;
  const t = buildCatalog({ charts: [{ chart: c, category: null }, { chart: c, category: 'nope' }],
    categories: manifest.categories });
  assert.deepEqual(labels(t), ['Other']);
  assert.equal(t.children[0].children.length, 2);
});

test('a category without a folder is a top-level folder of its own', () => {
  const t = buildCatalog({ charts: [{ chart: entries[0].chart, category: 'x' }],
    categories: [{ id: 'x', name: 'Mine', folder: null }] });
  assert.deepEqual(labels(t), ['Mine']);
});

test('Basics: the subdivisions, and random material drawn fresh each time', () => {
  let next = 1;
  const t = drumsTree({ entries, categories: manifest.categories, drills: DRILLS, newSeed: () => next++ });
  const basics = child(t, 'Basics');
  assert.deepEqual(labels(basics), ['Subdivisions', 'Random']);
  const random = child(basics, 'Random');
  const a = random.children[0].build();
  const b = random.children[0].build();
  assert.notDeepEqual(a.events, b.events, 'two openings drew the same notes');
  assert.equal(a.name, 'Reading 8ths');
});

test('Training and Quiz hold what the flat list used to', () => {
  const t = tree();
  assert.deepEqual(child(t, 'Training').children.map((c) => c.kind), ['ladder', 'clock']);
  assert.deepEqual(child(t, 'Quiz').children.map((c) => c.quiz), DRILLS);
});

test('every leaf can be acted on, and every chart leaf builds a valid chart', () => {
  for (const { node, path } of leavesOf(tree())) {
    assert.ok(node.label, `an unlabelled row at ${path}`);
    assert.ok(['chart', 'ladder', 'clock', 'progress', 'quiz'].includes(node.kind), node.kind);
    if (node.kind === 'chart') {
      const c = node.build();
      assert.ok(c, `${node.label} built nothing`);
      assert.ok(validateExercise(c).ok !== false, `${node.label} is not a valid chart`);
    }
  }
});

test('every row fits the list', () => {
  const walk = (n) => {
    for (const r of rowsOf(n)) {
      const w = (r.label.length + (r.value ? r.value.length + 1 : 0));
      assert.ok(w <= 21, `"${r.label}" is ${r.label.length} chars`);
    }
    for (const c of n.children) if (isFolder(c)) walk(c);
  };
  walk(tree());
});

/* A folder's name is the list's title once it is open, and the title bar fits
 * sixteen characters. A drill's name is the title of its ladder. */
test('every folder name fits the title bar it becomes', () => {
  const walk = (n) => {
    for (const c of n.children) {
      if (!isFolder(c)) continue;
      assert.ok(c.label.length <= 16, `"${c.label}" is ${c.label.length} chars`);
      walk(c);
    }
  };
  walk(tree());
});

test('an empty install still produces a usable list', () => {
  const t = drumsTree({ drills: DRILLS });
  assert.ok(labels(t).includes('Progress'));
  assert.ok(labels(t).includes('Basics'));
});

/* ---- Walking it ---------------------------------------------------------- */

const small = () => folder('Root', [
  folder('A', [{ label: 'a1', kind: 'chart', build: () => 'a1' }, folder('A2', [{ label: 'deep' }])]),
  { label: 'leaf', kind: 'chart', build: () => 'leaf' },
]);

test('push opens a folder and refuses a leaf; pop stops at the top', () => {
  const nav = navStart(small());
  assert.equal(navPush(nav), true);
  assert.equal(navTop(nav).node.label, 'A');
  assert.equal(navPush(nav), false);
  assert.equal(navPop(nav), true);
  assert.equal(navPop(nav), false);
});

test('a rebuilt tree is walked back to the same place, and a shrunk one clamps', () => {
  const nav = navStart(small());
  navPush(nav);
  navTop(nav).cursor = 1;
  navPush(nav);
  const back = navRestore(small(), navPath(nav));
  assert.deepEqual(back.map((f) => f.node.label), ['Root', 'A', 'A2']);
  assert.equal(navCurrent(back).label, 'deep');
  assert.equal(navTop(navRestore(small(), [9, 9])).cursor, 1);
  assert.equal(nodeAt(small(), [0, 0]).build(), 'a1');
  assert.equal(nodeAt(small(), [5]), null);
});

test('a lazy folder is built once, and is a folder before that', () => {
  let made = 0;
  const n = lazyFolder('L', () => { made++; return [{ label: 'x' }]; });
  assert.equal(isFolder(n), true);
  assert.equal(made, 0);
  assert.equal(n.children.length, 1);
  assert.equal(n.children.length, 1);
  assert.equal(made, 1);
  assert.equal(n.value, FOLDER);
  assert.ok(chartNode(entries[0].chart));
});
