/*
 * padmap.mjs — the zoned pad grid and the hand split. Pure.
 *
 * The grid is 4 rows of 8, notes 68..99, bottom-left to top-right.
 *
 * Two things are laid over it:
 *
 *   THE HAND SPLIT.  Columns 0..3 are the left hand, 4..7 the right. This is
 *   the whole reason sticking can be scored at all: a pad press carries which
 *   half of the grid it came from, so "RLRR LRLL" is checkable rather than
 *   decorative.
 *
 *   THE VOICE ZONES. Each layout assigns a voice to every pad. A voice owns a
 *   BLOCK rather than a pad, which is the one idea carried over unaltered
 *   from the pitched module: any pad in the block counts, so a double or a
 *   roll has two fingers to land on and nothing is lost to fumbling for a
 *   single 12mm square.
 *
 * The two halves MIRROR about the centre line, so a voice sits at the same
 * height under either hand. Learning the layout once rather than twice is
 * worth more than any ergonomic gain from arranging the hands differently,
 * and `tests/padmap.test.mjs` asserts the mirror rather than trusting it.
 */

import { VOICE_IDS, voiceIndex } from './kit.mjs';

export const PAD_FIRST = 68;
export const PAD_LAST = 99;
export const PAD_COUNT = 32;
export const COLS = 8;
export const ROWS = 4;

export const LEFT = 'L';
export const RIGHT = 'R';

/*
 * Layouts, written top row first because that is how they sit under your
 * hands and how the chart reads.
 *
 *   kit       ABLETON'S DRUM RACK ORDER. Move puts a Drum Rack on the left
 *             16 pads as a 4x4, and a Drum Rack is General MIDI from C1 (36)
 *             ascending left to right, bottom to top — which is why the kick
 *             is the bottom-left corner on every Move kit ever made. Using
 *             the same order means muscle memory carries straight from here
 *             into Move's own kits and back, which is worth more than any
 *             layout this module could invent.
 *
 *               48 HiMidTom  49 Crash   50 HighTom  51 Ride
 *               44 PedalHH   45 LowTom  46 OpenHH   47 LowMidTom
 *               40 ElecSnr   41 FloorTm 42 ClosedHH 43 FloorTm2
 *               36 KICK      37 Rim     38 SNARE    39 Clap
 *
 *             The nine voices here do not fill sixteen GM slots, so a slot
 *             with no exact match takes the nearest voice that does — a rim
 *             and a clap are struck on the snare, three GM toms share two.
 *             No pad is dead.
 *
 *   sticking  one surface, two hands. For rudiments, where the only
 *             questions are which hand and when.
 *
 * The right four columns DUPLICATE the left rather than mirroring them: the
 * Ableton order reads left to right, and reversing it for the right hand
 * would put the kick under the wrong finger and undo the point of matching.
 * Every voice is still reachable with either hand, which is all the sticking
 * model needs.
 */
const GRIDS = {
  sticking: [
    'SN SN SN SN SN SN SN SN',
    'SN SN SN SN SN SN SN SN',
    'SN SN SN SN SN SN SN SN',
    'SN SN SN SN SN SN SN SN',
  ],
  kit: [
    'HT CR HT RD HT CR HT RD',
    'HF LT HO HT HF LT HO HT',
    'SN LT HH LT SN LT HH LT',
    'KK SN SN SN KK SN SN SN',
  ],
};

export const LAYOUT_IDS = ['sticking', 'kit'];
export const DEFAULT_LAYOUT = 'kit';

/* Expand each grid once, into pad -> voice. Rows are written top-first but
 * pad row 0 is the BOTTOM row, so the written order is reversed here. */
const LAYOUTS = {};
for (const id of LAYOUT_IDS) {
  const rows = GRIDS[id].slice().reverse();
  const byPad = new Array(PAD_COUNT).fill(null);
  for (let row = 0; row < ROWS; row++) {
    const cells = rows[row].trim().split(/\s+/);
    for (let col = 0; col < COLS; col++) {
      const cell = cells[col];
      byPad[row * COLS + col] = cell === '.' ? null : cell;
    }
  }
  LAYOUTS[id] = byPad;
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

export function layoutExists(layout) {
  return Object.prototype.hasOwnProperty.call(LAYOUTS, layout);
}

/* The voice a pad plays in this layout, or null. */
export function padVoice(pad, layout = DEFAULT_LAYOUT) {
  if (!isPad(pad)) return null;
  const grid = LAYOUTS[layout];
  if (!grid) return null;
  return grid[pad - PAD_FIRST];
}

/*
 * Every pad that plays this voice — light or accept all of them. Pass a hand
 * to narrow it to that half, which is what the guide pads do when the drill
 * is enforcing sticking: lighting both halves would be telling you the note
 * and hiding the question.
 */
export function padsForVoice(voice, layout = DEFAULT_LAYOUT, hand = null) {
  const out = [];
  const grid = LAYOUTS[layout];
  if (!grid) return out;
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
  const grid = LAYOUTS[layout];
  if (!grid) return [];
  const seen = {};
  for (const id of grid) if (id) seen[id] = true;
  return VOICE_IDS.filter((id) => seen[id]);
}

/* The narrowest layout that can play every voice in the chart, or null. */
export function layoutForChart(chart) {
  const wanted = {};
  for (const ev of chart.events || []) for (const id of ev.voices || []) wanted[id] = true;
  const ids = Object.keys(wanted);
  for (const layout of LAYOUT_IDS) {
    const reach = layoutVoices(layout);
    if (ids.every((id) => reach.indexOf(id) >= 0)) return layout;
  }
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
 */
export const LED_OFF = 0;
export const LED_VOICE = 107;      /* DarkPurple   #220D66 — a voice is here */
export const LED_TARGET_FAR = 22;  /* Purple       #5722FF — it is coming    */
export const LED_TARGET_NEAR = 23; /* NeonPink     #972BFF — it is now       */
export const LED_PROMPT = 50;      /* LavenderBlue #BBAAF2 — quiz prompt     */
export const LED_PRESSED = 8;      /* BrightYellow #FFC516 — your finger     */
export const LED_HIT = 126;        /* Green        #00FF00                   */
export const LED_STICK = 3;        /* BrightOrange #C93C00 — wrong hand      */
export const LED_MISS = 127;       /* Red          #FF0000                   */
