/*
 * chrome.mjs — the furniture every screen shares: the header, the timing bar,
 * the list, the plot and the count-in.
 *
 * Its own module so that the reading view and the eight other screens can
 * each be their own file without one importing the other. That edge — a
 * renderer reaching into another renderer — is the thing this split exists to
 * avoid, and it is the same edge glyphs.mjs removed between the staff and the
 * grid.
 */

import * as L from './layout.mjs';
import { barBeatOf } from './chart.mjs';
import { histogram, recentStats } from './timing.mjs';
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

  /*
   * The header rule doubles as a progress bar: it is already a full-width
   * line in exactly the right place, so the practice fills it from the left
   * by thickening. Nothing new moves on screen and nothing else had to give
   * up a row. An endless drill leaves it alone, because there is no fraction
   * of forever and a bar that crept along regardless would be a lie.
   */
  if (s.run && s.progress > 0) {
    ctx.fillRect(0, L.HEADER_RULE_Y - 1, Math.round(s.progress * L.SCREEN_W), 1, 1);
  }
}

/* ---- The timing bar ----------------------------------------------------- */
/*
 * Zero in the middle of the SCREEN, early left, late right — the same
 * direction the music scrolls. The eye needs a landmark it can trust between
 * frames, so the centre never moves and the scale never rescales itself to
 * the data: a bar that redrew its own axis every time you played badly would
 * make bad playing look the same as good.
 */
export function timingX(ms) {
  const clamped = Math.max(-L.TIMING_SPAN_MS, Math.min(L.TIMING_SPAN_MS, ms));
  return Math.round(L.TIMING_CENTER_X + (clamped / L.TIMING_SPAN_MS) * L.TIMING_HALF_W);
}

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
 * How your playing is DISTRIBUTED, which is a shape rather than a number:
 *
 *   tight      a narrow spike on the centre
 *   rushing    a spike left of it
 *   dragging   a spike right of it
 *   scattered  a wide, low mound
 *
 * That is readable in the moment a drummer can spare to glance down, which a
 * cloud of twenty-four dots on two rows was not — in a tight passage they
 * merged into one blob, and a dot's ROW was picked by its index parity, so
 * height carried no meaning at all.
 *
 * The scale never rescales horizontally (see timingX) so the centre is always
 * the beat. It does normalise VERTICALLY, to its own tallest column: the shape
 * is about where the hits sit relative to each other, and a fixed vertical
 * scale would leave the picture almost flat until you had played a lot. The
 * cost is that thirty hits and three hundred can draw the same silhouette —
 * the header carries the counts, this carries the shape.
 */
export function drawTimingBar(ctx, timing, windows) {
  const y = L.TIMING_BAR_Y;
  const baseline = y + L.TIMING_HIST_ROWS - 1; /* columns grow UP from here */
  const axisY = baseline + 1;
  const markY = axisY + 1;
  const cx = L.TIMING_CENTER_X;

  /*
   * The axis, and the good window as the one SOLID run on it. "Inside the
   * window" has to be a place on the bar rather than a number to remember, and
   * before this the window was dotted along the same row as the minor ticks —
   * so the most important reference on the screen was indistinguishable from
   * graduations. Now the graduations are gone and it is the only solid thing.
   */
  const good = windows ? windows.goodMs : 0;
  const goodR = timingX(good);
  const goodL = timingX(-good);
  const left = timingX(-L.TIMING_SPAN_MS);
  const right = timingX(L.TIMING_SPAN_MS);
  ctx.fillRect(goodL, axisY, goodR - goodL + 1, 1, 1);
  /*
   * Dotted OUTWARD from the window's edges rather than on one phase across the
   * whole axis. A global phase can put a lit pixel hard against the solid run,
   * which reads as a window one or two pixels wider than it is — and the width
   * of that run is the one measurement on the bar.
   */
  for (let x = goodL - 2; x >= left; x -= 2) ctx.fillRect(x, axisY, 1, 1, 1);
  for (let x = goodR + 2; x <= right; x += 2) ctx.fillRect(x, axisY, 1, 1, 1);

  /* Zero, and nothing else that does not move. */
  ctx.fillRect(cx, markY, 1, 1, 1);

  if (!timing) return;
  const s = recentStats(timing, L.TIMING_RECENT_N);
  if (s.n === 0) return;

  const bins = histogram(timing, L.TIMING_HIST_BINS, L.TIMING_SPAN_MS, L.TIMING_RECENT_N);
  let peak = 0;
  for (let i = 0; i < bins.length; i++) if (bins[i] > peak) peak = bins[i];
  const scale = Math.max(peak, L.TIMING_HIST_MIN_SCALE);
  const binMs = (L.TIMING_SPAN_MS * 2) / L.TIMING_HIST_BINS;
  const half = L.TIMING_HIST_BIN_W >> 1;

  for (let i = 0; i < bins.length; i++) {
    if (!bins[i]) continue;
    /* At least one row for any bin that has hits in it: a column that rounded
     * away would be a hit the bar silently did not report. */
    const h = Math.max(1, Math.min(L.TIMING_HIST_ROWS,
      Math.round((bins[i] / scale) * L.TIMING_HIST_ROWS)));
    const centreMs = -L.TIMING_SPAN_MS + (i + 0.5) * binMs;
    const bx = timingX(centreMs) - half;
    ctx.fillRect(bx, baseline - h + 1, L.TIMING_HIST_BIN_W, h, 1);
  }

  /*
   * The mean, on the SAME ROW as zero and deliberately so: the gap between the
   * two is your average error, read off directly, and when you are on the beat
   * they merge — which is exactly the picture "on the beat" should make.
   */
  const mx = timingX(s.meanMs);
  ctx.fillRect(mx - 1, markY, 3, 1, 1);
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
