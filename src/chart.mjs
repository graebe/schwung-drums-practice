// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * chart.mjs — the scroll engine. Pure: no host calls, no mutable state.
 *
 * There is exactly one clock. Everything on screen is a function of
 *
 *     songBeats = elapsedMs / 1000 * bpm / 60
 *
 * so nothing has to be animated, nothing can drift apart, and a frame can be
 * rendered for any instant of any drill — which is what lets the whole
 * reading view be asserted on in `node --test`.
 *
 * REPEATING does not wind the clock back. songBeats runs forward and the
 * MATERIAL repeats: iteration k of the drill sits at beat + k*loopBeats.
 * Wrapping the clock instead would have been less code and quietly wrong —
 * every timing error is a difference between two beat positions, and a clock
 * that jumps backwards at the seam turns a hit 5ms late into a hit one whole
 * loop early. It would also make the scroll discontinuous at exactly the
 * moment the player is being asked to keep time through it.
 *
 * A PRACTICE HAS A LENGTH, and the file states it. `loopBars` is how long the
 * written pattern is; `repeats` is how many times that pattern IS the
 * practice. The first version of this module had neither — a drill looped
 * until you stopped it, which meant it never finished, never showed a summary
 * and never recorded a score unless you thought to interrupt it.
 *
 * Chart shape (from generator.mjs, or loaded by exercise_io.mjs):
 *   { id, name, bpm, timeSig: [num, den], loopBars, repeats, sticking,
 *     events: [ { beat, voices: ['SN'], hand, dyn } ] }
 */

import * as L from './layout.mjs';

export function beatToX(beat, songBeats, pxPerBeat, hitX = L.HIT_X) {
  return hitX + (beat - songBeats) * pxPerBeat;
}

export function xToBeat(x, songBeats, pxPerBeat, hitX = L.HIT_X) {
  return songBeats + (x - hitX) / pxPerBeat;
}

export function msToBeats(ms, bpm) {
  return (ms / 1000) * (bpm / 60);
}

export function beatsToMs(beats, bpm) {
  return (beats / (bpm / 60)) * 1000;
}

export function beatsPerBar(chart) {
  const ts = chart.timeSig || [4, 4];
  return (ts[0] * 4) / ts[1];
}

/*
 * Where the last hit falls — how long one pass lasts.
 *
 * A drum hit has NO duration: it is a one-shot and its envelope decides when
 * it stops. Carrying the pitched module's `beat + 1` would make a bar of
 * sixteenths ending at 3.75 report a length of 4.75, which reads as a drill
 * that overruns its own loop by most of a beat.
 */
export function chartTotalBeats(chart) {
  let end = 0;
  for (let i = 0; i < (chart.events || []).length; i++) {
    const stop = chart.events[i].beat + (chart.events[i].durBeats || 0);
    if (stop > end) end = stop;
  }
  return end;
}

/*
 * The length of one loop, in beats — always a whole number of bars.
 *
 * A drill that declares `loopBars` is taken at its word. One that does not is
 * rounded UP to the next bar line, because a loop that repeats mid-bar puts
 * the downbeat somewhere new every time round and there is then no beat 1 to
 * play against. A bar of silence at the end is the lesser evil, and usually
 * the drill meant it.
 */
export function loopBeats(chart) {
  const perBar = beatsPerBar(chart);
  if (chart.loopBars > 0) return chart.loopBars * perBar;
  const total = chartTotalBeats(chart);
  return Math.max(perBar, Math.ceil(total / perBar) * perBar);
}

/*
 * How many times the pattern runs. A file that says nothing still ends —
 * DEFAULT_REPEATS rather than forever — because "no length stated" almost
 * always means the author did not think about it, and a practice that never
 * finishes is the one thing this module must not go back to.
 *
 * 0 means endless, and is deliberate rather than absent: the Ladder and the
 * Clock both wrap a drill and impose their own ending, and open playing is a
 * real thing to want.
 */
export const DEFAULT_REPEATS = 8;

export function repeatsOf(chart) {
  const r = chart && chart.repeats;
  if (r === 0) return 0;
  if (Number.isFinite(r) && r > 0) return Math.floor(r);
  return DEFAULT_REPEATS;
}

/* The whole practice, in beats. Infinity when endless. */
export function practiceBeats(chart) {
  const reps = repeatsOf(chart);
  return reps === 0 ? Infinity : reps * loopBeats(chart);
}

/* Total bars in the practice, 0 when endless — for the "bar 3/8" readout. */
export function practiceBars(chart) {
  const reps = repeatsOf(chart);
  if (reps === 0) return 0;
  return Math.max(1, Math.round((reps * loopBeats(chart)) / beatsPerBar(chart)));
}

/* How long the practice takes, in seconds. Infinity when endless. */
export function practiceSeconds(chart) {
  const beats = practiceBeats(chart);
  if (!Number.isFinite(beats)) return Infinity;
  return beatsToMs(beats, chart.bpm || 90) / 1000;
}

/* The events of iteration `iter`, at absolute beats. */
export function expandEvents(chart, iter) {
  const shift = iter * loopBeats(chart);
  return (chart.events || []).map((e) => ({ ...e, beat: e.beat + shift }));
}

/* The beat window currently on screen, from the despawn edge to the right. */
export function visibleRange(songBeats, pxPerBeat) {
  return {
    fromBeat: xToBeat(L.DESPAWN_X, songBeats, pxPerBeat),
    toBeat: xToBeat(L.SPAWN_X, songBeats, pxPerBeat),
  };
}

/*
 * Bar lines are derived from the time signature, never stored as events, and
 * under a loop they simply never stop — which is the whole point. `endBeat`
 * caps them for a one-pass drill.
 */
