// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * scene_view.mjs — a scene of the Learning Path (scenes.mjs) on the screen
 * and the pads, a frame at a time. Pure: ui.js plays the queue, the preview
 * draws any frame of it, and both draw it the same way.
 *
 * The frames are the engine's (pathmap/anim.mjs), drawn with the ms into the
 * scene:
 *   celebrate  the place not yet done, its flag rising (flagRise); a big one
 *              then fireworks over it, the map without its route
 *   banner     a strip across the map: STAGE COMPLETE and the like
 *   walk       the avatar at the story's pace (STORY_MS_PER_CELL)
 *   zoom       the world's title, the island growing from its cell or back
 *   finale     every flag waving, fireworks over every island
 *   star       its own frame: the result's big number in the map area,
 *              LEVEL LEARNED under it (drawLearned); the rays round it wait
 *              for the engine's elliptical starBurst
 * The pads: a green sweep as a flag rises and round the star, sparkles under
 * fireworks, a banner and the finale; a walk and a zoom show their map's.
 */

import * as V from './view.mjs';
import * as MP from './map_places.mjs';
import * as A from './pathmap/anim.mjs';
import { cellCentre } from './pathmap/layout.mjs';
import { createWalk, walkTo, posAt, STORY_MS_PER_CELL } from './pathmap/walk.mjs';
import { mapPadColors } from './pathmap/leds.mjs';
import { MAP_PALETTE, SCENE_PALETTE } from './padmap.mjs';
import { SCREEN_W } from './layout.mjs';

/* The map a scene is drawn on: a zoom's is the world, whose island it is. */
export function sceneMap(sc) {
  return sc.kind === 'zoom' ? sc.world : sc.map || null;
}

/* Its avatar: walking from place to place at the story's pace, or standing
 * where the scene is. Null for the star, which has no map. */
export function sceneWalk(sc, t) {
  const m = sceneMap(sc);
  if (!m) return null;
  const pace = { msPerCell: STORY_MS_PER_CELL };
  if (sc.kind === 'walk') return walkTo(createWalk(m.layout, sc.from, pace), sc.to, t, pace);
  return createWalk(m.layout, sc.at, pace);
}

/*
 * What a scene's frames are drawn with, worked out once as it starts: the
 * repaint is fifty times a second and must not allocate. `seed` varies the
 * fireworks from scene to scene.
 */
export function sceneArgs(sc, { seed = 1 } = {}) {
  const m = sceneMap(sc);
  if (sc.kind === 'zoom') return { cell: m.layout.cells[sc.at], place: m.places[sc.at] };
  if (sc.kind === 'finale') return { layout: m.layout, places: m.places, seed };
  if (sc.kind === 'banner') return { text: sc.text };
  if (sc.kind !== 'celebrate') return null;
  const place = m.places[sc.at];
  const c = cellCentre(m.layout.cells[sc.at], m.layout.kind);
  /* Under the rising flag the place as it was: not yet done. */
  const before = m.places.slice();
  before[sc.at] = { ...place, state: 'started' };
  return { layout: m.layout, index: sc.at, place, before, burst: { x: c.x, y: c.y, seed } };
}

/* A map with its avatar, and the place under it named in the title bar. */
export function drawPlaces(ctx, { map, walk, now, footer, places = map.places, route = true }) {
  const head = MP.mapTitle(places[posAt(walk, now).at], SCREEN_W - 2, (s) => ctx.textWidth(s));
  V.drawMapScreen(ctx, { title: head.title, right: head.right, places, layout: map.layout, walk, now, footer,
    route });
}

/* The star's frame, for the result it celebrates: a take's (summary) or a
 * quiz round's (result), its title bar and its big number. */
export function learnedOf({ summary = null, result = null }) {
  if (result) return { title: result.isBest ? 'BEST YET' : 'ROUND', big: V.resultBig(result), unit: '/min' };
  return { title: summary.name || 'RESULT', right: summary.status, mark: summary.mark, big: V.summaryBig(summary),
    unit: '%' };
}

/*
 * One frame, `ms` into the scene: s = { scene, args, walk, now, ms, footer,
 * learned } — `learned` the star's frame (learnedOf).
 */
export function drawScene(ctx, s) {
  const sc = s.scene;
  const a = s.args;
  if (sc.kind === 'star') {
    V.drawLearned(ctx, { ...s.learned, footer: s.footer });
    return;
  }
  const map = sceneMap(sc);
  const base = { map, walk: s.walk, now: s.now, footer: s.footer };
  if (sc.kind === 'celebrate') {
    const rising = s.ms < A.FLAG_MS;
    drawPlaces(ctx, { ...base, places: rising ? a.before : map.places, route: rising });
    if (rising) A.flagRise(ctx, a, s.ms);
    else A.fireworks(ctx, a.burst, s.ms - A.FLAG_MS);
    return;
  }
  drawPlaces(ctx, { ...base, route: sc.kind !== 'banner' });
  if (sc.kind === 'zoom') (sc.dir === 'in' ? A.zoomIn : A.zoomOut)(ctx, a, s.ms);
  else if (sc.kind === 'finale') A.finale(ctx, a, s.ms);
  else if (sc.kind === 'banner') A.banner(ctx, a, s.ms);
}

/* The pads for a frame, into `out` (32, by note - 68). */
export function sceneLeds(out, { scene, walk, now, ms, seed = 1 }) {
  if (scene.kind === 'star' || (scene.kind === 'celebrate' && ms < A.FLAG_MS)) {
    return A.sweepColors({ t: ms, palette: SCENE_PALETTE, out });
  }
  if (scene.kind === 'celebrate' || scene.kind === 'finale' || scene.kind === 'banner') {
    return A.sparkleColors({ t: ms, seed, palette: SCENE_PALETTE, out });
  }
  const m = sceneMap(scene);
  return mapPadColors({ places: m.places, layout: m.layout, walk, now, palette: MAP_PALETTE, out });
}
