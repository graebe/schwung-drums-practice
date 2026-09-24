/*
 * exercise_io.mjs — loading and validating hand-written drills. Pure.
 *
 * Every error is returned, never thrown, and never partial: a drill either
 * validates whole or is rejected with a reason the menu can show. A
 * half-loaded chart would be scored against, and being marked down for a
 * typo in a file is worse than the file simply not appearing.
 */

import { isVoice, VOICE_IDS } from './kit.mjs';
import { layoutVoices, LAYOUT_IDS } from './padmap.mjs';
import { merge } from './generator.mjs';

const HANDS = ['R', 'L'];
const DYNS = ['accent', 'normal', 'ghost'];
const STICKINGS = ['strict', 'loose', 'off'];

export function validateExercise(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return ['not an object'];
  if (typeof obj.name !== 'string' || !obj.name) errs.push('name missing');
  if (obj.bpm !== undefined && !(obj.bpm >= 20 && obj.bpm <= 300)) errs.push('bpm out of range');
  if (obj.timeSig !== undefined) {
    const ts = obj.timeSig;
    if (!Array.isArray(ts) || ts.length !== 2 || !(ts[0] > 0) || !(ts[1] > 0)) {
      errs.push('timeSig must be [beats, unit]');
    }
  }
  if (obj.loopBars !== undefined && !(obj.loopBars >= 1 && obj.loopBars <= 16)) {
    errs.push('loopBars out of range');
  }
  if (obj.sticking !== undefined && !STICKINGS.includes(obj.sticking)) {
    errs.push(`sticking must be one of ${STICKINGS.join('/')}`);
  }
  if (!Array.isArray(obj.events) || obj.events.length === 0) {
    errs.push('no events');
    return errs;
  }

  let last = -Infinity;
  for (let i = 0; i < obj.events.length; i++) {
    const e = obj.events[i];
    const at = `event ${i}`;
    if (!e || typeof e !== 'object') { errs.push(`${at} is not an object`); continue; }
    if (!(typeof e.beat === 'number' && isFinite(e.beat) && e.beat >= 0)) {
      errs.push(`${at} has no beat`);
      continue;
    }
    /* Beats must run forwards. The scroll, the beam engine and the scoring
     * cursor all walk the list once and assume it is ordered; an out-of-order
     * event would simply never be reachable. */
    if (e.beat < last) errs.push(`${at} goes backwards in time`);
    last = e.beat;
    if (!Array.isArray(e.voices) || e.voices.length === 0) {
      errs.push(`${at} names no voices`);
      continue;
    }
    for (const v of e.voices) {
      if (!isVoice(v)) errs.push(`${at} names unknown voice ${JSON.stringify(v)}`);
    }
    if (e.hand !== undefined && !HANDS.includes(e.hand)) errs.push(`${at} hand must be R or L`);
    if (e.dyn !== undefined && !DYNS.includes(e.dyn)) errs.push(`${at} dyn must be accent/ghost`);
  }
  return errs;
}

export function normalizeExercise(obj, id) {
  const events = merge(
    obj.events
      .map((e) => ({
        beat: e.beat,
        voices: e.voices.slice(),
        hand: e.hand || null,
        dyn: e.dyn || 'normal',
      }))
      .sort((a, b) => a.beat - b.beat),
  );
  return {
    id: obj.id || id,
    name: obj.name,
    bpm: obj.bpm || 90,
    timeSig: obj.timeSig || [4, 4],
    loopBars: obj.loopBars || 1,
    sticking: obj.sticking || 'off',
    events,
  };
}

/* Returns { chart } or { error }. Never throws, whatever the file holds. */
export function parseExercise(text, id) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { error: `${id}: not valid JSON` };
  }
  const errs = validateExercise(obj);
  if (errs.length) return { error: `${id}: ${errs[0]}` };
  return { chart: normalizeExercise(obj, id) };
}

/*
 * The manifest. There is no directory-listing call in the host, which is the
 * only reason this file has to exist.
 */
export function parseManifest(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { entries: [], error: 'exercises/index.json is not valid JSON' };
  }
  const list = obj && Array.isArray(obj.exercises) ? obj.exercises : [];
  const entries = [];
  for (const e of list) {
    if (!e || typeof e.file !== 'string' || typeof e.id !== 'string') continue;
    entries.push({ id: e.id, name: e.name || e.id, file: e.file, group: e.group || '' });
  }
  return { entries };
}

/*
 * Warnings a drill can carry without being invalid.
 *
 * A chart that asks for a voice no pad layout can reach is playable nowhere,
 * and the player would simply be marked down for every one of those notes
 * with nothing on screen to say why. That is worth saying BEFORE the count-in
 * rather than discovering at the summary.
 */
export function playabilityWarnings(chart) {
  const out = [];
  const reachable = new Set();
  for (const layout of LAYOUT_IDS) for (const v of layoutVoices(layout)) reachable.add(v);

  const unreachable = [];
  for (const e of chart.events) {
    for (const v of e.voices) {
      if (!reachable.has(v) && !unreachable.includes(v)) unreachable.push(v);
    }
  }
  if (unreachable.length) out.push(`no pad for ${unreachable.join(' ')}`);

  if (chart.sticking !== 'off') {
    const withHand = chart.events.filter((e) => e.hand).length;
    if (withHand === 0) out.push('sticking is on but no hands are written');
  }
  return out;
}

export { VOICE_IDS };
