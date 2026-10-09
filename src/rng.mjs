// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * rng.mjs — a seeded pseudo-random generator. Pure, and a LEAF.
 *
 * Its own module because two unrelated things need it — the drill generator
 * and the quiz — and it belongs to neither. It lived in generator.mjs, which
 * meant guess.mjs imported a DRILL GENERATOR to get a random number.
 *
 * Seeded and identical across runs, which is what makes both callers testable
 * and lets you re-attempt the exact drill you just fluffed rather than a
 * different one.
 */

/* mulberry32 — small, fast, and identical across runs. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
