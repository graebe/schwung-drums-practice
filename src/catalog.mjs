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
 * The top of the list is the same in Drums Practice and Piano Practice, so a
 * student who knows one knows the other:
 *
 *   Continue    the one button: the next step, or a review that is due
 *   Path        the seven stages, then Review (program.mjs)
 *   Practice    the free library: Subdivisions, Grooves › styles,
 *               Rudiments › families, Random, and Other when there is any
 *   Quiz        the five drills
 *   Progress
 *   Settings    Path, Practice, Sound, Pads, MIDI, Help
 *
 * Other is where a drill listed in user.json lands unless it names one of the
 * shipped categories — it must be somewhere in the list.
 */

import { CLOCK_ID, quizItemId } from './ids.mjs';
import { GROUPS } from './settings_def.mjs';
import { PRACTICE_DRUMS } from './home/icons.mjs';
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
 * A drill is one row. A groove with a ladder of rungs — L0 to L4 — is one
 * row too, its rungs chosen on the ready screen with the jog: the level page
 * it used to open was a menu level nobody needed. Each rung keeps the item id
 * its takes are filed under (`rock-backbeat:l2`); `levels` lists them, and
 * `build(id)` makes the one asked for. A drill with a single rung — a
 * rudiment, which is all snare — arms straight away as before.
 */
export function chartNode(chart) {
  const levels = availableLevels(chart);
  if (levels.length > 1) {
    const rungs = levels.map((lv) => ({ id: `${chart.id}:${lv.id}`, step: lv.step, label: lv.label,
      untimed: Boolean(lv.untimed) }));
    return {
      label: chart.name,
      value: '',
      kind: 'chart',
      levels: rungs,
      levelIds: rungs.map((r) => r.id),
      build: (id) => {
        const lv = levels[Math.max(0, rungs.findIndex((r) => r.id === id))];
        return projectLevel(chart, lv.id);
      },
    };
  }
  return { label: chart.name, value: '', kind: 'chart', id: chart.id, build: () => chart };
}

/*
 * The library's folders, by category.
 *   charts      [{ chart, category }] — parsed files, in manifest order
 *   categories  [{ id, name, folder }] — display order; `folder` groups them
 * Returns { folders } in manifest order, and { other }: the folder of what
 * lands nowhere else, or null.
 */
export function libraryFolders({ charts = [], categories = [] } = {}) {
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
   * without is a folder of its own. Groups keep the order of their first
   * category, so the manifest decides the list.
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
  return {
    folders: groups.map((g) => (g.lazy ? lazyFolder(g.label, g.lazy) : folder(g.label, g.rows))),
    other: other.length ? lazyFolder('Other', nodesOf(other)) : null,
  };
}

/*
 * Settings, as a folder of groups: the path's choices (program.mjs
 * pathSettingsFolder), a row per group of the settings editor — opening one
 * shows the editor with that group's rows — and Help.
 */
export function settingsFolder(pathPrefs = null) {
  return {
    label: 'Settings',
    value: FOLDER,
    untracked: true,
    children: [
      ...(pathPrefs ? [pathPrefs] : []),
      ...GROUPS.map((g) => ({ label: g.label, value: FOLDER, settingsGroup: g.key })),
      { label: 'Help', value: FOLDER, untracked: true, children: [
        { label: 'Show tips again', value: '', helpAction: 'tips' },
        { label: 'Welcome again', value: '', helpAction: 'welcome' },
      ] },
    ],
  };
}

/*
 * The module's own tree. Kept here rather than in ui.js so the tests can walk
 * the real one.
 *   drills     guess.mjs's DRILLS
 *   newSeed    a source of fresh seeds; without one every build uses seed 1,
 *              which keeps the tests deterministic
 *   path       the Path folder (program.mjs programFolder), when there is one
 *   pathPrefs  Settings › Path (program.mjs pathSettingsFolder)
 *
 * The Ladder and the Clock are no rows of their own: they wrap a drill, so
 * they are offered on the drill's row, in its action sheet. The Clock still
 * files its takes under CLOCK_ID, whichever drill it wraps.
 */
export function drumsTree({ entries = [], categories = [], bpm = 90, drills = [], newSeed = null, path = null,
  pathPrefs = null } = {}) {
  const o = { bpm };
  const seed = () => (newSeed ? newSeed() : 1);
  const leaf = (c) => ({ label: c.name, value: '', kind: 'chart', id: c.family, build: () => c });
  const lib = libraryFolders({ charts: entries, categories });
  const practice = folder('Practice', [
    folder('Subdivisions', subdivisionDrills(o).map(leaf)),
    ...lib.folders,
    folder('Random', RANDOM_DRILLS.map((d) => ({
      label: d.name, value: '', kind: 'chart', id: d.family,
      build: () => ({ ...d.make({ ...o, seed: seed() }), name: d.name }),
    }))),
    ...(lib.other ? [lib.other] : []),
  ]);
  /* The top is the home screen (src/home, vendored from Piano Practice): a
   * circle per section, each with its icon. Continue is no row of it: it is
   * Play on the Path's map, and the Path list's first row. */
  const quiz = folder('Quiz', drills.map((d) => ({
    label: d.name, value: '?', kind: 'quiz', quiz: d, id: quizItemId(d.mode, d.kind),
  })));
  const settings = settingsFolder(pathPrefs);
  if (path) path.icon = 'path';
  practice.icon = PRACTICE_DRUMS;
  quiz.icon = 'quiz';
  settings.icon = 'settings';
  const root = folder('Drums', [
    ...(path ? [path] : []),
    practice,
    quiz,
    { label: 'Progress', value: '', kind: 'progress', icon: 'progress' },
    settings,
  ]);
  root.view = 'home';
  return root;
}

export { CLOCK_ID };

/*
 * Every leaf that opens something, by item id — so a step of the Path or a
 * review can open the row it points at. Walks the whole tree
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
    if (node && node.levelIds && node.kind) {
      for (const id of node.levelIds) if (!index.has(id)) index.set(id, node);
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
