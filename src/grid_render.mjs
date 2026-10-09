// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

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
import { drawX, drawRing, rowsToRuns } from './glyphs.mjs';

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
 * One hit, in drum tab.
 *
 *   x   a cymbal          O   accent — the same glyph, wider
 *   o   a drum            .   ghost  — the same glyph, smaller
 *   ( ) hit    the glyph OPENS, exactly as the notehead opens into a ring
 *   ✗   missed struck through
 *
 * This is what a drummer reads, and it is legible at a glance while playing
 * rather than only while still — which a row of anonymous blocks was not. The
 * hit and miss vocabulary is deliberately the same as the staff's, so the two
 * views teach one language and a player can switch without relearning.
 *
 * The glyph primitives come from staff_render.mjs rather than being authored
 * again here: two copies of a 5x5 ring would drift the first time one was
 * adjusted.
 */
/*
 * A drum is a FILLED blob and a hit is a ring, exactly as on the staff. Tab
 * writes a drum as `o`, but drawing it hollow would collide with the open
 * ring that means "you got it" — and telling the player what they have
 * already played apart from what they still owe matters more than matching
 * the ASCII shorthand.
 */
const DISC = {
  9: rowsToRuns(['...###...', '.#######.', '#########', '#########', '#########',
                 '#########', '#########', '.#######.', '...###...']),
  7: rowsToRuns(['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..']),
  5: rowsToRuns(['.###.', '#####', '#####', '#####', '.###.']),
  3: rowsToRuns(['###', '###', '###']),
  1: rowsToRuns(['#']),
};

function drawDisc(ctx, cx, cy, w) {
  const runs = DISC[w] || DISC[3];
  const half = (w - 1) >> 1;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    ctx.fillRect(cx - half + r[0], cy - half + r[1], r[2], 1, 1);
  }
}

export function cellWidth(dyn, laneH) {
  /* A drill with one or two voices gets the whole band between them, so its
   * cells are drawn at the size that room allows rather than at the size a
   * nine-voice chart is forced down to. */
  const base = laneH >= 14 ? 7 : laneH >= 8 ? 5 : 3;
  const step = dyn === 'accent' ? 2 : dyn === 'ghost' ? -2 : 0;
  /*
   * Always odd, and always a size the disc table holds: a blob with no centre
   * pixel cannot be centred on its beat.
   *
   * The ceiling is 9 rather than 7 because it has to sit one step ABOVE the
   * largest base. Clamped at 7 a tall lane drew its normal and its accent at
   * the same width, which silently collapsed the three weights into two — the
   * dynamic is carried by weight alone here, so that is the whole vocabulary
   * gone rather than a cosmetic loss.
   */
  return Math.max(1, Math.min(9, base + step));
}

export function drawCell(ctx, x, lane, state, head = 'note', dyn = 'normal') {
  const cx = Math.round(x);
  if (cx < L.GRID_LEFT_X - 4 || cx >= L.SCREEN_W) return;
  const cy = lane.mid;
  const w = cellWidth(dyn, lane.h);

  if (state === 'hit') {
    /* It opens. A cymbal keeps a dot of its x inside, so a hit hat and a hit
     * kick do not both become the same anonymous circle. */
    drawRing(ctx, cx, cy);
    if (head !== 'note') ctx.fillRect(cx, cy, 1, 1, 1);
    return;
  }

  if (head === 'note') {
    drawDisc(ctx, cx, cy, w);
  } else {
    drawX(ctx, cx, cy, w);
  }

  if (state === 'missed') {
    const r = (w >> 1) + 1;
    ctx.line(cx - r, cy + r, cx + r, cy - r, 1);
  }
}

/* Where a pad actually went down, in its lane. Same role as the played marker
 * on the staff: the gap between this and the cell is your timing error. */
export function drawMarker(ctx, x, lane) {
  const cx = Math.round(x);
  if (cx < L.GRID_LEFT_X || cx >= L.SCREEN_W) return;
  ctx.fillRect(cx, lane.top, 1, lane.h, 1);
}

/* A whole stack, in whatever lanes it touches. */
export function drawStack(ctx, item, laneList, opts = {}) {
  const { entry, x } = item;
  for (let i = 0; i < entry.notes.length; i++) {
    const note = entry.notes[i];
    const lane = laneOf(laneList, note.voice);
    if (!lane) continue;
    const v = voiceById(note.voice);
    const dyn = opts.dynamics === false ? 'normal' : note.wantDyn;
    drawCell(ctx, x, lane, note.state, v ? v.head : 'note', dyn);
  }
}
