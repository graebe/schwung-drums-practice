// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * screens.mjs — every screen that is not the scrolling chart.
 *
 * The list, ready, summary, ladder, quiz, result, progress and the error
 * screen. They share only the layout and the furniture in chrome.mjs; none of
 * them knows anything about the scroll, and view.mjs knows nothing about
 * them.
 */

import * as L from './layout.mjs';
import * as SR from './staff_render.mjs';
import { drawHeader, drawList, drawPlot, drawHint, fitText } from './chrome.mjs';
import { drawMark, MARK_W } from './glyphs.mjs';
import { voiceById } from './kit.mjs';
import { diatonicToY } from './notation.mjs';

export { drawList, drawHint };

/* ---- Summary ------------------------------------------------------------ */
/*
 * The end of a take, as Piano Practice ends an exercise: the number big, what
 * qualifies it beside it, and under it the chart of every recent take of THIS
 * drill — so the number is read against where you were, not on its own.
 *
 * The number is the one that decided the take. For a clean take it is the
 * speed it was played at, as a share of the written tempo: the same number
 * the chart and the list track. For a take that did not count it is how much
 * was right — the speed of a failed take is no score, and at the written
 * tempo it read 100 on every one of them. Beside it the two things that
 * decide whether it was clean — how much was right, and how tight — and
 * whichever one stopped it counting is drawn inverted. Under it, what cost
 * the most ("4 wrong hands"), or else the tempo and the loosest limb, the
 * one to go and practise.
 *
 * The DYNAMICS have the right end of that row to themselves whenever they
 * were judged — "dyn 30%" — because they are a second question, not part of
 * the first: a take is clean or not on its notes and time, and sounds as it
 * sounds. The left end keeps what stopped the take; on a take that counted it
 * says what to fix in the dynamics ("16 soft 74<83") — `dynAdvice`, empty
 * once they are good — and then the loosest limb again. One correction at a
 * time.
 *
 * s = { name, status, mark, clean, speed, accuracy, share, sdMs, meanMs,
 *       failAcc, failSd, cause, bpm, limb, dyn, dynAdvice, series, footer }
 *     — all worked out once, when the take ends
 *
 * An L0 take is the same screen with other words in it — it has no spread,
 * and its "right" is right FIRST TIME — so it brings its own side lines and
 * its own row (`sideA`, `sideB`, `rowLeft`), and leaves the layout alone.
 */
export const SUMMARY_PLOT = { x: 3, y: 35, w: L.SCREEN_W - 6, h: 19 };
const SIDE_A_Y = L.RESULT_BIG_Y;
const SIDE_B_Y = L.RESULT_BIG_Y + 8;

export function drawSummary(ctx, s) {
  ctx.clear();
  drawTitle(ctx, s.name || 'RESULT', s.status || '', s.mark);

  const counted = s.clean !== false;
  /* Floored, not rounded: 89.6% did not reach 90 and must not read as if it had. */
  const right = Math.floor((s.accuracy || 0) * 100);
  const big = `${counted ? Math.round(s.speed || 0) : right}`;
  SR.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  const w = SR.bigTextWidth(big, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 3, L.RESULT_BIG_Y + 8, '%', 1);
  const minX = L.RESULT_LEFT_X + w + 3 + ctx.textWidth('%') + 4;
  const bias = Math.round(s.meanMs || 0);
  const sideA = s.sideA !== undefined ? s.sideA
    : counted ? `${right}% right` : (s.failAcc ? `right, need ${s.share}` : 'right');
  sideText(ctx, SIDE_A_Y, sideA, minX, s.failAcc);
  const sideB = s.sideB !== undefined ? s.sideB
    : `s${Math.round(s.sdMs || 0)} ${bias >= 0 ? '+' : ''}${bias}ms`;
  sideText(ctx, SIDE_B_Y, sideB, minX, s.failSd);

  const judged = s.dyn !== undefined && s.dyn >= 0;
  if (judged) {
    const dyn = `dyn ${Math.round(s.dyn)}%`;
    const dw = ctx.textWidth(dyn);
    ctx.text(L.SCREEN_W - dw - 1, L.RESULT_ROW_A_Y, dyn, 1);
    const left = s.cause || s.dynAdvice || s.limb
      || (s.rowLeft !== undefined ? s.rowLeft : s.bpm ? `${Math.round(s.bpm)} bpm` : '');
    ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_A_Y,
      fit(ctx, left, L.SCREEN_W - dw - L.RESULT_LEFT_X - 5), 1);
  } else if (s.cause) {
    /* Centred, as the Ladder's reason is: a full line (progress.mjs
     * REASON_MAX) is 125px and does not fit from the left margin. */
    const cause = fit(ctx, s.cause, L.SCREEN_W - 2);
    ctx.text(Math.max(1, (L.SCREEN_W - ctx.textWidth(cause)) >> 1), L.RESULT_ROW_A_Y, cause, 1);
  } else {
    const row = s.rowLeft !== undefined ? s.rowLeft : s.bpm ? `${Math.round(s.bpm)} bpm` : '';
    ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_A_Y, row, 1);
    if (s.limb) ctx.text(L.SCREEN_W - ctx.textWidth(s.limb) - 1, L.RESULT_ROW_A_Y, s.limb, 1);
  }

  drawPercentPlot(ctx, SUMMARY_PLOT, s.series);
  drawHint(ctx, s.footer || 'CLICK next  REC again');
}

