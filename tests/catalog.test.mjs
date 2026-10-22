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
  FOLDER, folder, lazyFolder, isFolder, chartNode, libraryFolders, settingsFolder, drumsTree, CLOCK_ID,
  navStart, navTop, navCurrent, navPush, navPop,
} from '../src/catalog.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { DRILLS } from '../src/guess.mjs';
import { validateExercise } from '../src/exercise_io.mjs';

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const manifest = parseManifest(read('index.json'));
const entries = manifest.entries.map((e) => ({ chart: parseExercise(read(e.file), e.id).chart, category: e.category }));
const tree = () => drumsTree({ entries, categories: manifest.categories, drills: DRILLS,
  path: folder('Path', []) });
const practice = () => tree().children.find((c) => c.label === 'Practice');
const labels = (n) => n.children.map((c) => c.label);
const child = (n, label) => n.children.find((c) => c.label === label);

function leavesOf(node, path = [], out = []) {
  node.children.forEach((c, i) => {
    if (isFolder(c)) leavesOf(c, path.concat(i), out);
    else out.push({ node: c, path: path.concat(i) });
  });
  return out;
}

test('the top of the list is the one both practice modules share', () => {
  assert.deepEqual(labels(tree()), ['Continue', 'Path', 'Practice', 'Quiz', 'Progress', 'Settings']);
  assert.equal(tree().children[0].continueRow, true);
});

test('Practice is the free library: subdivisions, grooves, rudiments, random', () => {
  assert.deepEqual(labels(practice()), ['Subdivisions', 'Grooves', 'Rudiments', 'Random']);
});

test('grooves and rudiments are filed by family, in manifest order', () => {
  const p = practice();
  assert.deepEqual(labels(child(p, 'Grooves')).slice(0, 4), ['Rock & Pop', 'Funk & Soul', 'Latin & World', 'Jazz & Swing']);
  assert.deepEqual(labels(child(p, 'Rudiments')), ['Rolls', 'Diddles', 'Flams', 'Drags']);
});

test('every bundled drill is filed, and none lands in Other', () => {
  const p = practice();
  assert.equal(labels(p).indexOf('Other'), -1);
  let filed = 0;
  for (const g of ['Grooves', 'Rudiments']) for (const f of child(p, g).children) filed += f.children.length;
  assert.equal(filed, entries.length);
});

test('a groove opens its ladder; a rudiment arms straight away', () => {
  const rock = child(child(child(practice(), 'Grooves'), 'Rock & Pop'), 'Rock backbeat');
  assert.ok(isFolder(rock));
  assert.deepEqual(rock.children.map((c) => c.label.slice(0, 2)), ['L0', 'L1', 'L2', 'L3']);
  /* Each rung is an item of its own, under the id its takes are filed by. */
  assert.deepEqual(rock.children.map((c) => c.id),
    ['rock-backbeat:l0', 'rock-backbeat:l1', 'rock-backbeat:l2', 'rock-backbeat:l3']);
  assert.equal(rock.children[1].build().id, rock.children[1].id);
  assert.equal(rock.children[0].build().untimed, true, 'L0 arms the untimed mode');
  const para = child(child(child(practice(), 'Rudiments'), 'Diddles'), 'Single paradiddle');
  assert.equal(isFolder(para), false);
  assert.equal(para.kind, 'chart');
});

test('a drill with no category, or an unknown one, lands in Other, after Random', () => {
  const c = entries[0].chart;
  const lib = libraryFolders({ charts: [{ chart: c, category: null }, { chart: c, category: 'nope' }],
    categories: manifest.categories });
  assert.deepEqual(lib.folders, []);
  assert.equal(lib.other.children.length, 2);
  const t = drumsTree({ entries: [{ chart: c, category: 'nope' }], categories: manifest.categories, drills: DRILLS });
  assert.deepEqual(labels(child(t, 'Practice')), ['Subdivisions', 'Random', 'Other']);
});

test('a category without a folder is a library folder of its own', () => {
  const lib = libraryFolders({ charts: [{ chart: entries[0].chart, category: 'x' }],
    categories: [{ id: 'x', name: 'Mine', folder: null }] });
  assert.deepEqual(lib.folders.map((f) => f.label), ['Mine']);
  assert.equal(lib.other, null);
});

test('Random draws fresh material each time it is opened', () => {
  let next = 1;
  const t = drumsTree({ entries, categories: manifest.categories, drills: DRILLS, newSeed: () => next++ });
  const random = child(child(t, 'Practice'), 'Random');
  const a = random.children[0].build();
  const b = random.children[0].build();
  assert.notDeepEqual(a.events, b.events, 'two openings drew the same notes');
  assert.equal(a.name, 'Reading 8ths');
});

test('Quiz holds the five drills; the Ladder and the Clock are no rows of their own', () => {
  const t = tree();
  assert.deepEqual(child(t, 'Quiz').children.map((c) => c.quiz), DRILLS);
  assert.equal(child(t, 'Training'), undefined);
  assert.equal(CLOCK_ID, 'clock', 'the Clock keeps the id its takes are filed under');
});

test('Settings is a folder of groups: the path, the editor\'s groups, and Help', () => {
  const prefs = folder('Path', []);
  const s = settingsFolder(prefs);
  assert.deepEqual(labels(s), ['Path', 'Practice', 'Sound', 'Pads', 'MIDI', 'Help']);
  assert.deepEqual(s.children.slice(1, 5).map((c) => c.settingsGroup), ['practice', 'sound', 'pads', 'midi']);
  assert.deepEqual(child(s, 'Help').children.map((c) => [c.label, c.helpAction]),
    [['Show tips again', 'tips'], ['Welcome again', 'welcome']]);
  assert.deepEqual(labels(settingsFolder()).slice(0, 1), ['Practice'], 'no path, no Path group');
});

test('every leaf can be acted on, and every chart leaf builds a valid chart', () => {
  for (const { node, path } of leavesOf(tree())) {
    assert.ok(node.label, `an unlabelled row at ${path}`);
    if (node.continueRow || node.settingsGroup || node.helpAction) continue;
    assert.ok(['chart', 'progress', 'quiz'].includes(node.kind), node.kind);
    if (node.kind === 'chart') {
      const c = node.build();
      assert.ok(c, `${node.label} built nothing`);
      assert.ok(validateExercise(c).ok !== false, `${node.label} is not a valid chart`);
    }
  }
});

test('every row fits the list', () => {
  const walk = (n) => {
    for (const r of n.children) {
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
  assert.ok(labels(t).includes('Practice'));
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
