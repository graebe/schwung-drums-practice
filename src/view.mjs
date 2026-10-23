// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * view.mjs — the scrolling reading view, and nothing else.
 *
 * Every screen here is a pure function of (ctx, state). Nothing reads the
 * clock, nothing touches the host, nothing keeps state between calls — which
 * is what lets `tools/preview.mjs` dump any instant of any drill and the
 * rendering tests assert on the pixels of it.
 *
 * The eight screens that are NOT the chart live in screens.mjs, and the
 * furniture both use lives in chrome.mjs.
 *
 * This file re-exports both, deliberately: ui.js and the tests draw from ONE
 * place, and the split stays an internal matter. The dependency runs strictly
 * view -> screens -> chrome, so neither renderer reaches into the other —
 * which is the whole reason for the shared leaf.
 */

import * as L from './layout.mjs';
import * as SR from './staff_render.mjs';
import * as GR from './grid_render.mjs';
import * as B from './beam.mjs';
import { visibleEntries, runProgress, blockingNotes, handsWritten } from './scoring.mjs';
import { visibleBars, rulerBars, beatToX, practiceBeats } from './chart.mjs';
import { voiceById, voicesInChart } from './kit.mjs';
import { diatonicToY } from './notation.mjs';
import { drawHeader, drawFooter, drawHint, drawCountIn, drawBarRuler, drawLaneCallout, drawReadyBox } from './chrome.mjs';

/* Re-exported so ui.js and the tests have one place to draw from. */
export { drawHeader, drawFooter, drawHint, drawCountIn, drawBarRuler };
export { pruneMarkers } from './scoring.mjs';
export { drawList, listWindow, pageTop, LIST_ROWS, drawPlot } from './chrome.mjs';
export * from './screens.mjs';
export { drawUntimedView, drawUntimedReady, pageGeometry, pageBar } from './page_view.mjs';

/* ---- The reading view --------------------------------------------------- */
/* `boxUp`: the ready box is over the chart, and the under lane's bar
 * numbers are left out — one beside it would only crowd its edge. */
export function drawReadingView(ctx, s, boxUp = false) {
  ctx.clear();
  drawHeader(ctx, s);

  const px = s.pxPerBeat || L.PX_PER_BEAT_DEFAULT;
  const visible = visibleEntries(s.run, s.songBeats, px);
  const endBeat = s.run ? s.run.endBeat : practiceBeats(s.chart);

  /* Computed once: the chart draws a line at each bar, the lane under it draws
   * a tick and a number at the same x. Two lists would be two chances to
   * disagree about where a bar starts. */
  const bars = visibleBars(s.chart, s.songBeats, px, endBeat);

  if (s.view === 'grid') {
    drawGridBody(ctx, s, visible, px, bars);
  } else {
    drawStaffBody(ctx, s, visible, px, bars);
  }

  drawUnderLane(ctx, s, visible, rulerBars(s.chart, s.songBeats, px, endBeat), !boxUp);
  /* How far through, and hits/misses so far — as in the piano trainer. */
  /* `progress` is the caller's when the run is endless: the Ladder's rung, the
   * Clock's rounds. Otherwise it is the run's own. */
  const progress = s.progress !== undefined ? s.progress
    : s.run ? runProgress(s.run, s.songBeats) : 0;
  /* The hint line takes the footer's band when there is one to show: on the
   * ready screen (with the level at its left), while paused, and while Shift
   * is held. */
  if (s.hint || s.hintLeft) drawHint(ctx, s.hint, s.hintLeft);
  else drawFooter(ctx, progress, s.run ? `${s.run.hits}/${s.run.misses}` : '');
  /* Paused and stuck both show a motionless scroll, and only one of them is
   * waiting for you to play something — so each SAYS which it is. */
  if (s.paused) drawLaneCallout(ctx, 'PAUSED');
  else if (s.blocked && s.run) drawLaneCallout(ctx, stuckLabel(s.run));
}

/*
 * What Study is waiting for, in words: "Snare R", "Kick + Hi-hat". The note is
 * on the hit line, but on a drum chart the staff position alone is a thing you
 * have to have learned, and this is the moment you evidently have not yet.
 * The hand is named only when the drill has one written.
 */
