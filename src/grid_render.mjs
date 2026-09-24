/*
 * grid_render.mjs — the lane view.
 *
 * The same chart and the same run as the staff, drawn as a drum machine: one
 * row per voice, a block where a hit lands, a playhead sweeping across. It
 * teaches nothing about reading a score and it is immediately legible, which
 * is exactly the trade a beginner should be allowed to make — and it is how
 * Move itself shows a pattern, so it is already familiar.
 *
 * Lanes are sized to the voices the drill ACTUALLY uses. A two-voice rudiment
 * gets tall lanes rather than six empty ones, which is most of why this view
 * reads well at 128x64.
 */

import * as L from './layout.mjs';
import { voiceById } from './kit.mjs';

/* Lane geometry for a set of voices. Pure, so the tests can check it without
 * drawing anything. */
export function lanes(voices) {
  const n = Math.max(1, voices.length);
  const avail = L.GRID_BOTTOM_Y - L.GRID_TOP_Y + 1;
  let h = Math.max(L.GRID_LANE_H_MIN, Math.min(L.GRID_LANE_H_MAX, Math.floor(avail / n)));
  /* More lanes than the minimum height allows: shrink rather than overflow.
   * Running off the band would draw a lane over the sticking rule, which
   * looks like a rendering bug rather than like too many voices. */
  if (h * n > avail) h = Math.max(2, Math.floor(avail / n));
  const total = h * n;
  /* Centred in the band: a two-lane drill hugging the top would leave the
   * chart looking like it had lost four rows. */
  const top = Math.max(L.GRID_TOP_Y, L.GRID_TOP_Y + Math.floor((avail - total) / 2));
  const out = [];
  for (let i = 0; i < voices.length; i++) {
    out.push({ voice: voices[i], top: top + i * h, h, mid: top + i * h + (h >> 1) });
  }
  return out;
}

export function laneOf(laneList, voice) {
  for (let i = 0; i < laneList.length; i++) {
    if (laneList[i].voice === voice) return laneList[i];
  }
  return null;
}

export function drawLanes(ctx, laneList) {
  for (let i = 0; i < laneList.length; i++) {
    const lane = laneList[i];
    const v = voiceById(lane.voice);
    ctx.text(L.GRID_LABEL_X, lane.mid - 3, v ? v.short : lane.voice, 1);
    /* A dotted rule down the middle of each lane: enough to follow the row
     * across the screen, faint enough not to compete with the hits. */
    for (let x = L.GRID_LEFT_X; x < L.SCREEN_W; x += 4) {
      ctx.fillRect(x, lane.mid, 1, 1, 1);
    }
  }
}

export function drawPlayhead(ctx, laneList, strong = false) {
  if (!laneList.length) return;
  const top = laneList[0].top;
  const bottom = laneList[laneList.length - 1].top + laneList[laneList.length - 1].h - 1;
  ctx.fillRect(L.HIT_X, top, strong ? 2 : 1, bottom - top + 1, 1);
}

export function drawBarLine(ctx, laneList, x) {
  if (!laneList.length) return;
  if (x < L.GRID_LEFT_X || x >= L.SCREEN_W) return;
  const top = laneList[0].top;
  const bottom = laneList[laneList.length - 1].top + laneList[laneList.length - 1].h - 1;
  ctx.fillRect(Math.round(x), top, 1, bottom - top + 1, 1);
}

/*
 * One hit.
 *
 *   pending  a solid block
 *   hit      the same block hollowed out — it opens, exactly as the notehead
 *            opens into a ring on the staff, so the two views teach the same
 *            vocabulary
 *   missed   a cross
 */
export function drawCell(ctx, x, lane, state) {
  const cx = Math.round(x);
  if (cx < L.GRID_LEFT_X - L.GRID_CELL_W || cx >= L.SCREEN_W) return;
  const h = Math.max(3, lane.h - 2);
  const top = lane.top + ((lane.h - h) >> 1);
  const half = L.GRID_CELL_W >> 1;

  if (state === 'missed') {
    ctx.line(cx - half, top, cx + half, top + h - 1, 1);
    ctx.line(cx - half, top + h - 1, cx + half, top, 1);
    return;
  }
  if (state === 'hit') {
    ctx.drawRect(cx - half, top, L.GRID_CELL_W, h, 1);
    return;
  }
  ctx.fillRect(cx - half, top, L.GRID_CELL_W, h, 1);
}

/* Where a pad actually went down, in its lane. Same role as the played marker
 * on the staff: the gap between this and the cell is your timing error. */
export function drawMarker(ctx, x, lane) {
  const cx = Math.round(x);
  if (cx < L.GRID_LEFT_X || cx >= L.SCREEN_W) return;
  ctx.fillRect(cx, lane.top, 1, lane.h, 1);
}

/* A whole stack, in whatever lanes it touches. */
export function drawStack(ctx, item, laneList) {
  const { entry, x } = item;
  for (let i = 0; i < entry.notes.length; i++) {
    const note = entry.notes[i];
    const lane = laneOf(laneList, note.voice);
    if (!lane) continue;
    drawCell(ctx, x, lane, note.state);
  }
}
