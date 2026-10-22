// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * kit.mjs — the voices of the kit. Pure, and a leaf apart from notation.
 *
 * This is the whole vertical vocabulary of the module, and the reason the
 * drum staff costs so little to draw: a voice declares the pitch it is
 * ENGRAVED AT, and every piece of staff geometry already written for pitches
 * — diatonic step, y, ledger lines — applies to it unchanged. The pitch is
 * notation, not sound: nothing is ever played at 72 because the snare is
 * written on C5.
 *
 * Order is top-to-bottom on the staff, which is also the order the grid view
 * stacks its lanes in. One list, one ordering, so a voice cannot mean one
 * thing on screen and another on the pads.
 */

import { diatonicOf } from './notation.mjs';

/*
 * head   'note'      filled oval — a drum
 *        'x'         a cymbal, or the rim (a cross-stick on the snare's space)
 *        'circled-x' a cymbal struck or held differently (crash, open hat),
 *                    and the clap on the snare's space
 *        'diamond'   the second snare
 *        'triangle'  the cowbell and the tambourine — hand percussion
 *        'slash'     the shaker
 * stem   'up'   hands
 *        'down' feet
 * That split is how a drum chart is engraved, and it is free: the reader
 * learns which limb plays what without a legend.
 *
 * `gm` is the General MIDI drum note — the ONE table of what a voice sounds
 * like: the DSP plays its recorded kit by it, MIDI out sends it, and the
 * Chromatic pad layout is laid out by it. It used to be written out twice,
 * here in ui.js and again in the DSP, and the two could drift apart.
 *
 * Twenty-one voices: the sixteen GM drums from 36 to 51, and Kick 2, China,
 * tambourine, cowbell and shaker. Five lines cannot give six toms a space each
 * and still keep the nine voices every drill was written in where they always
 * were, and nothing fits above the crash's ledger without striking the beams
 * of a 64-pixel staff — so voices that share a pitch differ by head or stem,
 * and no two share all three (tests/kit.test.mjs): the China, cowbell and
 * crash on the ledger, the shaker, tambourine and hats above the staff, the
 * rim, clap and second snare in the snare's space, the low floor tom with its
 * stem up beside the kick.
 */
export const VOICES = [
  { id: 'CR', label: 'Crash',      short: 'CR', gm: 49, pitch: 81, head: 'circled-x', stem: 'up'   },
  { id: 'FX', label: 'China',      short: 'FX', gm: 52, pitch: 81, head: 'x',         stem: 'up'   },
  { id: 'P1', label: 'Cowbell',    short: 'P1', gm: 56, pitch: 81, head: 'triangle',  stem: 'up'   },
  { id: 'HH', label: 'Hi-hat',     short: 'HH', gm: 42, pitch: 79, head: 'x',         stem: 'up'   },
  { id: 'HO', label: 'Open hat',   short: 'HO', gm: 46, pitch: 79, head: 'circled-x', stem: 'up'   },
  { id: 'P2', label: 'Tambourine', short: 'P2', gm: 54, pitch: 79, head: 'triangle',  stem: 'up'   },
  { id: 'SH', label: 'Shaker',     short: 'SH', gm: 70, pitch: 79, head: 'slash',     stem: 'up'   },
  { id: 'RD', label: 'Ride',       short: 'RD', gm: 51, pitch: 77, head: 'x',         stem: 'up'   },
  { id: 'HT', label: 'High tom',   short: 'HT', gm: 50, pitch: 76, head: 'note',      stem: 'up'   },
  { id: 'HM', label: 'Hi-mid tom', short: 'HM', gm: 48, pitch: 74, head: 'note',      stem: 'up'   },
  { id: 'SN', label: 'Snare',      short: 'SN', gm: 38, pitch: 72, head: 'note',      stem: 'up'   },
  { id: 'RM', label: 'Rim',        short: 'RM', gm: 37, pitch: 72, head: 'x',         stem: 'up'   },
  { id: 'CL', label: 'Clap',       short: 'CL', gm: 39, pitch: 72, head: 'circled-x', stem: 'up'   },
  { id: 'S2', label: 'Snare 2',    short: 'S2', gm: 40, pitch: 72, head: 'diamond',   stem: 'up'   },
  { id: 'MT', label: 'Mid tom',    short: 'MT', gm: 47, pitch: 71, head: 'note',      stem: 'up'   },
  { id: 'LT', label: 'Low tom',    short: 'LT', gm: 45, pitch: 69, head: 'note',      stem: 'up'   },
  { id: 'F1', label: 'Floor tom',  short: 'F1', gm: 43, pitch: 67, head: 'note',      stem: 'up'   },
  { id: 'F2', label: 'Low floor',  short: 'F2', gm: 41, pitch: 65, head: 'note',      stem: 'up'   },
  { id: 'KK', label: 'Kick',       short: 'KK', gm: 36, pitch: 65, head: 'note',      stem: 'down' },
  { id: 'K2', label: 'Kick 2',     short: 'K2', gm: 35, pitch: 64, head: 'note',      stem: 'down' },
  { id: 'HF', label: 'Hat foot',   short: 'HF', gm: 44, pitch: 62, head: 'x',         stem: 'down' },
];

/*
 * The nine voices the module began with, which the drum quizzes ask about:
 * a beginner learns the kit a beat is made of, not twenty-one sounds at
 * once. The rest are named on the Pad map screen.
 */
export const CORE_VOICES = ['CR', 'HH', 'HO', 'RD', 'HT', 'SN', 'LT', 'KK', 'HF'];

for (const v of VOICES) {
  v.diatonic = diatonicOf(v.pitch);
  v.limb = v.stem === 'down' ? 'foot' : 'hand';
}

export const VOICE_IDS = VOICES.map((v) => v.id);

const BY_ID = {};
for (let i = 0; i < VOICES.length; i++) BY_ID[VOICES[i].id] = VOICES[i];

export function voiceById(id) {
  return BY_ID[id] || null;
}

export function isVoice(id) {
  return Object.prototype.hasOwnProperty.call(BY_ID, id);
}

/* A voice's place in staff order, top to bottom. -1 if unknown. */
export function voiceIndex(id) {
  return VOICE_IDS.indexOf(id);
}

/* The General MIDI note a voice sounds as, or 0 if unknown. */
export function gmOf(id) {
  const v = BY_ID[id];
  return v ? v.gm : 0;
}

/* Sort voice ids into staff order, top to bottom. Used everywhere a stack of
 * simultaneous hits is drawn or named, so the order never depends on the
 * order they happened to be written in. */
export function sortVoices(ids) {
  return ids.slice().sort((a, b) => voiceIndex(a) - voiceIndex(b));
}

/*
 * The voices a chart actually uses, in staff order. The grid view sizes its
 * lanes from this — a two-voice rudiment gets tall lanes rather than six
 * empty ones — and the LED painter uses it to know what is worth lighting.
 */
export function voicesInChart(chart) {
  const seen = {};
  for (const ev of chart.events || []) {
    for (const id of ev.voices || []) seen[id] = true;
  }
  return VOICE_IDS.filter((id) => seen[id]);
}

/* Space-joined labels for a stack, top to bottom: "HH SN". */
export function stackLabel(ids) {
  return sortVoices(ids)
    .map((id) => (BY_ID[id] ? BY_ID[id].short : id))
    .join(' ');
}