export function stuckLabel(run) {
  const notes = blockingNotes(run);
  const parts = [];
  for (let i = 0; i < notes.length; i++) {
    const v = voiceById(notes[i].voice);
    const hand = handsWritten(run) && notes[i].wantHand ? ` ${notes[i].wantHand}` : '';
    parts.push((v ? v.label : notes[i].voice) + hand);
  }
  return parts.join(' + ');
}

function drawStaffBody(ctx, s, visible, px, bars) {
  SR.drawStaff(ctx);
  SR.drawClef(ctx);
  for (const bar of bars) {
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

function drawGridBody(ctx, s, visible, px, bars) {
  /* The caller computes these once when the drill is armed; the fallback is
   * for the preview harness and the tests, which draw one frame at a time. */
  const laneList = s.lanes || GR.lanes(s.voices || voicesInChart(s.chart));
  GR.drawLanes(ctx, laneList);
  for (const bar of bars) {
    GR.drawBarLine(ctx, laneList, bar.x);
  }
  for (const item of visible) GR.drawStack(ctx, item, laneList);
  if (s.run.markers) {
    for (const m of s.run.markers) {
      const x = beatToX(m.beat, s.songBeats, px);
      if (x < L.DESPAWN_X || x >= L.SCREEN_W) continue;
      const lane = GR.laneOf(laneList, m.voice);
      if (!lane) continue;
      GR.drawMarker(ctx, x, lane);
    }
  }
  GR.drawPlayhead(ctx, laneList, s.beatFlash);
}

/*
 * The lane under the chart, and what the drill puts in it.
 *
 * R and L are only drawn when the drill actually asks for a sticking — a
 * groove has no written hand, and printing one would invent a rule the player
 * is then measured against. That used to leave the band reserved and blank
 * under a rule dividing nothing from nothing, for all fourteen grooves.
 *
 * So a drill without a sticking gets the BAR NUMBER there instead. Only one of
 * the two, never both: a bar number has to be clamped to the left edge to stay
 * visible for a whole bar (see drawBarRuler), and clamped it sits exactly over
 * the downbeat's hand — which for a paradiddle is the one letter worth reading.
 * The ticks are drawn either way; they cost one row and hang off the rule.
 */
function drawUnderLane(ctx, s, visible, bars, barNumbers) {
  const sticking = handsWritten(s.run);
  drawBarRuler(ctx, bars, !sticking && barNumbers);
  if (!sticking) return;
  for (let i = 0; i < visible.length; i++) {
    const { entry, x } = visible[i];
    const note = entry.notes[0];
    if (!note || !note.wantHand) continue;
    const next = visible[i + 1];
    const limit = next ? Math.max(0, next.x - x - 1) : L.SCREEN_W - x;
    SR.drawSticking(ctx, x, note.wantHand, note.handOk !== false, Math.min(limit, 14));
  }
}


/* ---- Ready -------------------------------------------------------------- */
/*
 * The ready screen IS the reading view, with the controls laid over it.
 *
 * It used to be a text panel listing the name and the tempo, which showed you
 * nothing of the drill you were about to play and gave the knob nothing to
 * move through. Now the chart is there from the start and you can scrub it
 * before committing to a take.
 *
 * Four rows taller than two lines would need: at the old geometry a third row
 * lands on screen row 51, outside a box ending at 46 and across the sticking
 * rule at 47.
 */
export const READY_BOX = L.READY_BOX;

export function drawReady(ctx, s) {
  const boxUp = (s.songBeats || 0) <= 0;
  drawReadingView(ctx, s, boxUp);

  /*
   * The box (chrome.mjs drawReadyBox): the controls, a word each, and the
   * level of a groove, which the jog changes. A drill a layout cannot fully
   * play says so on the bottom line instead of the level's name (ui.js).
   *
   * THE BOX GETS OUT OF THE WAY ONCE YOU LEAVE THE START. It is an overlay
   * across the middle of the chart, so it covers exactly the music you are
   * scrubbing through; keeping it up would defeat the scrubbing. It comes
   * back when you scroll home, which is also the only way to find it again.
   */
  if (!boxUp) return;

  drawReadyBox(ctx, { rows: [['play', 'listen'], ['rec', 'practise'], ['scrub', 'scrub']], level: s.level,
    bpm: s.bpm });
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