/* The header: a title fitted against a status on the right, with its mark. */
function drawTitle(ctx, title, status, mark) {
  const tw = status ? ctx.textWidth(status) : 0;
  const rw = tw + (mark ? MARK_W + (tw ? 2 : 0) : 0);
  ctx.text(1, 0, fit(ctx, title, L.SCREEN_W - rw - 6), 1);
  if (mark) drawMark(ctx, L.SCREEN_W - rw - 1, 1, mark, 1);
  if (status) ctx.text(L.SCREEN_W - tw - 1, 0, status, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
}

/* Right-aligned beside the headline, never reaching left of `minX`; inverted
 * when it is the reason the take did not count. */
function sideText(ctx, y, text, minX, inverted) {
  const t = fit(ctx, text, L.SCREEN_W - 2 - minX);
  const x = L.SCREEN_W - ctx.textWidth(t) - 2;
  if (inverted) ctx.fillRect(x - 1, y - 1, ctx.textWidth(t) + 2, L.TEXT_H + 1, 1);
  ctx.text(x, y, t, inverted ? 0 : 1);
}

/*
 * Percent per take, on a fixed scale with the line to reach ruled dotted
 * across it — 100% of the written tempo, or a quiz's pass mark. A clean take
 * is a filled dot and one that did not count an open one, so slow clean takes
 * climbing to the line read as what they are. Piano Practice's accuracy plot,
 * on a baseline rather than in a box, with the series one pixel in from every
 * edge so a 3x3 mark never hangs outside the rect.
 *   series = progress.mjs percentSeries(history, box.w - 2, box.h - 2, ...)
 */
export function drawPercentPlot(ctx, box, series) {
  ctx.fillRect(box.x, box.y + box.h, box.w, 1, 1);
  if (!series) return;
  const ox = box.x + 1;
  const oy = box.y + 1;
  for (let x = 0; x < box.w; x += 3) ctx.fillRect(box.x + x, oy + series.lineY, 1, 1, 1);
  const pts = series.points;
  for (let i = 1; i < pts.length; i++) {
    ctx.line(ox + pts[i - 1].x, oy + pts[i - 1].y, ox + pts[i].x, oy + pts[i].y, 1);
  }
  for (let i = 0; i < pts.length; i++) {
    const x = Math.max(box.x, Math.min(box.x + box.w - 3, ox + pts[i].x - 1));
    const y = Math.max(box.y, Math.min(box.y + box.h - 3, oy + pts[i].y - 1));
    if (pts[i].clean) {
      ctx.fillRect(x, y, 3, 3, 1);
    } else {
      ctx.fillRect(x, y, 3, 3, 0);
      ctx.drawRect(x, y, 3, 3, 1);
    }
  }
}

/*
 * The takes' dynamics, dotted, under the speed line it shares the box with:
 * dots, not a line, so the two can cross and still be told apart. Each take
 * is a single pixel with every other pixel dotted between them.
 */
export function drawDynamicsLine(ctx, box, dyn) {
  if (!dyn || !dyn.length) return;
  const ox = box.x + 1;
  const oy = box.y + 1;
  for (let i = 0; i < dyn.length; i++) {
    const a = dyn[i];
    ctx.fillRect(ox + a.x, oy + a.y, 1, 1, 1);
    const b = dyn[i + 1];
    if (!b) continue;
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let k = 2; k < steps; k += 2) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * k) / steps);
      ctx.fillRect(ox + x, oy + y, 1, 1, 1);
    }
  }
}

