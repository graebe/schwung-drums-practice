// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * padmap.mjs — the pad layouts and the hand split. Pure.
 *
 * The grid is 4 rows of 8, notes 68..99, bottom-left to top-right.
 * Two things are laid over it:
 *
 *   THE HAND SPLIT.  Columns 0..3 are the left hand, 4..7 the right — the
 *   physical halves, whatever layout is in force and whether it is flipped.
 *   This is the whole reason sticking can be scored at all: a pad press
 *   carries which half of the grid it came from, so "RLRR LRLL" is checkable
 *   rather than decorative.
 *
 *   THE LAYOUT. Each assigns a voice to every pad. A voice may own several
 *   pads, and any of them counts, so a double or a roll has two fingers to
 *   land on and nothing is lost to fumbling for a single 12mm square.
 *
 * The layouts are the finger drummer's, each a 4x4 that the right half
 * DUPLICATES — the left half is where Move's own drum mode puts its Drum Rack,
 * and the copy keeps every sound under either hand, which sticking needs:
 *
 *   mpc      MPC Classic, the default: the kick, snare and hats along the
 *            bottom row under the strongest fingers, cymbals on top, toms
 *            between — the layout most finger drummers learnt on
 *   family   MPC Family Rows: one row a family — kicks, snares, hats, cymbals
 *   centre   MPC Centre Core: kick and snare in the middle, all else round them
 *   gm       Chromatic: General MIDI 36..51 left to right, bottom to top —
 *            Ableton's Drum Rack and Move's drum mode, note for note
 *
 * and two that are not 4x4s:
 *
 *   mirror   Mirrored Performance: a two-handed kit centred on columns 2..5,
 *            each half the mirror of the other, the extension (toms, cymbals,
 *            the hat foot) on the outer columns
 *   sticking one surface: the snare on every pad, for rudiments, where the
 *            only questions are which hand and when
 *
 * plus `custom`, one layout of the player's own (pads_io.mjs, pads.json).
 * FLIP mirrors any of them, column c to 7-c, for a left-hander; the hand is
 * still the physical half.
 *
 * Every preset reaches the voices the bundled drills are written in, so no
 * step of the Path is unplayable on any of them (padmap.test.mjs) —
 * but Chromatic, which is GM 36..51 by definition and has no cowbell.
 */

import { VOICE_IDS } from './kit.mjs';

export const PAD_FIRST = 68;
export const PAD_LAST = 99;
export const PAD_COUNT = 32;
export const COLS = 8;
export const ROWS = 4;

export const LEFT = 'L';
export const RIGHT = 'R';

/* How a layout's halves relate, which is also where an edit made to "both
 * halves" lands: the same column of the other half, or its mirror image. */
export const TWIN = 'twin';
export const MIRROR = 'mirror';

/* Written top row first, as they sit under your hands. A 4x4 is duplicated
 * into both halves; an 8-wide grid is taken as it is. */
export const PRESETS = {
  mpc: { name: 'MPC Classic', pair: TWIN, rows: [
    'CR RD P1 FX',
    'LT MT HT P2',
    'K2 CL RM HF',
    'KK SN HH HO',
  ] },
  family: { name: 'MPC Family Rows', pair: TWIN, rows: [
    'CR RD P1 P2',
    'HH HO HF SH',
    'SN S2 CL RM',
    'KK K2 LT HT',
  ] },
  centre: { name: 'MPC Centre Core', pair: TWIN, rows: [
    'CR MT FX RD',
    'SH HH HO HF',
    'P1 KK SN P2',
    'LT RM CL HT',
  ] },
  gm: { name: 'Chromatic GM', pair: TWIN, rows: [
    'HM CR HT RD',
    'HF LT HO MT',
    'S2 F2 HH F1',
    'KK RM SN CL',
  ] },
  mirror: { name: 'Mirrored', pair: MIRROR, rows: [
    'SH FX CR P1 P2 RD FX SH',
    'HM HT HH HO HO HH HT HM',
    'MT RM LT SN CL HT RM MT',
    'HF F1 KK SN SN KK F1 HF',
  ] },
  sticking: { name: 'Sticking', pair: TWIN, rows: [
    'SN SN SN SN',
    'SN SN SN SN',
    'SN SN SN SN',
    'SN SN SN SN',
  ] },
};

export const CUSTOM = 'custom';
/* The order the Pads setting steps through. */
export const LAYOUT_IDS = ['mpc', 'family', 'centre', 'gm', 'mirror', CUSTOM, 'sticking'];
/* The layouts that are the same on every Move: what a bundled drill must be
 * playable on. */
