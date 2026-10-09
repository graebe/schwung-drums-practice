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
import { drawHeader, drawList, drawPlot, fitText } from './chrome.mjs';
import { drawMark, MARK_W } from './glyphs.mjs';
import { stats, perVoice, voicesBySpread, verdict } from './timing.mjs';
import { runStats as runStatsOf } from './scoring.mjs';
import { voiceById } from './kit.mjs';
import { diatonicToY } from './notation.mjs';

export { drawList };

/* ---- Summary ------------------------------------------------------------ */
/*
 * The four axes, separately, and then the limbs.
 *
 * "72%" does not tell a drummer what to practise, so accuracy never appears
 * alone: the spread leads, the bias sits beside it, and the errors that are
 * NOT timing get their own line so a clean-but-mis-stuck run reads as what it
 * is.
 */
/*
 * The end of a take. What it was and how fast in the header; the spread, big,
 * because it is the number to bring down; the bias and a word for it beside
 * it; what went wrong; the two loosest limbs; and the drill's recent takes as
 * a strip of spread bars, this one last, so the number is read against where
 * you were. The bottom line says what each button does next.
 *
 * s = { run, tightMs, isBest, name, bpm, history, recorded, footer, note }
 *
 * `note` is what the take did to the drill's progress — "clean 85%  best
 * 90%", or why it did not count — and takes the second limb's line: the
 * loosest limb is the one to practise, and the note is the one to read.
 */
export const SUMMARY_STRIP = { x: 3, y: 49, w: L.SCREEN_W - 6, h: 6 };

export function drawSummary(ctx, s) {
  ctx.clear();
  const t = stats(s.run.timing);
  const st = runStatsOf(s.run);

  const right = s.bpm ? `${Math.round(s.bpm)} bpm` : '';
  const rw = right ? ctx.textWidth(right) : 0;
  ctx.text(1, 0, fit(ctx, s.name || 'RESULT', L.SCREEN_W - rw - 6), 1);
  if (right) ctx.text(L.SCREEN_W - rw - 1, 0, right, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  /* Sigma leads: a tight player who sits late has one easy thing to fix, a
   * scattered one does not. */
  const big = `${Math.round(t.sdMs)}`;
  SR.drawBigText(ctx, L.RESULT_LEFT_X, L.RESULT_BIG_Y, big, L.RESULT_BIG_SCALE);
  const w = SR.bigTextWidth(big, L.RESULT_BIG_SCALE);
  ctx.text(L.RESULT_LEFT_X + w + 3, L.RESULT_BIG_Y + 8, 'ms', 1);
  const acc = st.total ? `${Math.round(st.accuracy * 100)}%` : '--';
  const bias = `${t.meanMs >= 0 ? '+' : ''}${Math.round(t.meanMs)}ms  ${acc}`;
  ctx.text(L.SCREEN_W - ctx.textWidth(bias) - 1, L.RESULT_BIG_Y, bias, 1);
  const v = verdict(t, s.tightMs || 30);
  ctx.text(L.SCREEN_W - ctx.textWidth(v) - 1, L.RESULT_BIG_Y + 8, v, 1);

  const errs = [];
  if (st.misses) errs.push(`${st.misses} missed`);
  if (st.stickErrors) errs.push(`${st.stickErrors} stick`);
  if (st.dynErrors) errs.push(`${st.dynErrors} dyn`);
  const tag = s.isBest ? 'BEST YET' : s.recorded === false ? 'not kept' : '';
  const tw = tag ? ctx.textWidth(tag) : 0;
  ctx.text(L.RESULT_LEFT_X, L.RESULT_ROW_A_Y,
    fit(ctx, errs.join(' ') || 'clean', L.SCREEN_W - L.RESULT_LEFT_X - tw - 6), 1);
  if (tag) ctx.text(L.SCREEN_W - tw - 1, L.RESULT_ROW_A_Y, tag, 1);

  /* The two loosest limbs — the worst first is the one to go and practise. */
  const pv = perVoice(s.run.timing);
  const order = voicesBySpread(s.run.timing).slice(0, s.note ? 1 : 2);
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const y = L.RESULT_ROW_B_Y + i * L.VOICE_TABLE_ROW_H;
    const voice = voiceById(id);
    const row = `${voice ? voice.short : id} ${pv[id].meanMs >= 0 ? '+' : ''}${Math.round(pv[id].meanMs)}`;
    ctx.text(L.RESULT_LEFT_X, y, row, 1);
    ctx.text(40, y, `s${Math.round(pv[id].sdMs)}`, 1);
    const bw = Math.min(58, Math.round((pv[id].sdMs / L.PLOT_SIGMA_FULL_MS) * 58));
    ctx.fillRect(66, y + 2, Math.max(1, bw), 3, 1);
  }

  if (s.note) drawNote(ctx, L.RESULT_LEFT_X, L.RESULT_ROW_B_Y + L.VOICE_TABLE_ROW_H, s.note);

  drawSpreadStrip(ctx, SUMMARY_STRIP, s.history || []);
  const hint = s.footer || 'REC again  CLICK next';
  ctx.text((L.SCREEN_W - ctx.textWidth(hint)) >> 1, L.SCREEN_H - L.TEXT_H, hint, 1);
}

