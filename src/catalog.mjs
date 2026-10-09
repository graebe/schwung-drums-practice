// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * catalog.mjs — the drill tree, and how the list walks it. Pure.
 *
 * Ported from Piano Practice's catalog.mjs, which is where the shape was
 * worked out; adapted to what a drum list holds. A node is a FOLDER,
 * { label, value: '>', children }, or a LEAF that does something when opened:
 *
 *   { kind: 'chart', build }      arm the chart build() returns
 *   { kind: 'quiz', quiz }        one of guess.mjs's DRILLS
 *   { kind: 'ladder' | 'clock' }  wrap whatever is armed
 *   { kind: 'progress' }
 *
 * There is one list on screen and one way through it — a groove's levels are
 * just a folder whose children are its rungs, where they used to be a second
 * screen with its own state and its own Back rules.
 *
 *   Basics      generated: subdivisions, and random material drawn fresh
 *   Grooves     one folder per groove family in index.json, in its order
 *   Rudiments   one folder per rudiment family
 *   Other       drills whose category is missing or unknown, if there are any
 *   ...tail     what the caller appends: Training, Quiz, Progress
 *
 * Other is where a drill listed in user.json lands unless it names one of the
 * shipped categories — it must be somewhere in the list.
 */

import { availableLevels, projectLevel } from './levels.mjs';
import { subdivisionDrills, RANDOM_DRILLS } from './generator.mjs';

/* The value column of a row that opens something. */
export const FOLDER = '>';

export function folder(label, children) {
  return { label, value: FOLDER, children };
}

/* A folder whose rows are made the first time it is opened. */
export function lazyFolder(label, make) {
  let rows = null;
  return {
    label,
    value: FOLDER,
    get children() {
      if (!rows) rows = make();
      return rows;
    },
  };
}

/* Asked without opening it: `in` sees the getter without calling it. */
export function isFolder(node) {
  return Boolean(node && typeof node === 'object' && 'children' in node);
}

/*
 * A drill opens its ladder of rungs; one with a single rung — a rudiment,
 * which is all snare — arms straight away.
 */
export function chartNode(chart) {
  const levels = availableLevels(chart);
  if (levels.length > 1) {
    return folder(chart.name, levels.map((lv) => ({
      label: `${lv.step} ${lv.label}`,
      value: '',
      kind: 'chart',
      id: `${chart.id}:${lv.id}`,
      build: () => projectLevel(chart, lv.id),
    })));
  }
  return { label: chart.name, value: '', kind: 'chart', id: chart.id, build: () => chart };
}

/*
 * The whole tree.
 *   charts      [{ chart, category }] — parsed files, in manifest order
 *   categories  [{ id, name, folder }] — display order; `folder` groups them
 *   basics      a node for Basics, or null
 *   tail        nodes appended at the end
 */
export function buildCatalog({ charts = [], categories = [], basics = null, lead = [], tail = [] } = {}) {
  /*
   * Charts are only SORTED here; their nodes are made when their folder is
   * first opened. A groove's node projects all four of its levels to find
   * which differ, and doing that for every drill at startup — and again on
   * every rebuild — was the bulk of the time the list took to appear.
   */
  const byCat = {};
  for (let i = 0; i < categories.length; i++) byCat[categories[i].id] = [];
  const other = [];
  for (let i = 0; i < charts.length; i++) {
    const c = charts[i];
    (byCat[c.category] || other).push(c.chart);
  }
  const nodesOf = (list) => () => list.map(chartNode);
  /*
   * A category naming a `folder` nests under it (Grooves › Rock & Pop); one
   * without is a top-level folder of its own. Groups keep the order of their
   * first category, so the manifest decides the list.
   */
  const groups = [];
  const byGroup = {};
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const list = byCat[cat.id];
    if (!list.length) continue;
    if (!cat.folder) {
      groups.push({ label: cat.name, lazy: nodesOf(list) });
      continue;
    }
    if (!byGroup[cat.folder]) {
      byGroup[cat.folder] = { label: cat.folder, rows: [] };
      groups.push(byGroup[cat.folder]);
    }
    byGroup[cat.folder].rows.push(lazyFolder(cat.name, nodesOf(list)));
  }
  const children = (basics ? [basics] : []).concat(lead);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    children.push(g.lazy ? lazyFolder(g.label, g.lazy) : folder(g.label, g.rows));
  }
  if (other.length) children.push(lazyFolder('Other', nodesOf(other)));
  return folder('Drums', children.concat(tail));
}

/*
 * The module's own tree: Basics, the categories, then Training, Quiz and
 * Progress. Kept here rather than in ui.js so the tests can walk the real one.
 *   drills    guess.mjs's DRILLS
 *   newSeed   a source of fresh seeds; without one every build uses seed 1,
 *             which keeps the tests deterministic
 */
export function drumsTree({ entries = [], categories = [], bpm = 90, drills = [], newSeed = null, path = null } = {}) {
  const o = { bpm };
  const seed = () => (newSeed ? newSeed() : 1);
  const leaf = (c) => ({ label: c.name, value: '', kind: 'chart', id: c.family, build: () => c });
  const basics = folder('Basics', [
    folder('Subdivisions', subdivisionDrills(o).map(leaf)),
    folder('Random', RANDOM_DRILLS.map((d) => ({
      label: d.name, value: '', kind: 'chart', id: d.family,
      build: () => ({ ...d.make({ ...o, seed: seed() }), name: d.name }),
    }))),
  ]);
  const tail = [
    folder('Training', [
      { label: 'Ladder', value: '', kind: 'ladder' },
      /* The Clock is an item of its own: keeping time without the click is
       * the skill, whichever drill it wraps. */
      { label: 'Clock', value: '', kind: 'clock', id: CLOCK_ID },
    ]),
    folder('Quiz', drills.map((d) => ({
      label: d.name, value: '?', kind: 'quiz', quiz: d, id: `quiz:${d.mode}:${d.kind}`,
    }))),
    { label: 'Progress', value: '', kind: 'progress' },
  ];
  return buildCatalog({ charts: entries, categories, basics, lead: path ? [path] : [], tail });
}

export const CLOCK_ID = 'clock';

/*
 * Every leaf that opens something, by item id — so a step of the Learning
 * Path or a repetition can open the row it points at. Walks the whole tree
 * once, making the lazy folders, and leaves out folders that are only
 * pointers back into it (the path) or that change with the day.
 */
export function leafIndex(root) {
  const index = new Map();
  const walk = (node) => {
    if (isFolder(node)) {
      if (node.untracked || node.pointers) return;
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      return;
    }
    if (node && node.id && node.kind && !index.has(node.id)) index.set(node.id, node);
  };
  walk(root);
  return index;
}

/* ---- Walking the tree --------------------------------------------------- */

/*
 * The walk is a stack of { node, cursor }: the folders you are inside, and
 * where the highlight sits in each. Back pops; it never has to remember where
 * you came from because the stack already is that.
 */
export function navStart(root) {
  return [{ node: root, cursor: 0 }];
}

export function navTop(nav) {
  return nav[nav.length - 1];
}

export function navCurrent(nav) {
  const top = navTop(nav);
  return top.node.children[top.cursor] || null;
}

/* Into the highlighted folder. False when the highlight is not a folder. */
export function navPush(nav) {
  const node = navCurrent(nav);
  if (!isFolder(node)) return false;
  nav.push({ node, cursor: 0 });
  return true;
}

/* Up one folder. False at the top, where Back means leave. */
export function navPop(nav) {
  if (nav.length <= 1) return false;
  nav.pop();
  return true;
}