export const PRESET_IDS = ['mpc', 'family', 'centre', 'gm', 'mirror', 'sticking'];
export const DEFAULT_LAYOUT = 'mpc';

/* Rows (top first) into pad index -> voice, bottom row first. A 4-wide row is
 * duplicated into both halves. */
export function gridOf(rows) {
  const byPad = new Array(PAD_COUNT).fill(null);
  const bottomFirst = rows.slice().reverse();
  for (let row = 0; row < ROWS; row++) {
    const cells = String(bottomFirst[row] || '').trim().split(/\s+/);
    for (let col = 0; col < COLS; col++) {
      const cell = cells.length === COLS / 2 ? cells[col % (COLS / 2)] : cells[col];
      byPad[row * COLS + col] = cell && cell !== '.' ? cell : null;
    }
  }
  return byPad;
}

/* A grid back into 8-wide rows, top first: how pads.json writes Custom. */
export function rowsOf(grid) {
  const out = [];
  for (let row = ROWS - 1; row >= 0; row--) {
    const cells = [];
    for (let col = 0; col < COLS; col++) cells.push(grid[row * COLS + col] || '.');
    out.push(cells.join(' '));
  }
  return out;
}

function flipped(grid) {
  const out = new Array(PAD_COUNT);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) out[row * COLS + col] = grid[row * COLS + (COLS - 1 - col)];
  }
  return out;
}

/*
 * A layout as the pads see it: { id, name, pair, grid } with Flip applied —
 * what every caller holds, so a flipped or custom layout is never one case
 * short somewhere. `custom` is { rows, pair } from pads.json; without one,
 * Custom starts as a copy of MPC Classic.
 */
export function resolveLayout(id, { flip = false, custom = null } = {}) {
  let base;
  if (id === CUSTOM) {
    const c = custom || { rows: PRESETS.mpc.rows, pair: TWIN };
    base = { id: CUSTOM, name: 'Custom', pair: c.pair === MIRROR ? MIRROR : TWIN, grid: gridOf(c.rows) };
  } else {
    const key = PRESETS[id] ? id : DEFAULT_LAYOUT;
    base = { id: key, name: PRESETS[key].name, pair: PRESETS[key].pair, grid: gridOf(PRESETS[key].rows) };
  }
  if (flip) base.grid = flipped(base.grid);
  base.flip = Boolean(flip);
  return base;
}

/* A layout id, unflipped, resolved once: what callers that only know an id get. */
const byId = new Map();
function asLayout(layout) {
  if (layout && typeof layout === 'object') return layout;
  const id = layout || DEFAULT_LAYOUT;
  if (!byId.has(id)) byId.set(id, resolveLayout(id));
  return byId.get(id);
}

export function isPad(note) {
  return note >= PAD_FIRST && note <= PAD_LAST;
}

export function padRowCol(pad) {
  const base = pad - PAD_FIRST;
  const row = Math.floor(base / COLS);
  return { row, col: base - row * COLS };
}

export function padAt(row, col) {
  return PAD_FIRST + row * COLS + col;
}

/* Which hand a pad belongs to. Left half is the left hand. */
export function padHand(pad) {
  return padRowCol(pad).col < COLS / 2 ? LEFT : RIGHT;
}

/* The same column in the other hand's half: 0<->4, 1<->5, 2<->6, 3<->7. */
export function twinCol(col) {
  return (col + COLS / 2) % COLS;
}

/* Where "both halves" lands for a layout's pairing: its twin or its mirror. */
export function pairCol(col, pair = TWIN) {
  return pair === MIRROR ? COLS - 1 - col : twinCol(col);
}

export function layoutExists(id) {
  return id === CUSTOM || Object.prototype.hasOwnProperty.call(PRESETS, id);
}

/* The voice a pad plays in this layout, or null. */
export function padVoice(pad, layout = DEFAULT_LAYOUT) {
  if (!isPad(pad)) return null;
  return asLayout(layout).grid[pad - PAD_FIRST] || null;
}

/*
 * Every pad that plays this voice — light or accept all of them. Pass a hand
 * to narrow it to that half, which is what the guide pads do when the drill
 * is enforcing sticking: lighting both halves would be telling you the note
 * and hiding the question.
 */
export function padsForVoice(voice, layout = DEFAULT_LAYOUT, hand = null) {
  const out = [];
  const grid = asLayout(layout).grid;
  for (let i = 0; i < PAD_COUNT; i++) {
    if (grid[i] !== voice) continue;
    const pad = PAD_FIRST + i;
    if (hand && padHand(pad) !== hand) continue;
    out.push(pad);
  }
  return out;
}

