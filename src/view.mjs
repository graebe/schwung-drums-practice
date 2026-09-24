/*
 * view.mjs — whole screens, composed from the two renderers.
 *
 * Every screen here is a pure function of (ctx, state). Nothing reads the
 * clock, nothing touches the host, nothing keeps state between calls — which
 * is what lets `tools/preview.mjs` dump any instant of any drill and the
 * rendering tests assert on the pixels of it.
 */

import * as L from './layout.mjs';
import * as SR from './staff_render.mjs';
import * as GR from './grid_render.mjs';
import * as B from './beam.mjs';
import { visibleEntries, pruneMarkers } from './scoring.mjs';
import { visibleBars, beatToX, barBeatOf, chartTotalBeats } from './chart.mjs';
import { voiceById, voicesInChart } from './kit.mjs';
import { diatonicToY } from './notation.mjs';
import { recentOffsets, recentStats, stats, perVoice, voicesBySpread, verdict } from './timing.mjs';
import { runStats as runStatsOf } from './scoring.mjs';

/* ---- Header ------------------------------------------------------------- */
/*
 * Left: the drill. Middle: where you are. Right: the two numbers.
 *
 * The mean and sigma live in the header rather than on the summary because
 * they are the thing you correct WHILE playing — a number you only see when
 * you stop is a report card, not feedback.
 */
