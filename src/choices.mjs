// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * choices.mjs — near-miss distractors for the picking quizzes. Pure.
 *
 * The wrong options have to be plausible or the quiz teaches nothing: three
 * options where two are obviously absurd is a quiz you pass by elimination
 * without ever hearing the answer. So a distractor is always the thing you
 * would ACTUALLY confuse the answer with — the drum next to it on the staff,
 * the subdivision either side of it, a groove with the same backbeat.
 */

import { VOICE_IDS, voiceIndex, voiceById } from './kit.mjs';

const SUBDIV_ORDER = ['quarters', 'eighths', 'triplets', 'sixteenths', 'sextuplets'];

/* Pick `n` from `pool`, nearest to `at` first, deterministically. */
function nearest(pool, at, n) {
  const sorted = pool
    .map((v, i) => ({ v, d: Math.abs(i - at) }))
    .filter((e) => e.d > 0)
    .sort((a, b) => a.d - b.d);
  return sorted.slice(0, n).map((e) => e.v);
}

/*
 * Voices you would mistake for this one: its neighbours on the staff. A snare
 * against a high tom is the confusion worth drilling; a snare against a crash
 * is not, and an option nobody would pick is a wasted option.
 */
export function voiceChoices(answer, pool = VOICE_IDS, n = 2) {
  const list = pool.filter((v) => v !== 'HO' || answer === 'HH' || answer === 'HO');
  const at = list.indexOf(answer);
  if (at < 0) return [answer];
  return [answer, ...nearest(list, at, n)];
}

/* Subdivisions either side — triplets against sixteenths is the whole point. */
export function subdivChoices(answer, n = 2) {
  const at = SUBDIV_ORDER.indexOf(answer);
  if (at < 0) return [answer];
  return [answer, ...nearest(SUBDIV_ORDER, at, n)];
}

/*
 * Grooves that feel alike. Two grooves sharing a backbeat and a subdivision
 * are told apart by the kick, which is exactly the listening being drilled.
 */
export function grooveChoices(answer, charts, n = 2) {
  const me = charts.find((c) => c.id === answer);
  if (!me) return [answer];
  const feel = (c) => c.events.length;
  const scored = charts
    .filter((c) => c.id !== answer)
    .map((c) => ({ id: c.id, d: Math.abs(feel(c) - feel(me)) }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return [answer, ...scored.slice(0, n).map((e) => e.id)];
}

/* Deterministic shuffle, so a seed replays the same question exactly. */
export function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export function voiceLabel(id) {
  const v = voiceById(id);
  return v ? v.label : id;
}

export function subdivLabel(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export { SUBDIV_ORDER, voiceIndex };
