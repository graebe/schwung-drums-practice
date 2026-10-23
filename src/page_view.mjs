// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * page_view.mjs — L0's still page. Pure, like view.mjs: (ctx, state) in,
 * pixels out, nothing kept between calls.
 *
 * The scroll shows three beats of what is coming and moves them past a fixed
 * line. With no clock there is nothing to move, so L0 shows the WHOLE BAR,
 * standing still, and moves a cursor instead, from stack to stack. When the
 * bar's last stack is struck, the page turns.
 *
 * THE CURSOR NEVER COVERS WHAT IT POINTS AT. It is an arrow above the stack
 * and a caret below it, and nothing between them: a line through the stack
 * hid the very drum it was asking for (the owner's first test on the Move).
 * The grid's lanes carry no dotted rule here either: a whole bar on one screen packs the notes close enough that a dot
 * every 4px read as a note. The beats are ticked on the rule under the chart
 * instead.
 *
 * At the end of a bar the next one is already in view: past the closing bar
 * line sits the first stack of the next bar, alone — a cue rather than a
 * placed note — so the hands can plan the turn before it comes. At the end of
 * the take a double bar stands there instead.
 *
 * Everything drawn is a stack the renderers already draw: the page only puts
 * each one at x = left + (beat - barStart) * pxPerBeat instead of at its place
 * on the scroll (scoring.mjs entriesIn), so a ring and a cross mean here what
 * they mean everywhere else.
 */

import * as L from './layout.mjs';
import * as SR from './staff_render.mjs';
import * as GR from './grid_render.mjs';
import * as B from './beam.mjs';
import { entriesIn, handsWritten } from './scoring.mjs';
import { beatsPerBar } from './chart.mjs';
import { voicesInChart } from './kit.mjs';
import { drawHeader, drawFooter, drawHint, drawBarRuler, drawLaneCallout, drawReadyBox } from './chrome.mjs';

/* Where a page starts and how wide a beat is on it, for this view. */
export function pageGeometry(view, chart) {
  const left = view === 'grid' ? L.PAGE_LEFT_GRID_X : L.PAGE_LEFT_STAFF_X;
  const perBar = beatsPerBar(chart);
  const px = (L.PAGE_BAR_X - L.PAGE_END_PAD - left) / perBar;
  return { left, px, perBar };
}

/* The bar a page shows: the one holding the cursor's stack, or the last bar
 * once the take is through. */
export function pageBar(run, cursor, perBar) {
  const entries = run.entries;
  if (!entries.length) return 0;
  const e = entries[Math.min(Math.max(0, cursor), entries.length - 1)];
  return Math.floor((e.beat + 1e-9) / perBar);
}

/*
 * s = { run, chart, view, lanes, voices, dynamics, cursor, title, rightLabel,
 *       footerRight, progress, paused, done, hint }
 *   cursor   the entry the take waits on; past the end once it is through
 *   done     the take is through: no cursor, and a double bar for the peek
 */
export function drawUntimedView(ctx, s) {
  ctx.clear();
  const { left, px, perBar } = pageGeometry(s.view, s.chart);
  const run = s.run;
  const bar = pageBar(run, s.cursor, perBar);
  const from = bar * perBar;
  const page = entriesIn(run, from, from + perBar, left, px);
  const cur = s.done ? null : run.entries[s.cursor] || null;
  const curItem = cur ? page.find((p) => p.entry === cur) : null;
  const nextEntry = page.length ? run.entries[page[page.length - 1].index + 1] : null;
  const peek = nextEntry ? { index: page[page.length - 1].index + 1, entry: nextEntry,
    beat: nextEntry.beat, x: L.PAGE_PEEK_X } : null;

  drawHeader(ctx, { chart: s.chart, songBeats: cur ? cur.beat : from, title: s.title,
    rightLabel: s.rightLabel, ready: s.ready });

  if (s.view === 'grid') drawGridPage(ctx, s, page, peek, left, px);
  else drawStaffPage(ctx, s, page, peek, left, px);
  if (curItem) drawArrow(ctx, Math.round(curItem.x));

  drawUnder(ctx, s, page, bar, curItem, left, px, perBar);
  /* The hint line takes the footer's band when there is one to show. */
  if (s.hint || s.hintLeft) drawHint(ctx, s.hint, s.hintLeft);
  else drawFooter(ctx, s.progress || 0, s.footerRight || '');
  if (s.paused) drawLaneCallout(ctx, 'PAUSED');
}

function drawStaffPage(ctx, s, page, peek, left, px) {
  SR.drawStaff(ctx);
  SR.drawClef(ctx);
  SR.drawBarLine(ctx, left + L.BAR_OFFSET_PX);
  closeBar(ctx, peek, (x) => SR.drawBarLine(ctx, x));

  const gb = B.groupBeats(s.chart);
  const entries = s.run.entries;
  for (let i = 0; i < page.length; i++) {
    const next = page[i + 1];
    const spacingPx = next ? next.x - page[i].x : px * 0.5;
    const beams = B.beamsAt(entries, page[i].index, gb);
    SR.drawStack(ctx, page[i], { dynamics: s.dynamics, spacingPx, beams });
  }
  SR.drawBeams(ctx, page, entries, gb);
  if (peek) SR.drawStack(ctx, peek, { dynamics: s.dynamics, spacingPx: L.TIGHT_SPACING_PX, beams: 0 });
}

function drawGridPage(ctx, s, page, peek, left, px) {
  const laneList = s.lanes || GR.lanes(s.voices || voicesInChart(s.chart));
  GR.drawLanes(ctx, laneList, false);
  GR.drawBarLine(ctx, laneList, left + L.BAR_OFFSET_PX);
  closeBar(ctx, peek, (x) => GR.drawBarLine(ctx, laneList, x));
  for (let i = 0; i < page.length; i++) {
    const next = page[i + 1];
    const spacingPx = next ? next.x - page[i].x : px * 0.5;
    GR.drawStack(ctx, page[i], laneList, { dynamics: s.dynamics, spacingPx });
  }
  if (peek) GR.drawStack(ctx, peek, laneList, { dynamics: s.dynamics });
}

/* The closing bar line — doubled when nothing follows, as a score ends. */
function closeBar(ctx, peek, line) {
  line(L.PAGE_BAR_X);
  if (!peek) line(L.PAGE_BAR_X + 2);
}

/*
 * Under the page: the bar number at the left, and a caret under the cursor —
 * the line itself hides behind a filled disc, and the caret does not. A
 * drill with written hands gets its R and L there instead of the number, as
 * on the scroll; the header already says which bar it is.
 */
function drawUnder(ctx, s, page, bar, curItem, left, px, perBar) {
  const sticking = handsWritten(s.run);
  drawBarRuler(ctx, [{ bar: bar + 1, x: -1 }], !sticking);
  /* The beats, ticked on the rule: the lanes have no rule of their own here.
   * The downbeat is the longer tick, as on a ruler. */
  for (let b = 0; b < Math.ceil(perBar - 1e-9); b++) {
    ctx.fillRect(Math.round(left + b * px), L.UNDER_TICK_Y, 1, b === 0 ? L.UNDER_TICK_H : 1, 1);
  }
  if (sticking) {
    for (let i = 0; i < page.length; i++) {
      const note = page[i].entry.notes[0];
      if (!note || !note.wantHand) continue;
      const next = page[i + 1];
      const limit = next ? Math.max(0, next.x - page[i].x - 1) : px;
      SR.drawSticking(ctx, page[i].x, note.wantHand, note.handOk !== false, Math.min(limit, 14));
    }
  }
  if (curItem && !sticking) drawCaret(ctx, Math.round(curItem.x));
}

/* Up from the under-lane, tip first. */
function drawCaret(ctx, x) {
  for (let r = 0; r < L.CARET_H; r++) {
    ctx.fillRect(x - r, L.UNDER_LANE_Y + r, 2 * r + 1, 1, 1);
  }
}

/* Down from under the header rule, tip last: the caret's mirror. Above the
 * top lane in the grid; on the staff its tip can touch the stack's own first
 * beam, which reads as pointing at it. */
function drawArrow(ctx, x) {
  for (let r = 0; r < L.CARET_H; r++) {
    const w = L.CARET_H - 1 - r;
    ctx.fillRect(x - w, L.CURSOR_TOP_Y + r, 2 * w + 1, 1, 1);
  }
}

/*
 * The ready screen: the page, with the controls over it — the same box the
 * timed rungs show, saying what they do here. Play sounds the bar at its
 * written tempo, so the groove can be heard before it is stepped; Record
 * begins, with no count-in, because there is nothing to count in to. While
 * Play sounds the bar (s.listening) the box steps aside for the page.
 */
export function drawUntimedReady(ctx, s) {
  drawUntimedView(ctx, s);
  if (s.scrubbed || s.listening) return;
  /* Knob 8 is the tempo here too: how fast Play sounds the bar. */
  drawReadyBox(ctx, { rows: [['play', 'hear bar'], ['rec', 'own pace'], ['scrub', 'scrub']], level: s.level,
    bpm: s.bpm });
}
