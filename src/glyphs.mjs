// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * glyphs.mjs — the marks both views draw, and the blitter that puts them on
 * screen. Pure; imports only the layout.
 *
 * Its own module because BOTH renderers need them and neither owns them. The
 * grid used to import the staff engraver for a ring and an x, which meant a
 * drum-tab frame could not be drawn without loading every bar line, beam and
 * ledger rule in the module. Worse, two copies of a 5x5 ring would drift the
 * first time one was adjusted, and the two views would stop teaching the same
 * vocabulary — which is the whole reason a hit "opens" in both of them.
 *
 * Glyphs are authored as rows of text and converted to horizontal runs once,
 * at import time. Text is the only sane way to edit a 1-bit shape, and runs
 * are blitted with fillRect rather than per-pixel writes: ~45 runs is about
 * 22us against ~125us for 255 set_pixel calls.
 */

import * as L from './layout.mjs';

/* [dx, dy, width] horizontal runs — blitted with fillRect, never per-pixel
 * (~45 runs is ~22us against ~125us for 255 set_pixel calls). */
export function rowsToRuns(rows) {
  const runs = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      if (row[x] === '#') {
        const start = x;
        while (x < row.length && row[x] === '#') x++;
        runs.push([start, y, x - start]);
      } else {
        x++;
      }
    }
  }
  return runs;
}

export function blit(ctx, runs, x, y) {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    ctx.fillRect(x + r[0], y + r[1], r[2], 1, 1);
  }
}

export const RING_RUNS = rowsToRuns([
  '.###.',
  '#...#',
  '#...#',
  '#...#',
  '.###.',
]);

/* The ring around a cymbal struck differently — a crash, or an open hat. */
export const CIRCLE_RUNS = rowsToRuns([
  '..###..',
  '.#...#.',
  '#.....#',
  '#.....#',
  '#.....#',
  '.#...#.',
  '..###..',
]);

/*
 * A 5x5 ring, used both for a notehead you hit and for the marker showing
 * where you actually played. Deliberately the same glyph in both views: play
 * in time and the two land on top of each other as one mark; play late and
 * the gap between them is your error, read straight off the chart.
 */
export function drawRing(ctx, cx, cy) {
  const half = L.RING >> 1;
  blit(ctx, RING_RUNS, cx - half, cy - half);
}

export function drawX(ctx, cx, cy, w = L.XHEAD) {
  const r = Math.max(1, w >> 1);
  ctx.line(cx - r, cy - r, cx + r, cy + r, 1);
  ctx.line(cx - r, cy + r, cx + r, cy - r, 1);
}

/*
 * The hand-percussion heads, drawn in lines like the x so they scale with it:
 * a triangle (cowbell, tambourine), a diamond (the second snare) and a slash
 * (the shaker). Each stays an outline or a stroke, never a filled block, so
 * none of them can be taken for a drum's head at a glance.
 */
export function drawTriangle(ctx, cx, cy, w = L.XHEAD) {
  const r = Math.max(1, w >> 1);
  ctx.line(cx - r, cy + r, cx + r, cy + r, 1);
  ctx.line(cx - r, cy + r, cx, cy - r, 1);
  ctx.line(cx, cy - r, cx + r, cy + r, 1);
}

export function drawDiamond(ctx, cx, cy, w = L.XHEAD) {
  const r = Math.max(1, w >> 1);
  ctx.line(cx - r, cy, cx, cy - r, 1);
  ctx.line(cx, cy - r, cx + r, cy, 1);
  ctx.line(cx + r, cy, cx, cy + r, 1);
  ctx.line(cx, cy + r, cx - r, cy, 1);
}

export function drawSlash(ctx, cx, cy, w = L.XHEAD) {
  const r = Math.max(1, w >> 1);
  ctx.line(cx - r, cy + r, cx + r, cy - r, 1);
  ctx.line(cx - r + 1, cy + r, cx + r, cy - r + 1, 1);
}

/* A non-drum head of any kind: what the views draw for everything but 'note'. */
export function drawHead(ctx, head, cx, cy, w = L.XHEAD) {
  if (head === 'triangle') drawTriangle(ctx, cx, cy, w);
  else if (head === 'diamond') drawDiamond(ctx, cx, cy, w);
  else if (head === 'slash') drawSlash(ctx, cx, cy, w);
  else drawX(ctx, cx, cy, w);
}

/* ---- Interface symbols -------------------------------------------------- */
/*
 * The transport marks. They live here rather than with the staff because they
 * are not engraving — nothing about a play triangle belongs to a percussion
 * clef, and the screens module was reaching into the staff engraver to get at
 * them.
 */

/* A filled right-pointing triangle. "PLAY" as a word is ambiguous at an
 * instrument — it is both a button and the thing you do with your hands —
 * while the transport symbol is only ever the button. */
export function drawPlayGlyph(ctx, x, y, h) {
  const height = h | 1;
  const half = (height - 1) >> 1;
  for (let row = 0; row < height; row++) {
    ctx.fillRect(x, y + row, half + 1 - Math.abs(row - half), 1, 1);
  }
}

export function drawRecordGlyph(ctx, x, y, d) {
  const r = d >> 1;
  for (let row = -r; row <= r; row++) {
    const w = Math.round(Math.sqrt(r * r - row * row)) * 2 + 1;
    ctx.fillRect(x + r - (w >> 1), y + r + row, w, 1, 1);
  }
}

/*
 * The scrub symbol: a ring OPEN at the lower right, with the arrowhead
 * pointing into the gap.
 *
 * Nine wide where the two buttons are seven, because a circle needs the extra
 * width to read as a circle rather than a blob — and this is the one symbol
 * here that is a KNOB rather than a button, so looking different is the point.
 *
 * The ring must stay broken. Closing it and marking the head with one extra
 * pixel reads as a plain "C" at this size: an arrow needs a wedge and
 * somewhere to point, so the bottom arc is cut short to give it one.
 */
const SCRUB_ROWS = [
  '..#####..',
  '.##...##.',
  '##.....##',
  '##....###',
  '##.....#.',
  '.##......',
  '..####...',
];
const SCRUB_RUNS = rowsToRuns(SCRUB_ROWS);
export const SCRUB_W = 9;
export const SCRUB_H = SCRUB_ROWS.length;

export function drawScrubGlyph(ctx, x, y) {
  blit(ctx, SCRUB_RUNS, x, y);
}

/*
 * The marks a row of the drill list carries, as Piano Practice draws them:
 *   done   ✓  learned: clean at tempo
 *   tried  ○  played, never clean yet
 *   skip   »  skipped on purpose
 *   next   ▸  the Learning Path's next step
 * Drawn in the row's own colour, so they read on the highlight too.
 */
const MARK_ROWS = {
  done: ['....#', '...##', '#.##.', '###..', '.#...'],
  tried: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  skip: ['#.#..', '.#.#.', '..#.#', '.#.#.', '#.#..'],
  next: ['#....', '##...', '###..', '##...', '#....'],
};
const MARK_RUNS = {};
for (const k in MARK_ROWS) MARK_RUNS[k] = rowsToRuns(MARK_ROWS[k]);
export const MARK_W = 5;

export function drawMark(ctx, x, y, kind, v = 1) {
  const runs = MARK_RUNS[kind];
  if (!runs) return;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    ctx.fillRect(x + r[0], y + r[1], r[2], 1, v);
  }
}
