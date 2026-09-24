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
 * LOOPING does not wind the clock back. songBeats runs forward forever and
 * the MATERIAL repeats: iteration k of the drill sits at beat + k*loopBeats.
 * Wrapping the clock instead would have been less code and quietly wrong —
 * every timing error is a difference between two beat positions, and a clock
 * that jumps backwards at the seam turns a hit 5ms late into a hit one whole
 * loop early. It would also make the scroll discontinuous at exactly the
 * moment the player is being asked to keep time through it.
 *
 * Chart shape (from generator.mjs, or loaded by exercise_io.mjs):
 *   { id, name, bpm, timeSig: [num, den], loopBars, sticking,
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
 * Where the playhead is, for the header. Under a loop the bar is reported
 * WITHIN the loop ("bar 2/4") rather than as an ever-growing absolute count:
 * after ten minutes "bar 147" tells you nothing you can act on, and what you
 * actually want to know is where you are in the thing that repeats.
 */
export function barBeatOf(chart, songBeats, looping = false) {
  const perBar = beatsPerBar(chart);
  const clamped = Math.max(0, songBeats);
  const bars = looping ? Math.max(1, Math.round(loopBeats(chart) / perBar)) : 0;
  const absBar = Math.floor(clamped / perBar);
  return {
    bar: (looping ? absBar % bars : absBar) + 1,
    bars,
    beat: Math.floor(clamped % perBar) + 1,
    loop: looping ? Math.floor(absBar / bars) + 1 : 1,
  };
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
 */
export function applyWait(rawBeats, waitedBeats, blockBeat) {
  const t = rawBeats - waitedBeats;
  if (blockBeat === null || blockBeat === undefined || t <= blockBeat) {
    return { songBeats: t, waitedBeats, blocked: false };
  }
  return { songBeats: blockBeat, waitedBeats: waitedBeats + (t - blockBeat), blocked: true };
}
