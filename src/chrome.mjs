/*
 * chrome.mjs — the furniture every screen shares: the header, the bar ruler,
 * the progress footer, the list, the plot and the count-in.
 *
 * Its own module so that the reading view and the eight other screens can
 * each be their own file without one importing the other. That edge — a
 * renderer reaching into another renderer — is the thing this split exists to
 * avoid, and it is the same edge glyphs.mjs removed between the staff and the
 * grid.
 */

import * as L from './layout.mjs';
import { barBeatOf } from './chart.mjs';
import { recentStats } from './timing.mjs';
import * as SR from './staff_render.mjs';

/* ---- Header ------------------------------------------------------------- */
/*
 * Left: the drill. Middle: where you are. Right: the two numbers.
 *
 * The mean and sigma live in the header rather than on the summary because
 * they are the thing you correct WHILE playing — a number you only see when
 * you stop is a report card, not feedback.
 */
export function drawHeader(ctx, s) {
  const bar = barBeatOf(s.chart, Math.max(0, s.songBeats));
  const left = s.title || '';
  /* "3/8" is bars through the whole practice. An endless drill has no total,
   * so it falls back to the absolute bar and beat. */
  const mid = bar.bars > 0 ? `${bar.bar}/${bar.bars}` : `${bar.bar}.${bar.beat}`;
  /*
   * The right slot holds ONE thing, and which one depends on what you are
   * doing. While playing it is your timing, which is the whole point of the
   * module. The ready screen overrides it: the practice length before you
   * start, and the position once you are scrubbing — because while you are
   * navigating "where am I" is the only question, and the scroll alone cannot
   * answer it in bars.
   */
  const t = s.timing ? recentStats(s.timing, L.TIMING_RECENT_N) : null;
  const right = s.rightLabel !== undefined ? s.rightLabel
    : t && t.n > 0
      ? `${t.meanMs >= 0 ? '+' : ''}${Math.round(t.meanMs)} s${Math.round(t.sdMs)}`
      : `${Math.round(s.bpm || 0)}`;

  const rw = ctx.textWidth(right);
  const mw = ctx.textWidth(mid);
  /* Fit the title to whatever the other two leave, rather than letting it run
   * under them — past TEXT_MAX_PX the host stops plotting and a number goes
   * missing in silence. */
  let title = left;
  const budget = L.SCREEN_W - rw - mw - 10;
  while (title.length && ctx.textWidth(title) > budget) title = title.slice(0, -1);

  ctx.text(1, 0, title, 1);
  ctx.text(L.SCREEN_W - rw - mw - 5, 0, mid, 1);
  ctx.text(L.SCREEN_W - rw - 1, 0, right, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
}

/* ---- The bar ruler and the footer ------------------------------------- */
/*
 * The bar ruler: the rule under the chart, a tick where each bar line falls,
 * and the bar's number beside it.
 *
 * WHY THE NUMBER IS CLAMPED. At the default 32px/beat a 4/4 bar is 128px —
 * exactly the screen — so a number drawn at its own bar line is on screen for
 * a fraction of each bar and missing for the rest, which is worse than not
 * drawing it: a readout that blinks out is one you learn to stop looking at.
 * Held against the left edge instead it is always there, and it names the bar
 * you are IN rather than the one whose line happens to be visible. This is
 * what a DAW ruler does, for the same reason.
 *
 * It yields rather than overlaps: once the next tick is close enough that the
 * digits would run into it, the number stops being pushed and the next one
 * takes over. `bars` is whatever `visibleBars()` returned, so the count is the
 * same one the header prints and the two cannot drift apart.
 */
export function drawBarRuler(ctx, bars, numbers) {
  ctx.fillRect(0, L.UNDER_RULE_Y, L.SCREEN_W, 1, 1);
  for (let i = 0; i < bars.length; i++) {
    const x = Math.round(bars[i].x);
    if (x >= 0 && x < L.SCREEN_W) {
      ctx.fillRect(x, L.UNDER_TICK_Y, 1, L.UNDER_TICK_H, 1);
    }
    if (!numbers) continue;
    const label = String(bars[i].bar);
    const w = ctx.textWidth(label);
    let lx = Math.max(1, x + 2);
    const next = bars[i + 1];
    /* Stop short of the next tick; if there is no room left at all, this bar's
     * number has been superseded and the next one is the one to show. */
    if (next) {
      const limit = Math.round(next.x) - w - 2;
      if (limit < lx) continue;
    }
    if (lx + w > L.SCREEN_W) lx = L.SCREEN_W - w;
    ctx.text(lx, L.UNDER_LANE_Y, label, 1);
  }
}

/*
 * The footer: an outlined bar that fills as the drill goes, and the hits and
 * misses so far at its right. Drawn as the piano trainer draws it.
 */
export function drawFooter(ctx, progress, right) {
  const w = Math.max(0, Math.min(1, progress)) * L.FOOTER_BAR_W;
  ctx.drawRect(1, L.FOOTER_Y, L.FOOTER_BAR_W, L.PROGRESS_H, 1);
  if (w > 0) ctx.fillRect(1, L.FOOTER_Y, Math.round(w), L.PROGRESS_H, 1);
  if (right) ctx.text(L.SCREEN_W - ctx.textWidth(right) - 1, L.FOOTER_Y - 2, right, 1);
}

/* ---- Lists (the menu and the settings page) ----------------------------- */
/*
 * One list renderer for both, because they are the same thing: rows, one
 * highlighted, scrolled to keep the highlight on screen. The window is kept
 * so the selection never sits against an edge while there is more to see.
 */
export const LIST_ROWS = 5;

export function listWindow(count, selected, rows = LIST_ROWS) {
  if (count <= rows) return 0;
  let top = selected - (rows >> 1);
  if (top < 0) top = 0;
  if (top > count - rows) top = count - rows;
  return top;
}

/*
 * A page of rows that only turns when the selection leaves it. Settings uses
 * this rather than the centred window: its knobs are mapped to the rows on
 * screen, and a window that re-centred on every step moved a knob onto the
 * next row with every detent.
 */
export function pageTop(count, selected, rows = LIST_ROWS) {
  if (count <= rows) return 0;
  return Math.floor(Math.max(0, selected) / rows) * rows;
}

export function drawList(ctx, { title, items, selected, right, top: fixedTop }) {
  ctx.clear();
  ctx.text(1, 0, title || '', 1);
  if (right) ctx.text(L.SCREEN_W - ctx.textWidth(right) - 1, 0, right, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  const top = fixedTop === undefined ? listWindow(items.length, selected) : fixedTop;
  for (let i = 0; i < LIST_ROWS && top + i < items.length; i++) {
    const idx = top + i;
    const y = 11 + i * (L.TEXT_H + 2);
    const item = items[idx];
    const label = typeof item === 'string' ? item : item.label;
    const value = typeof item === 'string' ? '' : item.value || '';
    if (idx === selected) {
      ctx.fillRect(0, y - 1, L.SCREEN_W, L.TEXT_H + 1, 1);
      ctx.text(2, y, label, 0);
      if (value) ctx.text(L.SCREEN_W - ctx.textWidth(value) - 2, y, value, 0);
    } else {
      ctx.text(2, y, label, 1);
      if (value) ctx.text(L.SCREEN_W - ctx.textWidth(value) - 2, y, value, 1);
    }
  }
  /* A scrollbar, so a long list does not look like a short one. */
  if (items.length > LIST_ROWS) {
    const h = Math.max(3, Math.round((LIST_ROWS / items.length) * 44));
    const y = 10 + Math.round((top / (items.length - LIST_ROWS)) * (44 - h));
    ctx.fillRect(L.SCREEN_W - 1, y, 1, h, 1);
  }
}

/* Tempo as a line, sigma as bars growing from the baseline. */
export function drawPlot(ctx, box, records) {
  ctx.drawRect(box.x, box.y, box.w, box.h, 1);
  if (!records.length) return;
  const errH = Math.max(L.PLOT_ERR_MIN_H, Math.round(box.h * L.PLOT_ERR_FRACTION));
  const lineH = box.h - errH - 2;

  let lo = Infinity;
  let hi = -Infinity;
  for (const r of records) {
    if (r.bpm < lo) lo = r.bpm;
    if (r.bpm > hi) hi = r.bpm;
  }
  const span = hi - lo || 1;
  const n = records.length;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const x = box.x + 1 + (n === 1 ? 0 : Math.round((i / (n - 1)) * (box.w - 3)));
    const y = box.y + 1 + lineH - Math.round(((records[i].bpm - lo) / span) * (lineH - 1));
    if (prev) ctx.line(prev[0], prev[1], x, y, 1);
    ctx.fillRect(x, y, 1, 1, 1);
    prev = [x, y];
    const frac = Math.min(1, (records[i].sd || 0) / L.PLOT_SIGMA_FULL_MS);
    const h = Math.max(1, Math.round(frac * errH));
    ctx.fillRect(x, box.y + box.h - 1 - h, 1, h, 1);
  }
}

/* ---- Count-in ----------------------------------------------------------- */
export function drawCountIn(ctx, digit) {
  const text = String(digit);
  const w = SR.bigTextWidth(text, 4);
  ctx.fillRect(((L.SCREEN_W - w) >> 1) - 4, 16, w + 8, 5 * 4 + 6, 0);
  SR.drawBigText(ctx, (L.SCREEN_W - w) >> 1, 19, text, 4);
}
