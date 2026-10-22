// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * map_places.mjs — the Path as places on the map (src/pathmap, vendored from
 * Piano Practice): one island per stage on the world map, and on a stage's
 * island one place per row of its folder — the Lessons hut, a place for each
 * track, the Electives cove and the Checkpoint fort. Pure: it reads the
 * program and the progress, and hands the engine its places and, for each,
 * the child of the folder entering it opens.
 *
 * States, from the learner's side (nothing is locked: every place opens):
 *   done      finished: a stage through, a track all done, the checkpoint passed
 *   skipped   assumed known: a stage before the start, a track all skipped
 *   current   where Continue is taking you
 *   started   something in it played
 *   ahead     a stage after the current one, and the places on its island
 *   fresh     nothing played, nothing before it missing
 */

import * as PLAN from './program.mjs';
import { item, repetitionSession } from './progress.mjs';
import { makePlace } from './pathmap/model.mjs';

/* The items of today's review session still to do. */
export function dueIdsOf(progress, atMs) {
  const out = new Set();
  for (const r of repetitionSession(progress, atMs)) if (!r.done) out.add(r.id);
  return out;
}

const percentOf = (sum) => (sum.count ? Math.round((sum.done * 100) / sum.count) : 0);

function countIn(steps, ids) {
  let n = 0;
  const seen = new Set();
  for (const st of steps) {
    if (ids.has(st.id) && !seen.has(st.id)) n++;
    seen.add(st.id);
  }
  return n;
}

/* Every step a stage holds, as its folder lists them: core, electives, checkpoint. */
function stageSteps(stage) {
  return PLAN.coreSteps(stage, {}).concat(PLAN.electiveSteps(stage, {}), PLAN.checkpointSteps(stage, {}));
}

const played = (progress, steps) => steps.some((st) => {
  const it = item(progress, st.id);
  return Boolean(it && it.plays);
});

/*
 * The world map: an island per stage. `targets[i]` is the child of the Path
 * folder the island opens — the stages come first there, so it is i.
 */
export function worldPlaces(progress, program, { dueIds = new Set() } = {}) {
  const prefs = progress.path || {};
  const cur = PLAN.currentStage(progress, program);
  const places = [];
  const targets = [];
  for (const stage of program.stages) {
    const sum = PLAN.stepsSummary(progress, PLAN.coreSteps(stage, prefs));
    const all = stageSteps(stage);
    let state = 'fresh';
    if (PLAN.stageComplete(progress, stage)) state = 'done';
    else if (stage.index < (prefs.start || 0)) state = 'skipped';
    else if (cur === stage) state = 'current';
    else if (played(progress, all)) state = 'started';
    else if (cur && stage.index > cur.index) state = 'ahead';
    places.push(makePlace({ id: stage.key, label: `${stage.index} ${stage.name}`, short: String(stage.index),
      percent: percentOf(sum), state, due: countIn(all, dueIds), kind: 'island' }));
    targets.push(stage.index);
  }
  return { places, targets };
}

/*
 * A stage's island, from its folder (program.mjs stageFolder): a place per
 * row, in the folder's order, so `targets[i]` is i. The folder already leaves
 * out a track with nothing in it.
 *   hutPercent(stage)  how much of its lesson cards are read, 0..100
 */
export function islandPlaces(progress, program, folder, { dueIds = new Set(), atMs = Date.now(),
  hutPercent = () => 0 } = {}) {
  const stage = folder.stage;
  const prefs = progress.path || {};
  const cur = PLAN.currentStage(progress, program);
  const next = PLAN.continueStep(progress, program, atMs);
  const nextKey = next ? next.step.key : '';
  const before = stage.index < (prefs.start || 0) && !PLAN.stageComplete(progress, stage);
  const after = cur && stage.index > cur.index;
  const places = [];
  const targets = [];
  folder.children.forEach((row, i) => {
    let place;
    if (row.lessonsRow) {
      const pct = hutPercent(stage);
      place = { id: `${stage.key}:lessons`, label: row.label, percent: pct, kind: 'hut',
        state: pct >= 100 ? 'done' : pct > 0 ? 'started' : 'fresh' };
    } else if (row.checkpoint) {
      const st = row.step;
      const done = PLAN.stepDone(progress, st);
      let state = 'fresh';
      if (done) state = 'done';
      else if (before) state = 'skipped';
      else if (st.key === nextKey) state = 'current';
      else if (played(progress, [st])) state = 'started';
      else if (after) state = 'ahead';
      place = { id: `${stage.key}:checkpoint`, label: row.label, percent: done ? 100 : 0, kind: 'fort', state,
        due: countIn([st], dueIds) };
    } else {
      const steps = row.steps || [];
      const sum = PLAN.stepsSummary(progress, steps);
      const skipped = steps.filter((st) => PLAN.stepSkipped(progress, st) && !PLAN.stepDone(progress, st)).length;
      let state = 'fresh';
      if (steps.length && skipped === steps.length) state = 'skipped';
      else if (steps.length && sum.done + skipped === steps.length) state = 'done';
      else if (before) state = 'skipped';
      else if (steps.some((st) => st.key === nextKey)) state = 'current';
      else if (sum.played) state = 'started';
      else if (after) state = 'ahead';
      place = { id: `${stage.key}:${row.trackKey || 'electives'}`, label: row.label, percent: percentOf(sum),
        kind: row.electives ? 'cove' : 'place', state, due: countIn(steps, dueIds) };
    }
    places.push(makePlace(place));
    targets.push(i);
  });
  return { places, targets };
}

/* Where the avatar first stands: the current place, else the first open one. */
export function startPlace(places) {
  const cur = places.findIndex((p) => p.state === 'current');
  if (cur >= 0) return cur;
  const open = places.findIndex((p) => p.state !== 'done' && p.state !== 'skipped');
  return open >= 0 ? open : 0;
}

/* The place a child of the folder is, or -1 for a row that is no place. */
export function placeOfChild(targets, child) {
  return targets.indexOf(child);
}

/*
 * The map's title bar: the place under the avatar on the left, its percent on
 * the right, and how many reviews are due there when that still fits. The
 * label gives way first, at a word; only when nothing that names the place
 * would be left does the due count go.
 *   width   the pixels the title bar has; measure  the font's
 */
export function mapTitle(place, width, measure) {
  if (!place) return { title: '', right: '' };
  const pct = `${place.percent}%`;
  const all = place.label.split(' ');
  /* The label cut at a word to `room`, or '' when it would lose everything
   * but a stage's number ("2" of "2 Sixteenths"), which names nothing. */
  const fit = (right) => {
    const room = width - measure(right) - 6;
    const words = all.slice();
    while (words.length > 1 && measure(words.join(' ')) > room) words.pop();
    const title = words.join(' ');
    if (measure(title) > room) return '';
    return words.length === 1 && all.length > 1 && /^\d+$/.test(title) ? '' : title;
  };
  if (place.due > 0) {
    const right = `${pct} ${place.due} due`;
    const title = fit(right);
    if (title) return { title, right };
  }
  return { title: fit(pct) || place.label, right: pct };
}