const fit = fitText;

/* A progress note: an optional mark, then its words. { mark, text } */
export function drawNote(ctx, x, y, note) {
  let tx = x;
  if (note.mark) {
    drawMark(ctx, x, y + 1, note.mark, 1);
    tx += MARK_W + 3;
  }
  ctx.text(tx, y, fit(ctx, note.text || '', L.SCREEN_W - tx - 1), 1);
}

/* ---- Pad map -------------------------------------------------------------- */
/*
 * The layout in force as a picture of the grid: 4 rows of 8 cells, each with
 * its voice's two letters, top row first as it sits under your hands, a rule
 * down the middle where the hands divide. The selected cell (Custom, while it
 * is edited) is drawn inverted.
 *
 * s = { title, right, grid (pad index -> voice id | null), selected: [index],
 *       footer }
 */
export const PADMAP = { x: 0, y: 10, cellW: 16, cellH: 11 };

export function drawPadMap(ctx, s) {
  ctx.clear();
  drawTitle(ctx, s.title || 'PAD MAP', s.right || '', null);
  const g = PADMAP;
  const sel = s.selected || [];
  for (let row = 0; row < 4; row++) {
    const y = g.y + (3 - row) * g.cellH;
    for (let col = 0; col < 8; col++) {
      const i = row * 8 + col;
      const x = g.x + col * g.cellW;
      const label = (s.grid && s.grid[i]) || '.';
      const on = sel.indexOf(i) >= 0;
      if (on) ctx.fillRect(x, y, g.cellW, g.cellH - 1, 1);
      ctx.text(x + ((g.cellW - ctx.textWidth(label)) >> 1), y + 2, label, on ? 0 : 1);
    }
  }
  /* The hands divide here: left half the left hand. */
  ctx.fillRect(g.x + 4 * g.cellW - 1, g.y, 1, 4 * g.cellH - 1, 1);
  drawHint(ctx, s.footer || '');
}

/* ---- Lesson card -------------------------------------------------------- */
/*
 * A short explanation before a practice (lessons.mjs): its title over a rule,
 * a page of text, and how to go on. `n/m` says there is more to read; the
 * footer says Click starts, so reading is never the price of playing.
 *
 * s = { title, lines, page, pages, footer }
 */
export const CARD_TEXT_Y = 10;

export function drawCard(ctx, s) {
  ctx.clear();
  const pages = s.pages || 1;
  drawTitle(ctx, s.title || '', pages > 1 ? `${(s.page || 0) + 1}/${pages}` : '', null);
  const lines = s.lines || [];
  for (let i = 0; i < lines.length; i++) ctx.text(1, CARD_TEXT_Y + i * L.TEXT_H, lines[i], 1);
  drawHint(ctx, s.footer || 'CLICK start');
}

/* ---- A page of text ------------------------------------------------------- */
/*
 * Help, the welcome and a tip (layout.mjs PAGE_*): five lines on a 9px pitch
 * under the title, scrolled by the jog when there are more, with the first
 * line shown and the count in the title's right — "1/23" — and a scrollbar.
 * The lines arrive fitted (help.mjs fitPage); this only draws them.
 *
 * s = { title, lines, top, footer, right }
 */
