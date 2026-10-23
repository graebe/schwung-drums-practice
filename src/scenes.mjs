// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * scenes.mjs — this module's Learning Path in motion: the snapshot of its
 * path to compare, and the scenes that show what a step finished, with what
 * each says aloud. Pure. The player, the scenes' lengths and the comparison
 * itself are the engine's (pathmap/scenes.mjs, shared with Piano Practice);
 * ui.js plays the queue on its ANIM screen.
 *
 * The path is compared before and after a step's takes (pathState here,
 * changes in the engine):
 * a place newly finished, a stage newly through (its core, or its checkpoint
 * passed), the whole path through. On along the path (Click on a result)
 * then plays, on the maps the learner knows:
 *
 *   a place finished, the next step in another place of the island
 *       celebrate the place  ->  walk to the next step's place
 *   a stage through, the next step on another island
 *       celebrate (fireworks)  ->  banner (STAGE COMPLETE, or CHECKPOINT
 *       PASSED)  ->  zoom out  ->  sail to the next island  ->  zoom in
 *       ->  walk to the next step's place
 *   the whole path through
 *       celebrate (fireworks)  ->  banner  ->  zoom out  ->  banner
 *       (LEARNING PATH COMPLETE)  ->  the finale on the world map
 *   the next step in the same place
 *       nothing: on as before
 *
 * A scene is { kind, say, ... }:
 *   celebrate  { map, at, big }       the place's flag; with fireworks if big
 *   banner     { map, at, text }      a strip across the map: STAGE COMPLETE,
 *                                     CHECKPOINT PASSED, LEARNING PATH COMPLETE
 *   walk       { map, from, to }      the avatar from place to place
 *   zoom       { dir, world, island, at }   in to island `at`, or out of it
 *   finale     { map, at }            every flag, fireworks over the world
 *   star       { under }              round the result's big score (ui.js)
 * and a map is { level: 'world' | 'island', label, places, targets, layout }.
 */

import * as PLAN from './program.mjs';
import * as MP from './map_places.mjs';
/* A stage's folder, among the Path's children. */
export function folderOf(folders, stageKey) {
  return folders.find((f) => f.stage && f.stage.key === stageKey) || null;
}

/* The world map and a stage's island, as the map screen draws them. */
export function worldMap(progress, program, env = {}) {
  const built = MP.worldPlaces(progress, program, env);
  return { level: 'world', label: 'Learning Path', ...built, layout: MP.mapLayout('world', built.places.length) };
}

export function islandMap(progress, program, folder, env = {}) {
  const built = MP.islandPlaces(progress, program, folder, env);
  return { level: 'island', label: folder.label, ...built, layout: MP.mapLayout('island', built.places.length) };
}

/*
 * What is finished on the path, to compare (pathmap/scenes.mjs changes): per
 * stage whether it is through and which of its places are done, and whether
 * every stage is — { stages: { [key]: { done, places } }, all }.
 */
export function pathState(progress, program, folders, env = {}) {
  const stages = {};
  for (const folder of folders) {
    const map = islandMap(progress, program, folder, env);
    stages[folder.stage.key] = {
      done: PLAN.stageComplete(progress, folder.stage),
      places: map.places.filter((p) => p.state === 'done').map((p) => p.id),
    };
  }
  return { stages, all: !PLAN.currentStage(progress, program) };
}

const celebrate = (map, at, big, say) => ({ kind: 'celebrate', map, at, big, say });
const walk = (map, from, to) => ({ kind: 'walk', map, from, to, say: `Walking to ${map.places[to].label}` });
const banner = (map, at, text, say) => ({ kind: 'banner', map, at, text, say });

/*
 * The scenes for going on from `step` to `next` (null: nowhere left), given
 * what the step changed. Empty when nothing it finished moves the learner to
 * another place.
 */
export function pathScenes({ progress, program, folders, step, next, change, env = {} }) {
  if (!step || !change) return [];
  const here = folderOf(folders, step.stage);
  if (!here) return [];
  const island = islandMap(progress, program, here, env);
  const from = MP.placeOfStep(here, step);
  if (from < 0) return [];
  const stageDone = change.stages.includes(step.stage);
  if (!stageDone && !change.places.includes(island.places[from].id)) return [];
  const sameIsland = next && next.stage === step.stage;
  const to = sameIsland ? MP.placeOfStep(here, next) : -1;
  const done = `${island.places[from].label} done`;
  if (!stageDone) return to >= 0 && to !== from ? [celebrate(island, from, false, done), walk(island, from, to)] : [];
  /* Through by its checkpoint, or by its core. */
  const passed = change.places.includes(`${step.stage}:checkpoint`);
  const out = [celebrate(island, from, true, done),
    banner(island, from, passed ? 'CHECKPOINT PASSED' : 'STAGE COMPLETE',
      passed ? 'Checkpoint passed' : `Stage ${here.stage.index} complete`)];
  if (!next || sameIsland) {
    if (to >= 0 && to !== from) out.push(walk(island, from, to));
    if (!next && change.all) {
      const world = worldMap(progress, program, env);
      const at = here.stage.index;
      out.push({ kind: 'zoom', dir: 'out', world, island, at, say: world.label },
        banner(world, at, 'LEARNING PATH COMPLETE', 'Learning Path complete'),
        { kind: 'finale', map: world, at, say: '' });
    }
    return out;
  }
  const there = folderOf(folders, next.stage);
  if (!there) return out;
  const world = worldMap(progress, program, env);
  const landing = islandMap(progress, program, there, env);
  out.push(
    { kind: 'zoom', dir: 'out', world, island, at: here.stage.index, say: world.label },
    walk(world, here.stage.index, there.stage.index),
    { kind: 'zoom', dir: 'in', world, island: landing, at: there.stage.index, say: there.label },
  );
  const arrive = MP.placeOfStep(there, next);
  if (arrive > 0) out.push(walk(landing, 0, arrive));
  return out;
}
