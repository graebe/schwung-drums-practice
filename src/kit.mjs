/*
 * kit.mjs — the nine voices. Pure, and a leaf apart from notation.
 *
 * This is the whole vertical vocabulary of the module, and the reason the
 * drum staff costs so little to draw: a voice declares the pitch it is
 * ENGRAVED AT, and every piece of staff geometry already written for pitches
 * — diatonic step, y, ledger lines — applies to it unchanged. The pitch is
 * notation, not sound: nothing is ever played at 72 because the snare is
 * written on C5.
 *
 * Order is top-to-bottom on the staff, which is also the order the grid view
 * stacks its lanes in and the channel order the DSP expects. One list, one
 * ordering, so a voice cannot mean one thing on screen and another in the
 * engine.
 */

import { diatonicOf } from './notation.mjs';

/*
 * head   'note'      filled oval — a drum
 *        'x'         a cymbal
 *        'circled-x' a cymbal struck or held differently (crash, open hat)
 * stem   'up'   hands
 *        'down' feet
 * That split is how a drum chart is engraved, and it is free: the reader
 * learns which limb plays what without a legend.
 */
export const VOICES = [
  { id: 'CR', label: 'Crash',   short: 'CR', pitch: 81, head: 'circled-x', stem: 'up'   },
  { id: 'HH', label: 'Hi-hat',  short: 'HH', pitch: 79, head: 'x',         stem: 'up'   },
  { id: 'HO', label: 'Open hat',short: 'HO', pitch: 79, head: 'circled-x', stem: 'up'   },
  { id: 'RD', label: 'Ride',    short: 'RD', pitch: 77, head: 'x',         stem: 'up'   },
  { id: 'HT', label: 'High tom',short: 'HT', pitch: 76, head: 'note',      stem: 'up'   },
  { id: 'SN', label: 'Snare',   short: 'SN', pitch: 72, head: 'note',      stem: 'up'   },
  { id: 'LT', label: 'Low tom', short: 'LT', pitch: 69, head: 'note',      stem: 'up'   },
  { id: 'KK', label: 'Kick',    short: 'KK', pitch: 65, head: 'note',      stem: 'down' },
  { id: 'HF', label: 'Hat foot',short: 'HF', pitch: 62, head: 'x',         stem: 'down' },
];

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

/* The DSP's channel for a voice — its index in VOICES. -1 if unknown. */
export function voiceIndex(id) {
  return VOICE_IDS.indexOf(id);
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
