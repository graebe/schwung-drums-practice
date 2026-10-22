// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * pad_tour.mjs — Meet the pads, the first lesson of the Learning Path: a walk
 * over the kit under your fingers. Pure.
 *
 * Someone who has never seen the layout cannot be asked to find a drum, so
 * before any quiz the tour SHOWS each one: its name and a line about it on the
 * screen, its pads pulsing on the grid, its sound once. Striking one of those
 * pads moves on, so the finger learns the place, not only the eye. Another pad
 * is not a mistake here: it sounds and is named, which is how anyone explores
 * a kit anyway.
 *
 * One stop per SOUND, not per pad. A drum lights on both halves at once,
 * because the right half repeats the left (padmap.mjs), and that is one fact
 * to learn, not sixteen. The order is the kit a beat is made of first —
 * kick, snare, hi-hat — then the rest family by family, so what is met
 * together belongs together. The stops are the layout's own: a Custom layout
 * or Flip tours what is really under the hands.
 *
 * The jog skips a stop either way, and the end is reached however it was
 * reached: nothing here is judged. ui.js sounds, lights and records; what the
 * tour does is decided here. Each screen's lines are wrapped when it comes
 * up, by the caller's `measure`, so a draw only reads them.
 */

import { voiceById } from './kit.mjs';
import { wrapText } from './lessons.mjs';

export const TOUR_NAME = 'Meet the pads';

export const TOUR_ORDER = [
  'KK', 'SN', 'HH',                     /* the beat                  */
  'HO', 'HF',                           /* the rest of the hi-hat    */
  'RM', 'CL', 'S2',                     /* what stands in for a snare */
  'K2',
  'HT', 'HM', 'MT', 'LT', 'F1', 'F2',   /* toms, high to low, as a fill runs */
  'CR', 'RD', 'FX',                     /* cymbals                   */
  'P1', 'P2', 'SH',                     /* hand percussion           */
];

/* The right pad's flash and sound, before the next stop comes up. */
export const HOLD_MS = 600;
/* How long another pad's name holds the screen. */
export const NOTE_MS = 1500;

export const END_TITLE = 'Your kit';
export const END_TEXT = 'That is the whole kit. Settings > Pads picks another layout, '
  + 'Flip mirrors it, and Pad map names every pad, any time.';

const labelOf = (voice) => {
  const v = voiceById(voice);
  return v ? v.label : voice;
};

/* The layout's sounds in tour order. One the order does not name — a voice a
 * later kit adds — comes last rather than not at all. */
export function tourVoices(layout) {
  const on = new Set(layout.grid.filter(Boolean));
  const out = TOUR_ORDER.filter((v) => on.has(v));
  for (const v of layout.grid) if (v && out.indexOf(v) < 0) out.push(v);
  return out;
}

/*
 * A tour of `layout` (resolved, padmap.mjs). `texts` is lessons.json's line
 * per drum; `measure` and `width` wrap it to the screen.
 */
export function createTour(layout, { texts = new Map(), measure = (t) => t.length * 6, width = 126 } = {}) {
  const tour = { stops: tourVoices(layout), texts, measure, width, at: 0, done: false,
    solvedAt: 0, note: '', noteUntil: 0, lines: [] };
  if (!tour.stops.length) tour.done = true;
  lay(tour);
  return tour;
}

/* The drum being shown, or null on the last page. */
export function current(tour) {
  return tour.done ? null : tour.stops[tour.at];
}

function lay(tour) {
  let text = END_TEXT;
  if (!tour.done) {
    const voice = current(tour);
    text = tour.note
      ? `That was the ${tour.note.toLowerCase()}. The ${labelOf(voice).toLowerCase()} is the pad that pulses.`
      : tour.texts.get(voice) || labelOf(voice);
  }
  tour.lines = wrapText(text, tour.width, tour.measure);
}

/*
 * A pad went down: 'right' when it is the drum being shown (the tour moves on
 * HOLD_MS later, see service), 'other' for another drum, which is named;
 * 'ignored' while the right one is still sounding, or on the last page.
 */
export function press(tour, voice, nowMs) {
  const want = current(tour);
  if (!want || tour.solvedAt) return 'ignored';
  if (voice === want) {
    tour.solvedAt = nowMs || 1;
    tour.note = '';
    lay(tour);
    return 'right';
  }
  tour.note = labelOf(voice);
  tour.noteUntil = nowMs + NOTE_MS;
  lay(tour);
  return 'other';
}

/* The clock: on to the next stop once the right pad has had its moment, and
 * a name back to the drum's own line once it has been read. True when the
 * stop changed — the caller sounds the new drum, or records the end. */
export function service(tour, nowMs) {
  if (tour.note && nowMs >= tour.noteUntil) {
    tour.note = '';
    lay(tour);
  }
  if (!tour.solvedAt || nowMs - tour.solvedAt < HOLD_MS) return false;
  tour.solvedAt = 0;
  return move(tour, 1);
}

/* The jog: a stop on or back. True when it moved. */
export function skip(tour, delta) {
  tour.solvedAt = 0;
  return move(tour, delta);
}

function move(tour, delta) {
  const n = tour.stops.length;
  if (!n || !delta) return false;
  if (tour.done) {
    if (delta > 0) return false;
    tour.done = false;
    tour.at = n - 1;
  } else if (tour.at + delta >= n) {
    tour.done = true;
  } else {
    const to = Math.max(0, tour.at + delta);
    if (to === tour.at) return false;
    tour.at = to;
  }
  tour.note = '';
  lay(tour);
  return true;
}

/* What drawTour draws. */
export function screenOf(tour) {
  if (tour.done) return { title: END_TITLE, right: '', lines: tour.lines, footer: 'CLICK next  BACK list' };
  return {
    title: labelOf(current(tour)),
    right: `${tour.at + 1}/${tour.stops.length}`,
    lines: tour.lines,
    footer: tour.solvedAt ? '' : 'HIT lit pad  JOG skip',
  };
}
