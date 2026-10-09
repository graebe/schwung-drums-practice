// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * ladder.mjs — the speed trainer. Pure: the caller supplies the clock.
 *
 * Play N bars clean and the tempo goes up; fail a rung twice and the ladder
 * ends. Your score is the fastest tempo you held it together at.
 *
 * It starts BELOW the drill's own tempo and climbs through it: the written
 * tempo is the target, not the first rung. Starting at the target made the
 * ladder an exam you sat cold, and a fast groove ended on its first bar.
 * One slip on a rung is forgiven once — the rung is played again at the same
 * tempo — because a single flam at bar three says little about the tempo.
 *
 * This is the drum equivalent of the pitched module's correct-answers-per-
 * minute: ONE comparable number per drill, which is what makes progress
 * legible at all. It is also what drummers already do with a metronome and a
 * pencil, so it needs no explaining.
 *
 * "Clean" is deliberately all four axes at once — no misses, no strays, no
 * sticking errors, no dynamic errors, and a timing spread inside the
 * strictness threshold. A rung climbed on three of the four would put the
 * tempo up on a pattern you are not actually playing.
 */

import { snapshot, since, WINDOWS } from './scoring.mjs';
import { statsSince } from './timing.mjs';

export const DEFAULT_STEP = 5;
export const DEFAULT_BARS = 4;

/* Where the climb starts, as a share of the drill's own tempo. */
export const START_SHARE = 0.7;
export const RETRIES = 1;

/* The first rung for a drill written at `target`: 70% of it, on the step grid
 * up from there, and never below 40. */
export function startFor(target, step = DEFAULT_STEP) {
  return Math.max(40, Math.round((target * START_SHARE) / step) * step);
}

export function createLadder(opts = {}) {
  return {
    bpm: opts.bpm || 80,
    startBpm: opts.bpm || 80,
    /* The drill's own tempo: reaching it is the goal the screen reports. */
    target: opts.target || opts.bpm || 80,
    step: opts.step || DEFAULT_STEP,
    bars: opts.bars || DEFAULT_BARS,
    retries: opts.retries === undefined ? RETRIES : opts.retries,
    retried: 0,      /* slips forgiven on the current rung                */
    again: false,    /* the rung just judged is being played again        */
    started: false,  /* the first rung has begun (after the count-in)     */
    /* Never below the drill's own tempo: Up-tempo swing is written at 270,
     * and a fixed 240 ceiling topped it out on its first clean rung. */
    maxBpm: opts.maxBpm || Math.max(240, (opts.bpm || 80) + (opts.step || DEFAULT_STEP) * 8),
    rungs: 0,
    topClean: 0,     /* the score: the fastest tempo held clean          */
    topSd: 0,
    topMean: 0,
    failed: false,
    windowStart: 0,  /* beat the current rung began at                   */
    snap: null,
  };
}

export function beginRung(ladder, run, songBeats) {
  ladder.windowStart = songBeats;
  ladder.snap = snapshot(run, songBeats);
  return ladder;
}

/* The beat this rung ends at. */
export function rungEnd(ladder, beatsPerBar) {
  return ladder.windowStart + ladder.bars * beatsPerBar;
}

/*
 * Judge the rung just completed. Returns
 *   { clean, reason, sd, mean, n }
 * `reason` names the first thing that failed, so the screen can say WHY the
 * ladder stopped rather than only that it did.
 */
export function judgeRung(ladder, run, songBeats) {
  const d = since(run, ladder.snap);
  const t = statsSince(run.timing, ladder.windowStart);
  const limit = (WINDOWS[run.strictness] || WINDOWS.normal).perfectMs;

  let reason = '';
  if (d.hits === 0) reason = 'nothing played';
  else if (d.misses > 0) reason = 'missed';
  else if (d.strays > 0) reason = 'stray hits';
  else if (d.stickErrors > 0) reason = 'sticking';
  else if (d.dynErrors > 0) reason = 'dynamics';
  else if (t.sdMs > limit) reason = 'too loose';

  return { clean: reason === '', reason, sdMs: t.sdMs, meanMs: t.meanMs, n: t.n };
}

/*
 * Apply a verdict. A clean rung records the tempo and steps up; a failed one
 * ends the ladder with the last clean tempo standing as the score.
 */
export function applyVerdict(ladder, verdict) {
  ladder.again = false;
  if (!verdict.clean) {
    if (ladder.retried < ladder.retries) {
      ladder.retried++;
      ladder.again = true;
      return ladder;
    }
    ladder.failed = true;
    return ladder;
  }
  ladder.retried = 0;
  ladder.rungs++;
  if (ladder.bpm > ladder.topClean) {
    ladder.topClean = ladder.bpm;
    ladder.topSd = verdict.sdMs;
    ladder.topMean = verdict.meanMs;
  }
  /* The top rung is PLAYED before the ladder counts as topped out; it used to
   * end on reaching it, with the ceiling never actually attempted. */
  if (ladder.bpm >= ladder.maxBpm) {
    ladder.failed = true;
    return ladder;
  }
  ladder.bpm = Math.min(ladder.maxBpm, ladder.bpm + ladder.step);
  return ladder;
}

/* Whether the climb reached the drill's own tempo. */
export function reachedTarget(ladder) {
  return ladder.topClean >= ladder.target;
}

export function ladderFinished(ladder) {
  return ladder.failed;
}
