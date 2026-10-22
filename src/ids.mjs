// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * ids.mjs — every identifier the module writes down, made and read in one
 * place. Pure, and a leaf.
 *
 * One string id joins the drill tree, progress.json, stats.json and the
 * Learning Path, so its shape is a file format: a drill's own id, a rung of a
 * groove (`rock-backbeat:l3`), a quiz round (`quiz:pick:subdiv:qe`), the Clock
 * (`clock`, or `clock:gap1` for a variant), and a stats record's drill id
 * (`drill:rock-backbeat:l3:normal:strict`). Drill ids contain colons
 * themselves (`subdiv:quarters`), so a reader cannot simply split: these
 * functions are the only ones that may build or take one apart, and their
 * round trips are tested (tests/ids.test.mjs).
 */

/* ---- Items: what progress.json files its takes under ---------------------- */

/* A rung of a groove's ladder: L0 (own pace) to L4. */
export const LEVEL_ID_RE = /:l([0-4])$/;
export const MAX_LEVEL = 4;

export function levelItemId(base, level) {
  return `${base}:l${level}`;
}

/* { base, level } for a rung's id, null for any other. */
export function parseLevelId(id) {
  const m = LEVEL_ID_RE.exec(id || '');
  return m ? { base: id.slice(0, -m[0].length), level: Number(m[1]) } : null;
}

export function isUntimedId(id) {
  const r = parseLevelId(id);
  return Boolean(r && r.level === 0);
}

/* The rungs above this one, lowest first; [] for anything but a rung. */
export function higherLevelIds(id) {
  const r = parseLevelId(id);
  if (!r) return [];
  const out = [];
  for (let n = r.level + 1; n <= MAX_LEVEL; n++) out.push(levelItemId(r.base, n));
  return out;
}

/* A quiz round: its mode and kind, and the pool a path step narrowed it to
 * (`kit3`), which makes it an exercise — and an item — of its own. */
export function quizItemId(mode, kind, variant = '') {
  return `quiz:${mode}:${kind}${variant ? `:${variant}` : ''}`;
}

export function isQuizItemId(id) {
  return String(id).indexOf('quiz:') === 0;
}

/* The Clock, and its variants (`gap1`, `24`, `off` — docs/curriculum.md):
 * each its own item, so learning one does not tick the others. */
export const CLOCK_ID = 'clock';

export function clockItemId(variant = '') {
  return variant ? `${CLOCK_ID}:${variant}` : CLOCK_ID;
}

export function isClockItemId(id) {
  return id === CLOCK_ID || String(id).indexOf(`${CLOCK_ID}:`) === 0;
}

/* ---- Records: what stats.json files a take under -------------------------- */

export const STRICTNESS = ['loose', 'normal', 'tight'];
export const QUIZ_KINDS = ['guess', 'hear', 'pick'];

/* A take's record id: how it was played (`drill`, `ladder`, `clock`,
 * `untimed`), what, and on which strictness and sticking. */
export function drillId(kind, id, opts = {}) {
  const parts = [kind, id];
  if (opts.strictness) parts.push(opts.strictness);
  if (opts.sticking && opts.sticking !== 'off') parts.push(opts.sticking);
  return parts.join(':');
}

/*
 * A record's drill id read back: { kind, id, strictness, sticking }. The id
 * is everything between the kind and the first strictness; a quiz round's id
 * (`pick:subdiv:qe`) has no strictness and is the kind and the rest.
 */
export function parseDrillId(d) {
  const parts = String(d).split(':');
  const kind = parts[0];
  if (QUIZ_KINDS.indexOf(kind) >= 0) {
    return { kind, id: parts.slice(1).join(':'), strictness: '', sticking: '' };
  }
  let end = parts.length;
  for (let i = 1; i < parts.length; i++) {
    if (STRICTNESS.indexOf(parts[i]) >= 0) { end = i; break; }
  }
  return {
    kind,
    id: parts.slice(1, end).join(':'),
    strictness: parts[end] || '',
    sticking: parts[end + 1] || '',
  };
}

/* The item a record belongs to, or null for a kind that is filed nowhere. */
export function itemOfDrillId(d) {
  const { kind, id } = parseDrillId(d);
  if (QUIZ_KINDS.indexOf(kind) >= 0) return `quiz:${kind}:${id}`;
  if (kind === 'clock') return CLOCK_ID;
  if (kind === 'drill' || kind === 'ladder' || kind === 'untimed') return id;
  return null;
}
