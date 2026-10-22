// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * row_sheet.mjs — the action sheet: what can be done to a row besides opening
 * it. Pure.
 *
 * Shift + jog-click on a row of the list opens a small list of the actions
 * that apply to it, in the student's words. They used to be rows of their own
 * — "Skip next" and "Skip all here" at four levels, twenty-two rows in the
 * first stage alone — standing among the content they acted on. Now the list
 * holds only what there is to practise, and the sheet holds the rest.
 *
 * The labels are shared with Piano Practice word for word, so a student who
 * knows one module knows the other. Only what applies is offered, always in
 * this order, and Settings... always last.
 *
 * Each action is { label, act, ... } — what to do and what to do it to — and
 * ui.js does it: this module decides, it never changes the progress.
 */

import * as PLAN from './program.mjs';
import { isUntimedId } from './ids.mjs';

export const LABELS = Object.freeze({
  skip: 'I know this: skip',
  skipAll: 'I know it all: skip',
  unskip: 'Undo skip',
  start: 'Start the path here',
  testOut: 'Test out: checkpoint',
  lessons: 'Lessons',
  ladder: 'Practise: Ladder',
  clock: 'Practise: Clock',
  list: 'Show as list',
  map: 'Show as map',
  settings: 'Settings...',
});

const act = (kind, extra = {}) => ({ label: LABELS[kind], act: kind, ...extra });

/*
 * The leaf a row would arm, when the Ladder or the Clock can wrap it: a drill
 * with a tempo — a chart, never a quiz, never L0, which has no clock to climb
 * or to take away. A step the Clock already wraps is the Clock.
 *   leafOf(id)  the tree's leaf for an item id (catalog.mjs leafIndex)
 */
export function wrappableLeaf(row, leafOf) {
  let node = null;
  if (row.step) {
    if (row.step.quiz || row.step.wrap) return null;
    node = leafOf(row.step.id);
  } else if (row.repId) {
    node = leafOf(row.repId);
  } else if (row.kind === 'chart') {
    node = row;
  }
  if (!node || node.kind !== 'chart' || isUntimedId(node.id || '')) return null;
  return node;
}

/*
 * The actions for a row.
 *   env.progress   the store, for what is done and skipped
 *   env.pick       what Continue would open (path_rows.mjs continuePick)
 *   env.hasCards   (stage) => whether it has lesson cards to read
 *   env.leafOf     (id) => the tree's leaf, for the Ladder and the Clock
 *   env.view       'map' when the folder is shown as its map, 'list' when a
 *                  map folder is shown as a list; else absent
 */
export function sheetFor(row, env) {
  const { progress } = env;
  const out = [];
  if (!row) return viewActs(env).concat(act('settings'));
  const done = (st) => PLAN.stepDone(progress, st);
  const skipped = (st) => PLAN.stepSkipped(progress, st);

  if (row.continueRow) {
    /* The step Continue would open; a review is not skipped, it is due. */
    const pick = env.pick;
    if (pick && pick.kind === 'step') out.push(act('skip', { step: pick.step }));
  } else if (row.step && !row.checkpoint) {
    /* A checkpoint is passed, not skipped: Test out is how it is taken. */
    if (skipped(row.step)) out.push(act('unskip', { ids: [row.step.id] }));
    else if (!done(row.step)) out.push(act('skip', { step: row.step }));
  } else if (row.steps && 'children' in row) {
    /* A folder of the path: a stage, a track, a groove's rungs, electives. */
    const open = row.steps.filter((st) => !done(st) && !skipped(st));
    const back = row.steps.filter(skipped);
    if (open.length) out.push(act('skipAll', { ids: open.map((st) => st.id) }));
    if (back.length) out.push(act('unskip', { ids: back.map((st) => st.id) }));
  }

  if (row.stage && !row.lessonsRow) {
    out.push(act('start', { index: row.stage.index }));
    const cp = PLAN.checkpointSteps(row.stage, progress.path || {});
    if (cp.length) out.push(act('testOut', { step: cp[0] }));
    if (env.hasCards && env.hasCards(row.stage)) out.push(act('lessons', { stage: row.stage }));
  }

  const leaf = env.leafOf ? wrappableLeaf(row, env.leafOf) : null;
  if (leaf) out.push(act('ladder', { leaf }), act('clock', { leaf }));
  out.push(...viewActs(env), act('settings'));
  return out;
}

/* A map hides what is no place — the Path's Review — so its list is one
 * option away, for the session, and the map one option back. */
function viewActs(env) {
  if (env.view === 'map') return [act('list')];
  if (env.view === 'list') return [act('map')];
  return [];
}