/* The voices a layout can reach, in staff order. */
export function layoutVoices(layout = DEFAULT_LAYOUT) {
  const seen = {};
  for (const id of asLayout(layout).grid) if (id) seen[id] = true;
  return VOICE_IDS.filter((id) => seen[id]);
}

/* The voices a chart asks for that this layout has no pad for, in staff order. */
export function missingVoices(chart, layout = DEFAULT_LAYOUT) {
  const reach = new Set(layoutVoices(layout));
  const seen = new Set();
  for (const ev of chart.events || []) for (const id of ev.voices || []) if (!reach.has(id)) seen.add(id);
  /* Staff order, and a voice no kit has heard of last: it is missing too. */
  return VOICE_IDS.filter((id) => seen.has(id)).concat([...seen].filter((id) => VOICE_IDS.indexOf(id) < 0));
}

/* The first preset that can play every voice in the chart, or null. */
export function layoutForChart(chart) {
  for (const id of PRESET_IDS) if (!missingVoices(chart, id).length) return id;
  return null;
}

/*
 * ---- LED colours (indices into Schwung's 0..127 palette) -----------------
 *
 * Everything that describes the MUSIC comes from one violet ramp
 * (107 -> 22 -> 23 -> 50). Everything that is a JUDGEMENT keeps its own hue,
 * because within one family only brightness is left to rank with, and
 * right-or-wrong is the one signal that must never need reading.
 *
 * The background is deliberately the dimmest lit value. A bright background
 * puts the grid at the same intensity as the guidance trying to tell you
 * which pad comes next, and in one hue that reads as noise.
 *
 * LED_STICK is the addition this module needs and the pitched one did not:
 * "right voice, WRONG HAND" is a different mistake from "wrong voice", it is
 * fixed differently, and if it shared red with a miss you would never learn
 * to tell them apart mid-bar. Orange is far enough from both the green of a
 * hit and the red of a miss to be read without thinking.
 *
 * LED_DYN is the same argument once more: "right voice, right hand, WRONG
 * LOUDNESS" — a soft accent, a heavy ghost — is fixed with the wrist, not the
 * sticking, and sharing orange with a wrong hand hid which one it was. Azure
 * is the one hue left that is neither a judgement's nor the music's violet.
 */
export const LED_OFF = 0;
export const LED_VOICE = 107;      /* DarkPurple   #220D66 — a voice is here */
export const LED_TARGET_FAR = 22;  /* Purple       #5722FF — it is coming    */
export const LED_TARGET_NEAR = 23; /* NeonPink     #972BFF — it is now       */
export const LED_PROMPT = 50;      /* LavenderBlue #BBAAF2 — quiz prompt     */
export const LED_PRESSED = 8;      /* BrightYellow #FFC516 — your finger     */
export const LED_HIT = 126;        /* Green        #00FF00                   */
export const LED_STICK = 3;        /* BrightOrange #C93C00 — wrong hand      */
export const LED_DYN = 16;         /* AzureBlue    #31ADFF — wrong dynamic   */
export const LED_MISS = 127;       /* Red          #FF0000                   */

/* The home screen's pads (home/leds.mjs): a circle each, the chosen one
 * bright and pulsing, the rest dim; everything else dark. */
export const HOME_PALETTE = Object.freeze({ off: LED_OFF, item: 119, selected: 120, selectedDim: 118 });

/*
 * The Path map's pads (pathmap/leds.mjs): a lit pad is a place you can walk
 * to, coloured by its state; water is dark. Move palette indices.
 */
export const MAP_PALETTE = Object.freeze({
  off: LED_OFF,
  done: LED_HIT,          /* Green                                         */
  current: 120,           /* White, pulsing with...                        */
  currentDim: 118,        /* LightGrey #595959                             */
  started: 79,            /* BrightYellow, dim #664E08                     */
  fresh: 119,             /* DarkGrey  #1A1A1A                             */
  ahead: 124,             /* DarkGrey2 #141414: later, drawn dimmer        */
  skipped: 95,            /* AzureBlue, dim #134566                        */
  avatar: 120,            /* White: where you stand                        */
});

/* A scene of the Path's pads (pathmap/anim.mjs): a green wave across them as
 * a flag goes up, white sparkles under fireworks. */
export const SCENE_PALETTE = Object.freeze({ off: LED_OFF, sweep: LED_HIT, sparkle: 120 });
