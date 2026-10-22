// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * answer_pads.mjs — multiple-choice answers as pads. Pure.
 *
 * Piano Practice's picking pattern, so the two modules answer alike: every
 * drill that asks you to choose a name gives each answer a colour and puts
 * it on pads, and the screen says which colour means what. Pressing a pad
 * answers; the jog and Click still do too. Where the answers sit:
 *
 *   Pick: drum      on the kit itself: every pad of each offered drum in the
 *                   layout in force, the rest dark. The answer is where the
 *                   drum is, so picking it is finding it.
 *   Hear: subdivision, Pick: groove
 *                   have no pads of their own: a bar along the bottom row
 *
 *     up to 4    every other pad of the bottom row, centred:  · 1 · 2 · 3 · 4
 *     5 to 8     the whole bottom row
 *
 * The bar's gaps are there for your fingers: with four answers or fewer there
 * is room to leave a dark pad between two, and a near miss lands on nothing
 * rather than on the neighbouring answer.
 *
 * Either way the answers are a grid by pad index (0 bottom left): the answer
 * a pad is, or -1 for a dark one. The grid's length is how many pads the
 * answers own — the bottom row for the bar, so the drums above stay drums;
 * all of them on the kit.
 */

import { PAD_FIRST, PAD_COUNT, padVoice, padsForVoice } from './padmap.mjs';

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

/* The bar as a grid: the bottom row, an answer index or -1 a gap (none at
 * all without answers). Made once per count and shared, like the layouts. */
const bars = [];
export function barGrid(count) {
  const n = Math.max(0, Math.min(MAX_ANSWERS, count | 0));
  if (!bars[n]) {
    const pads = answerPads(n);
    bars[n] = [];
    if (n) for (let i = 0; i < ROW; i++) bars[n].push(pads.indexOf(PAD_FIRST + i));
  }
  return bars[n];
}

/* Pick: drum's grid, written into `out`: every pad of an offered voice in
 * `layout` is that answer, every other pad dark. */
export function kitGrid(options, layout, out = []) {
  out.length = PAD_COUNT;
  for (let i = 0; i < PAD_COUNT; i++) out[i] = options.indexOf(padVoice(PAD_FIRST + i, layout));
  return out;
}

/* The offered voices `layout` has no pad for (a Custom layout without them):
 * still offered on the jog, and the screen says so. */
export function padless(options, layout) {
  return options.filter((v) => !padsForVoice(v, layout).length);
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
