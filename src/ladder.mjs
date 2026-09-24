/*
 * ladder.mjs — the speed trainer. Pure: the caller supplies the clock.
 *
 * Play N bars clean and the tempo goes up; fail and the ladder ends. Your
 * score is the fastest tempo you held it together at.
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

export function createLadder(opts = {}) {
  return {
    bpm: opts.bpm || 80,
    startBpm: opts.bpm || 80,
    step: opts.step || DEFAULT_STEP,
    bars: opts.bars || DEFAULT_BARS,
    maxBpm: opts.maxBpm || 240,
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
  if (!verdict.clean) {
    ladder.failed = true;
    return ladder;
  }
  ladder.rungs++;
  if (ladder.bpm > ladder.topClean) {
    ladder.topClean = ladder.bpm;
    ladder.topSd = verdict.sdMs;
    ladder.topMean = verdict.meanMs;
  }
  ladder.bpm = Math.min(ladder.maxBpm, ladder.bpm + ladder.step);
  if (ladder.bpm >= ladder.maxBpm) ladder.failed = true; /* topped out */
  return ladder;
}

export function ladderFinished(ladder) {
  return ladder.failed;
}