export function visibleBars(chart, songBeats, pxPerBeat, endBeat = Infinity) {
  const perBar = beatsPerBar(chart);
  const { fromBeat, toBeat } = visibleRange(songBeats, pxPerBeat);
  const first = Math.max(0, Math.ceil(fromBeat / perBar));
  const last = Math.floor(Math.min(toBeat, endBeat) / perBar);
  const out = [];
  for (let b = first; b <= last; b++) {
    out.push({
      bar: b + 1,
      beat: b * perBar,
      x: beatToX(b * perBar, songBeats, pxPerBeat) + L.BAR_OFFSET_PX,
    });
  }
  return out;
}

/*
 * The bars the RULER needs, which is one more than the chart draws.
 *
 * visibleBars() returns only the lines that are on screen, and the line of the
 * bar you are currently IN is behind the playhead by definition — so a ruler
 * built from it alone has nothing to name the current bar with, and its number
 * would appear only in the moments just before a downbeat. Prepending the
 * current bar, at its own off-screen x, is what lets the ruler hold a number
 * against the left edge for the whole bar; its tick is off screen and simply
 * is not drawn.
 */
export function rulerBars(chart, songBeats, pxPerBeat, endBeat = Infinity) {
  const perBar = beatsPerBar(chart);
  const visible = visibleBars(chart, songBeats, pxPerBeat, endBeat);
  const clamped = Math.max(0, songBeats);
  const beat = Math.floor(clamped / perBar) * perBar;
  if (beat > endBeat) return visible;
  const cur = {
    bar: Math.floor(clamped / perBar) + 1,
    beat,
    x: beatToX(beat, songBeats, pxPerBeat) + L.BAR_OFFSET_PX,
  };
  /* Already there when the playhead sits exactly on the line. */
  if (visible.length && visible[0].bar === cur.bar) return visible;
  return [cur, ...visible];
}

/*
 * Where the playhead is, for the header.
 *
 * The bar is reported against the WHOLE PRACTICE — "bar 3/8" — not within the
 * repeating pattern. Knowing you are in bar 3 of a one-bar loop tells you
 * nothing; knowing you are three bars into eight tells you how much is left,
 * which is the only reason to put it on screen.
 *
 * An endless drill has no total, so `bars` is 0 and the caller shows the
 * absolute count instead.
 */
export function barBeatOf(chart, songBeats) {
  const perBar = beatsPerBar(chart);
  const clamped = Math.max(0, songBeats);
  const absBar = Math.floor(clamped / perBar);
  const bars = practiceBars(chart);
  const perLoop = Math.max(1, Math.round(loopBeats(chart) / perBar));
  return {
    bar: absBar + 1,
    bars,
    beat: Math.floor(clamped % perBar) + 1,
    rep: Math.floor(absBar / perLoop) + 1,
    reps: repeatsOf(chart),
  };
}

/* How far through the practice, 0..1. Always 0 when endless — there is no
 * fraction of forever, and a bar that crept forward regardless would be a
 * lie the player would learn to ignore. */
export function practiceProgress(chart, songBeats) {
  const total = practiceBeats(chart);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, songBeats / total));
}

/* Which loop iteration a beat falls in. */
export function iterationAt(chart, beat) {
  return Math.floor(beat / loopBeats(chart));
}

/* How wide a sticking-lane label may be before it collides with the next. */
export function labelLimitPx(visible, i, pxPerBeat) {
  const next = visible[i + 1];
  if (!next) return L.SCREEN_W - visible[i].x;
  return Math.max(0, next.x - visible[i].x - 2);
}

/* True on the frame a new beat starts — the click, and the hit-line flash. */
export function isBeatEdge(prevBeats, songBeats) {
  return Math.floor(prevBeats) !== Math.floor(songBeats);
}

/* True on the frame a new subdivision starts, for a subdivided click. */
export function isSubdivEdge(prevBeats, songBeats, per) {
  if (per <= 0) return false;
  return Math.floor(prevBeats * per) !== Math.floor(songBeats * per);
}

/*
 * Study mode: hold the playhead at `blockBeat` while the scroll is frozen.
 *
 * Rather than stopping the clock, the time that passes while frozen is
 * accumulated into `waitedBeats` and subtracted out. The drill therefore
 * resumes in tempo from where it stopped instead of lurching forward to catch
 * up, and the click freezes with it because both are derived from songBeats.
 *
 * TWO CLOCKS, and the second one is the point (ported from Piano Practice,
 * where it was learned the hard way). The scroll stops on the note; the JUDGE
 * must not. `scoreBeats` keeps real time while `songBeats` sits still, so a
 * note found three seconds late is three seconds late rather than "perfect",
 * and its late window can close while the scroll waits on it. It cannot be
 * derived after the fact — the first frozen frame folds the overshoot into
 * `waitedBeats` — so `frozenAt` carries the pre-freeze `waitedBeats` across
 * frames, and is null whenever nothing is frozen.
 */
export function applyWait(rawBeats, waitedBeats, blockBeat, frozenAt = null) {
  const t = rawBeats - waitedBeats;
  if (blockBeat === null || blockBeat === undefined || t <= blockBeat) {
    return { songBeats: t, waitedBeats, blocked: false, scoreBeats: t, frozenAt: null };
  }
  const start = frozenAt === null || frozenAt === undefined ? waitedBeats : frozenAt;
  return {
    songBeats: blockBeat,
    waitedBeats: waitedBeats + (t - blockBeat),
    blocked: true,
    scoreBeats: rawBeats - start,
    frozenAt: start,
  };
}
