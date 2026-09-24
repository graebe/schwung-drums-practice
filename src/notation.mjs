/*
 * notation.mjs — staff placement. Pure; no host calls.
 *
 * Drum notation has no key signature, no accidentals and no spelling problem:
 * a voice is engraved at a fixed place and stays there. What survives from
 * the pitched case is the geometry — the diatonic step ordinal and the y it
 * maps to — and that is all this file is.
 *
 * Voices declare the pitch they are WRITTEN at (kit.mjs), so `diatonicOf`
 * exists to turn that human-legible "the snare is on C5" into the step
 * ordinal the renderer needs.
 */

import { ANCHOR_DIATONIC, ANCHOR_Y, STEP_PX, STAFF_LINE_YS } from './layout.mjs';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/* Pitch class of each natural letter, indexed as LETTERS. */
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/*
 * Staff-step ordinal for a MIDI pitch: octave*7 + letterIndex, so C4 = 28.
 * Every kit pitch is a natural; a black note would have no staff line of its
 * own and is rounded down to the letter below it, which is exactly what an
 * engraver does before adding the accidental this module never draws.
 */
export function diatonicOf(pitch) {
  const pc = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1;
  let letterIndex = NATURAL_PC.indexOf(pc);
  if (letterIndex < 0) letterIndex = NATURAL_PC.indexOf(pc - 1);
  return octave * 7 + letterIndex;
}

/* Staff y for a diatonic step ordinal. Higher pitch = smaller y. */
export function diatonicToY(diatonic) {
  return ANCHOR_Y - (diatonic - ANCHOR_DIATONIC) * STEP_PX;
}

/* Staff y for a MIDI pitch. */
export function pitchToY(pitch) {
  return diatonicToY(diatonicOf(pitch));
}

/*
 * Ledger-line positions a note needs: the y of every staff line the note
 * sits beyond, walking outward from the staff to (and including) the note.
 * A note in the space just outside the staff gets none; a note two steps out
 * gets one, and so on.
 *
 * In this module only the crash earns one, which is correct engraving and
 * also a useful accident: the ledger makes the crash unmistakable at a
 * glance, and a crash is rare enough that the line is never noise.
 */
export function ledgerYs(y) {
  const top = STAFF_LINE_YS[0];
  const bottom = STAFF_LINE_YS[STAFF_LINE_YS.length - 1];
  const out = [];
  if (y > bottom) {
    for (let ly = bottom + STEP_PX * 2; ly <= y; ly += STEP_PX * 2) out.push(ly);
  } else if (y < top) {
    for (let ly = top - STEP_PX * 2; ly >= y; ly -= STEP_PX * 2) out.push(ly);
  }
  return out;
}
