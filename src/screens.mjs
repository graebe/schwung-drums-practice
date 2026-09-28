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
import { drawHeader, drawList, drawPlot } from './chrome.mjs';
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