/* Recent takes as spread bars, oldest left: shorter is tighter. A full bar is
 * PLOT_SIGMA_FULL_MS, a fixed ceiling, so two visits draw the same history
 * the same way. */
export function drawSpreadStrip(ctx, box, records) {
  ctx.fillRect(box.x, box.y + box.h, box.w, 1, 1);
  if (!records.length) return;
  const n = Math.min(records.length, Math.floor(box.w / 3));
  const use = records.slice(records.length - n);
  for (let i = 0; i < use.length; i++) {
    const frac = Math.min(1, (use[i].sd || 0) / L.PLOT_SIGMA_FULL_MS);
    const h = Math.max(1, Math.round(frac * box.h));
    const x = box.x + box.w - (use.length - i) * 3;
    ctx.fillRect(x, box.y + box.h - h, 2, h, 1);
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
    /* Hear's first hint NAMES it and keeps the staff hidden: the name without
     * the picture, so the second hint (the pad) still has something to give. */
    if (q.revealed || (q.mode === 'hear' && q.hints >= 1)) {
      const name = s.labelFor(q.prompt);
      ctx.text((L.SCREEN_W - ctx.textWidth(name)) >> 1, L.SUMMARY_NAME_Y, name, 1);
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
}

/* ---- Progress ----------------------------------------------------------- */
/*
 * One drill's takes: the clean speed of each, oldest left, against the line
 * to reach — 100% of the written tempo, or a quiz's pass mark. A clean take
 * is a filled dot, one that did not count an open one, so a run of slow clean
 * takes climbing to the line reads as what it is.
 *
 * The scale is FIXED (progress.mjs percentSeries): two visits to the same
 * drill must draw the same history the same way.
 *
 * s = { title, best, bpm, plays, done, isQuiz, last, series }
 */
export function drawProgress(ctx, s) {
  ctx.clear();
  const right = s.best ? `${s.best}%` : '';
  const tw = right ? ctx.textWidth(right) : 0;
  const rw = tw + (s.done ? MARK_W + (tw ? 2 : 0) : 0);
  ctx.text(1, 0, fit(ctx, s.title || 'PROGRESS', L.SCREEN_W - rw - 6), 1);
  if (s.done) drawMark(ctx, L.SCREEN_W - rw - 1, 1, 'done', 1);
  if (right) ctx.text(L.SCREEN_W - ctx.textWidth(right) - 1, 0, right, 1);
  ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);

  const box = L.PROGRESS_PLOT;
  ctx.drawRect(box.x, box.y, box.w, box.h, 1);
  const ox = box.x + 1;
  const oy = box.y + 1;
  /* The line to reach, dotted so it never reads as a take. */
  for (let x = 0; x < box.w - 2; x += 3) ctx.fillRect(ox + x, oy + s.series.lineY, 1, 1, 1);
  const pts = s.series.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) ctx.line(ox + pts[i - 1].x, oy + pts[i - 1].y, ox + p.x, oy + p.y, 1);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = Math.max(ox, Math.min(ox + box.w - 5, ox + p.x - 1));
    const y = Math.max(oy, Math.min(oy + box.h - 5, oy + p.y - 1));
    if (p.clean) ctx.fillRect(x, y, 3, 3, 1);
    else {
      ctx.fillRect(x, y, 3, 3, 0);
      ctx.drawRect(x, y, 3, 3, 1);
    }
  }
  if (!pts.length) {
    const none = 'not played yet';
    ctx.text((L.SCREEN_W - ctx.textWidth(none)) >> 1, box.y + (box.h >> 1) - 3, none, 1);
  }

  const takes = `${s.plays} ${s.plays === 1 ? 'take' : 'takes'}`;
  const bestLine = s.isQuiz ? `best ${s.best}%` : s.best ? `best ${s.best}% ${s.bpm}bpm` : 'never clean';
  ctx.text(1, L.PROGRESS_ROW_Y, bestLine, 1);
  ctx.text(L.SCREEN_W - ctx.textWidth(takes) - 1, L.PROGRESS_ROW_Y, takes, 1);
  if (s.last) {
    const l = s.last;
    const line = s.isQuiz ? `last ${l[1]}%` : `last ${l[1]}%  ${l[2]}% right  s${l[3]}`;
    ctx.text(1, L.SCREEN_H - L.TEXT_H, fit(ctx, line, L.SCREEN_W - 2), 1);
  }
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
