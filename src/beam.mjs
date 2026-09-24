/*
 * beam.mjs — beat grouping, stems and beams. Pure, allocation-free.
 *
 * Sixteenths without beams are not reading, they are a row of dots. Beaming
 * is what makes a drum chart show its rhythm at a glance, and it is the one
 * piece of engraving this module cannot do without.
 *
 * A drum hit has no written duration — it is a one-shot, and nothing about
 * the instrument says how long it lasts. So the note VALUE is inferred the
 * way a drummer reads it anyway: from the gap to the next hit, clipped at the
 * end of the beat. Four evenly-spaced hits in a beat are sixteenths whatever
 * anyone wrote down.
 *
 * Nothing here allocates and nothing is cached. Every function answers for
 * ONE index from its neighbours, so the renderer can ask per visible note at
 * frame rate without building a parallel array each time — the pitched module
 * records killing a 34k-allocations-per-second path in the draw loop, and
 * this is exactly the shape of thing that becomes one.
 */

import { MAX_BEAMS } from './layout.mjs';

/* Groups larger than this are pathological input, not music. Bounding the
 * scan keeps every function here O(1) whatever it is handed. */
const MAX_IN_GROUP = 16;
const EPS = 1e-6;

/*
 * What a beam group spans. Simple metres group per quarter; compound ones
 * (6/8, 9/8, 12/8) group per dotted quarter, which is what makes 6/8 read as
 * two groups of three rather than three of two.
 */
export function groupBeats(chart) {
  const ts = (chart && chart.timeSig) || [4, 4];
  if (ts[1] === 8 && ts[0] % 3 === 0) return 1.5;
  return 1;
}

export function groupIndexOf(beat, gb) {
  return Math.floor(beat / gb + EPS);
}

/* True when two entries share a beam group — the only pairs a beam joins. */
export function sameGroup(entries, i, j, gb) {
  const a = entries[i];
  const b = entries[j];
  if (!a || !b) return false;
  return groupIndexOf(a.beat, gb) === groupIndexOf(b.beat, gb);
}

/* First index of the group holding `i`, scanning back at most MAX_IN_GROUP. */
export function groupStart(entries, i, gb) {
  let lo = i;
  let steps = 0;
  while (lo > 0 && steps++ < MAX_IN_GROUP && sameGroup(entries, lo - 1, i, gb)) lo--;
  return lo;
}

/* Last index of the group holding `i`. */
export function groupEnd(entries, i, gb) {
  let hi = i;
  let steps = 0;
  while (hi < entries.length - 1 && steps++ < MAX_IN_GROUP && sameGroup(entries, hi + 1, i, gb)) hi++;
  return hi;
}

/*
 * The note value at `i`, in beats: the gap to the next hit, clipped to the end
 * of its own beam group. Clipping is what stops the last sixteenth of a beat
 * being read as a whole note just because the next beat happens to be empty.
 */
export function durationAt(entries, i, gb) {
  const here = entries[i];
  if (!here) return 0;
  const end = (groupIndexOf(here.beat, gb) + 1) * gb;
  const next = entries[i + 1];
  const to = next ? Math.min(next.beat, end) : end;
  const d = to - here.beat;
  return d > EPS ? d : end - here.beat;
}

/*
 * A tuplet, or 0. Three or six evenly-spaced hits filling a beam group are
 * read as a triplet or a sextuplet rather than by their raw duration — a
 * third of a beat is not a power of two and would otherwise round to two
 * beams and read as sixteenths, which is a different rhythm.
 */
export function tupletAt(entries, i, gb) {
  const lo = groupStart(entries, i, gb);
  const hi = groupEnd(entries, i, gb);
  const n = hi - lo + 1;
  if (n !== 3 && n !== 6) return 0;
  const first = entries[lo];
  const step = gb / n;
  /* Every hit has to sit on its own subdivision, and the group has to start
   * on the beat — a syncopated run of three is not a triplet. */
  if (Math.abs(first.beat - groupIndexOf(first.beat, gb) * gb) > EPS) return 0;
  for (let k = lo; k <= hi; k++) {
    const want = first.beat + (k - lo) * step;
    if (Math.abs(entries[k].beat - want) > 1e-3) return 0;
  }
  /* A power-of-two run is not a tuplet even when it has six members. */
  if (n === 6 && Math.abs(step - gb / 4) < EPS) return 0;
  return n;
}

/*
 * How many beams the note at `i` carries. 0 is a quarter or longer — a
 * stemmed note with no beam.
 */
export function beamsAt(entries, i, gb) {
  const tuplet = tupletAt(entries, i, gb);
  if (tuplet === 3) return 1;
  if (tuplet === 6) return 2;
  const d = durationAt(entries, i, gb);
  if (d <= 0) return 0;
  /* ceil, not round: a dotted eighth is 0.75 of a beat and carries one beam,
   * which rounding would throw away. */
  const n = Math.ceil(-Math.log2(d / gb) - EPS);
  return Math.max(0, Math.min(MAX_BEAMS, n));
}

/*
 * How many beams actually join `i` to the note after it. A run of sixteenths
 * with an eighth at the end joins on one beam, not two — the second beam
 * belongs only to the sixteenths and is drawn as a stub.
 */
export function beamsBetween(entries, i, gb) {
  if (!sameGroup(entries, i, i + 1, gb)) return 0;
  return Math.min(beamsAt(entries, i, gb), beamsAt(entries, i + 1, gb));
}

/* True when the note is the only beamed one in its group, so its beams have
 * nothing to join and are drawn as stubs. */
export function isLoneBeam(entries, i, gb) {
  if (beamsAt(entries, i, gb) === 0) return false;
  return beamsBetween(entries, i, gb) === 0 && beamsBetween(entries, i - 1, gb) === 0;
}
