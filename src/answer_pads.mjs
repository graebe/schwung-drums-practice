// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * answer_pads.mjs — multiple-choice answers as pads. Pure.
 *
 * Piano Practice's picking pattern, so the two modules answer alike: every
 * drill that asks you to choose a name — Pick: drum, Hear: subdivision, Pick:
 * groove — puts its answers on the bottom of the grid, one coloured pad each,
 * and the screen says which colour means what. Pressing the pad answers; the
 * jog and Click still do too.
 *
 * Only there. Guess: drum and Hear: drum are answered by playing the drum,
 * and the bottom row holds drums, so a bar across it would cover the answer.
 *
 *   up to 4    every other pad of the bottom row, centred:  · 1 · 2 · 3 · 4
 *   5 to 8     the whole bottom row
 *
 * The gaps are there for your fingers: with four answers or fewer there is
 * room to leave a dark pad between two, and a near miss lands on nothing
 * rather than on the neighbouring answer.
 */

import { PAD_FIRST } from './padmap.mjs';

export const MAX_ANSWERS = 8;
const ROW = 8;

/*
 * Schwung palette indices, bright and dim. None is green, red, yellow, the
 * purple ramp or BrightOrange: those already mean right, wrong, pressed, a
 * drum, and right drum with the wrong hand — an answer must never be mistaken
 * for a judgement. That last one is why piano's orange is not here; the
 * others are piano's own, in its order.
 */
export const ANSWER_COLOURS = [
  { name: 'blue', bright: 16, dim: 95 },     /* AzureBlue / DarkAzure          */
  { name: 'cyan', bright: 14, dim: 91 },     /* CyanTeal / DarkCyanTeal        */
  { name: 'white', bright: 120, dim: 119 },  /* White / DarkGrey               */
  { name: 'pink', bright: 25, dim: 113 },    /* BrightPink / DarkBrightPink    */
];

/* What the screen calls each answer's colour, by answer index — made once,
 * because the quiz screen reads it on every frame. */
export const COLOUR_NAMES = ANSWER_COLOURS.map((c) => c.name);

/* With this many answers, colour names are listed beside them. */
export const LIST_MAX = 4;

/* Columns of the spaced layout, by answer count: centred, one dark pad apart. */
const SPACED = [[], [3], [2, 5], [1, 3, 5], [0, 2, 4, 6]];

/* The pad for each answer, in answer order. Made once per count and shared:
 * the LED repaint asks on every frame, and must not allocate. */
const layouts = [];
export function answerPads(count) {
  const n = Math.max(0, Math.min(MAX_ANSWERS, count | 0));
  if (!layouts[n]) {
    if (n <= LIST_MAX) {
      layouts[n] = SPACED[n].map((col) => PAD_FIRST + col);
    } else {
      layouts[n] = [];
      for (let i = 0; i < n; i++) layouts[n].push(PAD_FIRST + i);
    }
  }
  return layouts[n];
}

/* Which answer a pad is, or -1. */
export function answerAt(count, pad) {
  return answerPads(count).indexOf(pad);
}

/* A pad belongs to the answer bar — the bottom row, gaps and all. */
export function inAnswerBar(count, pad) {
  return count > 0 && pad >= PAD_FIRST && pad < PAD_FIRST + ROW;
}

export function answerColour(index) {
  const n = ANSWER_COLOURS.length;
  return ANSWER_COLOURS[((index % n) + n) % n];
}

/*
 * The colour of every answer pad right now, written into `out` (one palette
 * index per answer). A struck-out answer is dark; the answer the jog is on
 * pulses between its bright and dim shade, so turning the jog shows on the
 * pads as well as the screen — while every pad keeps the hue that names it.
 */
export function answerLeds(count, highlight, isStruck, phase, out) {
  out.length = count;
  for (let i = 0; i < count; i++) {
    const c = answerColour(i);
    if (isStruck(i)) out[i] = 0;
    else if (i === highlight && !phase) out[i] = c.dim;
    else out[i] = c.bright;
  }
  return out;
}