export function drawHeader(ctx, s) {
  const bar = barBeatOf(s.chart, Math.max(0, s.songBeats), s.looping);
  const left = s.title || '';
  const mid = s.looping ? `${bar.bar}/${bar.bars}` : `${bar.bar}.${bar.beat}`;
  const t = s.timing ? recentStats(s.timing, 48) : null;
  const right = t && t.n > 0
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

export function drawTimingBar(ctx, timing, windows) {
  const y = L.TIMING_BAR_Y;
  const mid = y + 3;
  const cx = L.TIMING_CENTER_X;

  /* The axis, with the good window drawn as a brighter run either side of
   * zero — so "inside the window" is a place on the bar, not a number to
   * remember. */
  ctx.fillRect(cx - L.TIMING_HALF_W, mid, L.TIMING_HALF_W * 2 + 1, 1, 1);
  if (windows) {
    const gx = timingX(windows.goodMs) - cx;
    for (let dx = -gx; dx <= gx; dx += 2) ctx.fillRect(cx + dx, mid - 1, 1, 1, 1);
  }
  for (let t = L.TIMING_TICK_MS; t <= L.TIMING_SPAN_MS; t += L.TIMING_TICK_MS) {
    ctx.fillRect(timingX(t), mid - 1, 1, 3, 1);
    ctx.fillRect(timingX(-t), mid - 1, 1, 3, 1);
  }
  ctx.fillRect(cx, y, 1, L.TIMING_BAR_H, 1);

  if (!timing) return;
  const dots = recentOffsets(timing, L.TIMING_DOTS);
  for (let i = 0; i < dots.length; i++) {
    /* Newest at the bottom, so the cloud drifts as you drift. */
    const row = mid + 2 + (i % 2);
    ctx.fillRect(timingX(dots[i]), row, 1, 1, 1);
  }
  const s = recentStats(timing, 48);
  if (s.n > 0) {
    const mx = timingX(s.meanMs);
    ctx.fillRect(mx, mid - 3, 1, 2, 1);
    ctx.fillRect(mx - 1, mid - 3, 3, 1, 1);
  }
}

/* ---- The reading view --------------------------------------------------- */
export function drawReadingView(ctx, s) {
  ctx.clear();
  drawHeader(ctx, s);

  const px = s.pxPerBeat || L.PX_PER_BEAT_DEFAULT;
  const visible = visibleEntries(s.run, s.songBeats, px);
  const endBeat = s.looping ? Infinity : chartTotalBeats(s.chart);

  if (s.view === 'grid') {
    drawGridBody(ctx, s, visible, px, endBeat);
  } else {
    drawStaffBody(ctx, s, visible, px, endBeat);
  }

  drawStickingLane(ctx, s, visible, px);
  drawTimingBar(ctx, s.run && s.run.timing, s.run && s.run.windows);
}

function drawStaffBody(ctx, s, visible, px, endBeat) {
  SR.drawStaff(ctx);
  SR.drawClef(ctx);
  for (const bar of visibleBars(s.chart, s.songBeats, px, endBeat)) {
    SR.drawBarLine(ctx, bar.x);
  }
  SR.drawHitLine(ctx, s.beatFlash);

  const gb = B.groupBeats(s.chart);
  for (let i = 0; i < visible.length; i++) {
    const next = visible[i + 1];
    /* How much room this head has before the next column. The last one on
     * screen is given a full-size gap rather than the distance to the edge,
     * so a note does not change size as it scrolls off. */
    const spacingPx = next ? next.x - visible[i].x : L.TIGHT_SPACING_PX;
    const beams = B.beamsAt(s.run.entries, visible[i].index, gb);
    SR.drawStack(ctx, visible[i], { dynamics: s.dynamics, spacingPx, beams });
  }
  SR.drawBeams(ctx, visible, s.run.entries, gb);

  /* Where the pads actually went down. Drawn last so a marker is never hidden
   * under the notehead it is being compared with. */
  if (s.run.markers) {
    for (const m of s.run.markers) {
      const v = voiceById(m.voice);
      if (!v) continue;
      const x = beatToX(m.beat, s.songBeats, px);
      if (x < L.DESPAWN_X || x >= L.SCREEN_W) continue;
      SR.drawPlayedMarker(ctx, x, diatonicToY(v.diatonic));
    }
  }
}

function drawGridBody(ctx, s, visible, px, endBeat) {
  const voices = s.voices || voicesInChart(s.chart);
  const laneList = GR.lanes(voices);
  GR.drawLanes(ctx, laneList);
  for (const bar of visibleBars(s.chart, s.songBeats, px, endBeat)) {
    GR.drawBarLine(ctx, laneList, bar.x);
  }
  for (const item of visible) GR.drawStack(ctx, item, laneList);
  if (s.run.markers) {
    for (const m of s.run.markers) {
      const lane = GR.laneOf(laneList, m.voice);
      if (!lane) continue;
      GR.drawMarker(ctx, beatToX(m.beat, s.songBeats, px), lane);
    }
  }
  GR.drawPlayhead(ctx, laneList, s.beatFlash);
}

/*
 * R and L under the notes. Only drawn when the drill actually asks for a
 * sticking — a groove has no written hand, and printing one would invent a
 * rule the player is then measured against.
 */
function drawStickingLane(ctx, s, visible, px) {
  ctx.fillRect(0, L.NAME_RULE_Y, L.SCREEN_W, 1, 1);
  if (!s.run || s.run.sticking === 'off') return;
  for (let i = 0; i < visible.length; i++) {
    const { entry, x } = visible[i];
    const note = entry.notes[0];
    if (!note || !note.wantHand) continue;
    const next = visible[i + 1];
    const limit = next ? Math.max(0, next.x - x - 1) : L.SCREEN_W - x;
    SR.drawSticking(ctx, x, note.wantHand, note.handOk !== false, Math.min(limit, 14));
  }
}

export { pruneMarkers };

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

export function drawList(ctx, { title, items, selected, right }) {
  ctx.clear();
  ctx.text(1, 0, title || '', 1);
  if (right) ctx.text(L.SCREEN_W - ctx.textWidth(right) - 1, 0, right, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  const top = listWindow(items.length, selected);
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

/* ---- Ready -------------------------------------------------------------- */
export function drawReady(ctx, s) {
  ctx.clear();
  drawHeader(ctx, { ...s, songBeats: 0 });
  const name = s.chart.name || '';
  ctx.text(2, 12, name.slice(0, 20), 1);
  ctx.text(2, 21, `${s.bpm} bpm  ${s.looping ? `${s.loopBars} bar loop` : 'one pass'}`, 1);
  if (s.warning) ctx.text(2, 30, s.warning.slice(0, 20), 1);

  SR.drawPlayGlyph(ctx, 6, 40, 7);
  ctx.text(16, 40, 'listen', 1);
  SR.drawRecordGlyph(ctx, 6, 50, 7);
  ctx.text(16, 50, 'practise', 1);
  const out = s.outLabel || 'kit';
  ctx.text(L.SCREEN_W - ctx.textWidth(out) - 2, 50, out, 1);
}

/* ---- Summary ------------------------------------------------------------ */
/*
 * The four axes, separately, and then the limbs.
 *
 * "72%" does not tell a drummer what to practise, so accuracy never appears
 * alone: the spread leads, the bias sits beside it, and the errors that are
 * NOT timing get their own line so a clean-but-mis-stuck run reads as what it
 * is.
 */
export function drawSummary(ctx, s) {
  ctx.clear();
  const t = stats(s.run.timing);
  const st = runStatsOf(s.run);

  ctx.text(1, 0, 'RESULT', 1);
  const acc = st.total ? `${Math.round(st.accuracy * 100)}%` : '--';
  ctx.text(L.SCREEN_W - ctx.textWidth(acc) - 1, 0, acc, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  /* Sigma leads: a tight player who sits late has one easy thing to fix, a
   * scattered one does not. */
  const big = `${Math.round(t.sdMs)}`;
  SR.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  const w = SR.bigTextWidth(big, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 3, L.RESULT_BIG_Y + 8, 'ms spread', 1);
  const bias = `${t.meanMs >= 0 ? '+' : ''}${Math.round(t.meanMs)}ms`;
  ctx.text(L.SCREEN_W - ctx.textWidth(bias) - 1, L.RESULT_BIG_Y, bias, 1);
  const v = verdict(t, s.tightMs || 30);
  ctx.text(L.SCREEN_W - ctx.textWidth(v) - 1, L.RESULT_BIG_Y + 8, v, 1);

  const errs = [];
  if (st.misses) errs.push(`${st.misses} missed`);
  if (st.stickErrors) errs.push(`${st.stickErrors} sticking`);
  if (st.dynErrors) errs.push(`${st.dynErrors} dynamics`);
  ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_B_Y, (errs.join('  ') || 'clean').slice(0, 21), 1);

  /* The limbs, worst first — the loosest one is the one to go and practise. */
  const pv = perVoice(s.run.timing);
  const order = voicesBySpread(s.run.timing).slice(0, L.VOICE_TABLE_MAX_ROWS);
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const y = L.VOICE_TABLE_Y + 16 + i * L.VOICE_TABLE_ROW_H;
    if (y + L.TEXT_H > L.SCREEN_H) break;
    const voice = voiceById(id);
    const row = `${voice ? voice.short : id} ${pv[id].meanMs >= 0 ? '+' : ''}${Math.round(pv[id].meanMs)}`;
    ctx.text(L.RESULT_LEFT_X, y, row, 1);
    ctx.text(40, y, `s${Math.round(pv[id].sdMs)}`, 1);
    /* A bar per limb, so the worst is obvious without reading the numbers. */
    const bw = Math.min(58, Math.round((pv[id].sdMs / L.PLOT_SIGMA_FULL_MS) * 58));
    ctx.fillRect(66, y + 2, Math.max(1, bw), 3, 1);
  }
}

/* ---- Ladder ------------------------------------------------------------- */
export function drawLadder(ctx, s) {
  ctx.clear();
  ctx.text(1, 0, 'LADDER', 1);
  const rung = `${s.ladder.rungs}`;
  ctx.text(L.SCREEN_W - ctx.textWidth(rung) - 1, 0, rung, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  const big = `${s.ladder.bpm}`;
  const w = SR.bigTextWidth(big, L.RESULT_BIG_SCALE);
  SR.drawBigText(ctx, (L.SCREEN_W - w) >> 1, 12, big, L.RESULT_BIG_SCALE);
  ctx.text((L.SCREEN_W - ctx.textWidth('bpm')) >> 1, 29, 'bpm', 1);

  if (s.ladder.failed) {
    const score = `best clean ${s.ladder.topClean}`;
    ctx.text((L.SCREEN_W - ctx.textWidth(score)) >> 1, 40, score, 1);
    if (s.reason) ctx.text((L.SCREEN_W - ctx.textWidth(s.reason)) >> 1, 49, s.reason, 1);
  } else {
    const bars = `${s.barsDone || 0}/${s.ladder.bars} bars clean`;
    ctx.text((L.SCREEN_W - ctx.textWidth(bars)) >> 1, 40, bars, 1);
    /* A rung of blocks, one per climb, so progress is visible without
     * remembering what the tempo was when you started. */
    for (let i = 0; i < Math.min(s.ladder.rungs, 24); i++) {
      ctx.fillRect(4 + i * 5, 52, 3, 5, 1);
    }
  }
}

/* ---- Quiz --------------------------------------------------------------- */
export function drawQuiz(ctx, s) {
  ctx.clear();
  const q = s.quiz;
  ctx.text(1, 0, s.title || 'QUIZ', 1);
  const prog = s.progress || '';
  ctx.text(L.SCREEN_W - ctx.textWidth(prog) - 1, 0, prog, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  if (q.mode === 'pick') {
    for (let i = 0; i < q.options.length; i++) {
      const y = 13 + i * 11;
      const label = s.labelFor(q.options[i]);
      if (i === q.choice) {
        ctx.drawRect(2, y - 2, L.SCREEN_W - 4, L.TEXT_H + 3, 1);
      }
      ctx.text(6, y, label.slice(0, 18), 1);
      /* A struck-out option stays on screen: seeing what you ruled out is
       * part of what the hint teaches. */
      if (s.isEliminated(i)) ctx.fillRect(6, y + 3, ctx.textWidth(label.slice(0, 18)), 1, 1);
    }
  } else {
    /* guess: the notation, on its own staff. hear: a question mark until you
     * get it, then the notation is revealed — which is where the teaching is. */
    SR.drawStaff(ctx);
    SR.drawClef(ctx);
    const show = q.mode === 'guess' || q.revealed;
    if (show) {
      const v = voiceById(q.prompt);
      if (v) {
        const y = diatonicToY(v.diatonic);
        SR.drawLedgers(ctx, 70, y);
        SR.drawNote(ctx, 70, y, v.head, 'pending', 'normal', 16);
      }
    } else {
      ctx.text(66, 24, '?', 1);
    }
    if (q.revealed) {
      const name = s.labelFor(q.prompt);
      ctx.text((L.SCREEN_W - ctx.textWidth(name)) >> 1, L.NAME_LANE_Y - 8, name, 1);
    }
  }

  const streak = `streak ${q.streak}`;
  ctx.text(1, L.SCREEN_H - L.TEXT_H, streak, 1);
  const help = s.hintsLeft > 0 ? 'REC help' : '';
  if (help) ctx.text(L.SCREEN_W - ctx.textWidth(help) - 1, L.SCREEN_H - L.TEXT_H, help, 1);
}

/* ---- Quiz result -------------------------------------------------------- */
export function drawResult(ctx, s) {
  ctx.clear();
  ctx.text(1, 0, 'ROUND', 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  const rate = `${Math.round(s.rate)}`;
  SR.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, rate, L.RESULT_BIG_SCALE);
  const w = SR.bigTextWidth(rate, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 3, L.RESULT_BIG_Y + 8, '/min', 1);
  if (s.best) {
    const best = `best ${Math.round(s.best)}`;
    ctx.text(L.SCREEN_W - ctx.textWidth(best) - 1, L.RESULT_BIG_Y, best, 1);
  }
  ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_A_Y, `${Math.round(s.errorRate * 100)}% wrong`, 1);
  if (s.hints) ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_B_Y, `${s.hints} hints`, 1);
  drawPlot(ctx, L.RESULT_PLOT, s.series || []);
}

/* ---- Progress ----------------------------------------------------------- */
/*
 * Top clean tempo as a line, timing spread as bars beneath it — so you can
 * see whether a faster tempo came at the cost of holding it together.
 *
 * A full-height bar is a FIXED number of milliseconds, not the worst in the
 * series: scaling to the data would redraw the same history differently every
 * time a bad round dropped off the end, and two visits have to be comparable.
 */
export function drawProgress(ctx, s) {
  ctx.clear();
  ctx.text(1, 0, 'PROGRESS', 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
  ctx.text(1, L.PROGRESS_TITLE_Y, (s.drillLabel || '').slice(0, 21), 1);
  drawPlot(ctx, L.PROGRESS_PLOT, s.records || []);
  const sum = s.summary || { best: 0, last: 0 };
  ctx.text(1, L.PROGRESS_ROW_Y, `best ${sum.best}`, 1);
  const last = `last ${sum.last}`;
  ctx.text(L.SCREEN_W - ctx.textWidth(last) - 1, L.PROGRESS_ROW_Y, last, 1);
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

/* ---- Clock -------------------------------------------------------------- */
/*
 * While the click is silent the header is replaced by how far you have
 * drifted, because that is the only number the drill is about — and it is
 * shown live rather than at the end, so you can hear yourself being wrong
 * and pull it back.
 */
export function drawClockBanner(ctx, { muted, drift, barsLeft }) {
  const label = muted ? 'ON YOUR OWN' : 'LISTEN';
  ctx.fillRect(0, 0, L.SCREEN_W, L.HEADER_H, 0);
  ctx.text(1, 0, label, 1);
  if (muted) {
    const d = `${drift >= 0 ? '+' : ''}${Math.round(drift)}ms`;
    ctx.text(L.SCREEN_W - ctx.textWidth(d) - 1, 0, d, 1);
  } else if (barsLeft > 0) {
    const b = `${barsLeft}`;
    ctx.text(L.SCREEN_W - ctx.textWidth(b) - 1, 0, b, 1);
  }
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
}

/* ---- Count-in ----------------------------------------------------------- */
export function drawCountIn(ctx, digit) {
  const text = String(digit);
  const w = SR.bigTextWidth(text, 4);
  ctx.fillRect(((L.SCREEN_W - w) >> 1) - 4, 16, w + 8, 5 * 4 + 6, 0);
  SR.drawBigText(ctx, (L.SCREEN_W - w) >> 1, 19, text, 4);
}