export function drawPage(ctx, s) {
  ctx.clear();
  const lines = s.lines || [];
  const rows = L.PAGE_ROWS;
  const top = Math.max(0, Math.min(s.top || 0, Math.max(0, lines.length - rows)));
  const more = lines.length > rows ? `${top + 1}/${lines.length}` : (s.right || '');
  drawTitle(ctx, s.title || '', more, null);
  for (let i = 0; i < rows && top + i < lines.length; i++) {
    const max = lines.length > rows ? L.PAGE_TEXT_PX : L.PAGE_FULL_PX;
    ctx.text(L.PAGE_TEXT_X, L.PAGE_TOP_Y + i * L.PAGE_LINE_H, fit(ctx, lines[top + i], max), 1);
  }
  if (lines.length > rows) {
    const band = rows * L.PAGE_LINE_H - 2;
    const h = Math.max(3, Math.round((rows / lines.length) * band));
    const y = L.PAGE_TOP_Y + Math.round((top / (lines.length - rows)) * (band - h));
    ctx.fillRect(L.SCREEN_W - 1, y, 1, h, 1);
  }
  drawHint(ctx, s.footer || '');
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
    if (s.reason) ctx.text((L.SCREEN_W - ctx.textWidth(s.reason)) >> 1, 48, s.reason, 1);
    if (s.note) drawNote(ctx, 1, L.SCREEN_H - L.TEXT_H, s.note);
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
const PICK_ROW_Y = 15;
const PICK_ROW_H = 12;
export function drawQuiz(ctx, s) {
  ctx.clear();
  const q = s.quiz;
  ctx.text(1, 0, s.title || 'QUIZ', 1);
  const prog = s.progress || '';
  ctx.text(L.SCREEN_W - ctx.textWidth(prog) - 1, 0, prog, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  if (q.mode === 'pick') {
    /*
     * One row per answer, as Piano Practice lists them: the answer on the
     * left, the colour of its pad on the right — the panel is one colour, so
     * the pad's colour is named rather than shown — and the jog's choice
     * inverted, as everywhere.
     */
    for (let i = 0; i < q.options.length; i++) {
      const y = PICK_ROW_Y + i * PICK_ROW_H;
      const selected = i === q.choice;
      const v = selected ? 0 : 1;
      if (selected) ctx.fillRect(0, y - 1, L.SCREEN_W, PICK_ROW_H, 1);
      const colour = s.colours ? s.colours[i % s.colours.length] : '';
      const cw = colour ? ctx.textWidth(colour) : 0;
      const label = fit(ctx, s.labelFor(q.options[i]), L.SCREEN_W - 8 - cw - (cw ? 6 : 0));
      ctx.text(4, y, label, v);
      if (colour) ctx.text(L.SCREEN_W - 4 - cw, y, colour, v);
      /* A struck-out option stays on screen, and its pad goes dark: seeing
       * what you ruled out is part of what the hint teaches. */
      if (s.isEliminated(i)) ctx.fillRect(2, y + 3, L.SCREEN_W - 4, 1, v);
    }
    drawHint(ctx, s.footer || (s.hintsLeft > 0 ? 'PAD answer  REC help' : 'PAD answer  CLICK ok'));
    return;
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
    /* Hear's first hint NAMES it and keeps the staff hidden: the name without
     * the picture, so the second hint (the pad) still has something to give. */
    if (q.revealed || (q.mode === 'hear' && q.hints >= 1)) {
      const name = s.labelFor(q.prompt);
      ctx.text((L.SCREEN_W - ctx.textWidth(name)) >> 1, L.SUMMARY_NAME_Y, name, 1);
    }
  }

  /* The streak over the hint line, at the left, clear of the name above. */
  ctx.text(1, L.UNDER_LANE_Y, `streak ${q.streak}`, 1);
  drawHint(ctx, s.footer || (s.hintsLeft > 0 ? 'PAD answer  REC help' : 'PAD answer'));
}

/* ---- Quiz result -------------------------------------------------------- */
export function drawResult(ctx, s) {
  ctx.clear();
  ctx.text(1, 0, s.isBest ? 'BEST YET' : 'ROUND', 1);
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
  /* The round's score for the path, on the right of the hints. */
  if (s.note) {
    const w = ctx.textWidth(s.note.text) + (s.note.mark ? MARK_W + 3 : 0);
    drawNote(ctx, L.SCREEN_W - w - 1, L.RESULT_ROW_B_Y, s.note);
  }
  drawPlot(ctx, L.RESULT_PLOT, s.series || []);
  drawHint(ctx, s.footer || '');
}

/* ---- Progress ----------------------------------------------------------- */
/*
 * One drill's takes on the same chart the result draws, with its best in the
 * header and its last take spelled out under it.
 *
 * s = { title, best, bpm, plays, done, isQuiz, last, series, footer }
 */
export function drawProgress(ctx, s) {
  ctx.clear();
  drawTitle(ctx, s.title || 'PROGRESS', s.best ? `${s.best}%` : '', s.done ? 'done' : null);
  const box = L.PROGRESS_PLOT;
  drawPercentPlot(ctx, box, s.series);
  if (s.series) drawDynamicsLine(ctx, box, s.series.dyn);
  if (!s.series || !s.series.points.length) {
    const none = 'not played yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(none)) >> 1, box.y + (box.h >> 1) - 3, none, 1);
  }
  const takes = `${s.plays} ${s.plays === 1 ? 'take' : 'takes'}`;
  const bestLine = s.isQuiz ? `best ${s.best}%` : s.best ? `best ${s.best}% ${s.bpm}bpm` : 'never clean';
  ctx.text(1, L.PROGRESS_ROW_Y, bestLine, 1);
  ctx.text(L.SCREEN_W - ctx.textWidth(takes) - 1, L.PROGRESS_ROW_Y, takes, 1);
  drawHint(ctx, s.footer || '');
}

/*
 * The long view, as Piano Practice draws it: every drill learned, as a line
 * that rises by one at each ✓, along real time. Flat stretches are weeks off;
 * steep ones are where it clicked.
 *
 * s = { title, done, count, timeline, footer }
 */
export function drawOverview(ctx, s) {
  ctx.clear();
  drawTitle(ctx, (s.title || 'OVERALL').toUpperCase(), `${s.done}/${s.count}`, null);
  const box = L.PROGRESS_PLOT;
  ctx.fillRect(box.x, box.y + box.h, box.w, 1, 1);
  const pts = s.timeline ? s.timeline.points : [];
  if (!pts.length) {
    const msg = 'nothing learned yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(msg)) >> 1, box.y + (box.h >> 1) - 3, msg, 1);
  } else {
    /* A step line: flat until the next drill is learned, then up. */
    let prevX = box.x;
    let prevY = box.y + box.h - 1;
    for (let i = 0; i < pts.length; i++) {
      const x = box.x + pts[i].x;
      const y = box.y + pts[i].y;
      ctx.line(prevX, prevY, x, prevY, 1);
      ctx.line(x, prevY, x, y, 1);
      prevX = x;
      prevY = y;
    }
    ctx.line(prevX, prevY, box.x + box.w - 1, prevY, 1);
  }
  const learned = `${s.done} learned of ${s.count}`;
  ctx.text(1, L.PROGRESS_ROW_Y, fit(ctx, learned, L.SCREEN_W - 2), 1);
  drawHint(ctx, s.footer || '');
}

/* ---- Failure ------------------------------------------------------------ */
/*
 * The screen you get instead of a frozen one.
 *
 * A module that wedges without saying why cannot be fixed: the first time
 * this one did, it left nothing in the log but its own successful init, and
 * the only way out was a chord the player had to be told. So every failure
 * now lands HERE — the message on screen, the way out printed under it, and
 * the same text written to crash.log for whoever has SSH.
 *
 * `where` is the callback that threw, which is most of the diagnosis.
 */
export function drawError(ctx, { where, message, count, safeMode }) {
  ctx.clear();
  ctx.text(1, 0, safeMode ? 'STOPPED' : 'ERROR', 1);
  const n = `x${count}`;
  ctx.text(L.SCREEN_W - ctx.textWidth(n) - 1, 0, n, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  ctx.text(1, 11, String(where || '?').slice(0, 21), 1);
  /* The message, wrapped by hand: it is the one thing worth reading and it
   * must not be truncated to the first word. */
  const msg = String(message || 'unknown');
  let y = 20;
  for (let i = 0; i < msg.length && y <= 37; i += 21) {
    ctx.text(1, y, msg.slice(i, i + 21), 1);
    y += 8;
  }

  ctx.fillRect(0, 45, L.SCREEN_W, 1, 1);
  ctx.text(1, 48, 'BACK to close', 1);
  /* The host's hard escape, printed where a stuck player can read it. */
  ctx.text(1, 56, 'stuck: SHIFT+VOL+JOG', 1);
}
