// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * lessons.mjs — the lesson cards: a short explanation before a practice.
 * Pure.
 *
 * A card names ONE concept — what a ghost note is, where you hear it, what to
 * listen for — in a screen or two, and stands before the first step of the
 * Learning Path that needs it. One card per concept, not per drill, so a
 * concept is explained once and the cards read as a thread through the
 * course; each stage has a card of its own, what that world is.
 *
 * A card is never in the way. Click starts the practice — one press, read or
 * not — and Intros in Your path says whether cards show once (new), every
 * time (always) or never (off). Each stage folder lists its cards under
 * Lessons, to read again at any time.
 *
 * The text is data, in lessons.json, so it is written and corrected without
 * touching code; a card a step names that the file does not hold is simply not
 * shown.
 */

export const LINES_PER_PAGE = 6;

/* { cards: Map id -> { id, title, text }, ok }. Never throws. */
export function parseLessons(text) {
  const cards = new Map();
  let obj = null;
  try {
    obj = JSON.parse(text || '');
  } catch (e) {
    return { cards, ok: false };
  }
  if (!obj || !Array.isArray(obj.cards)) return { cards, ok: false };
  for (const c of obj.cards) {
    if (!c || typeof c.id !== 'string' || typeof c.text !== 'string') continue;
    cards.set(c.id, { id: c.id, title: typeof c.title === 'string' ? c.title : c.id, text: c.text });
  }
  return { cards, ok: true };
}

/*
 * Words into lines no wider than `maxPx` as `measure` reckons them. A word too
 * long for a line on its own is cut, which no card should need but a typo in
 * the file must not turn into text running off the screen.
 */
export function wrapText(text, maxPx, measure) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxPx) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    let w = word;
    while (measure(w) > maxPx && w.length > 1) {
      let n = w.length - 1;
      while (n > 1 && measure(w.slice(0, n)) > maxPx) n--;
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    line = w;
  }
  if (line) lines.push(line);
  return lines;
}

export function paginate(lines, perPage = LINES_PER_PAGE) {
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

/*
 * The cards to show before a step of the path, in order: its stage's card the
 * first time the stage is entered, then the step's own — those not yet read,
 * or all of them with Intros on `always`. None with Intros `off`, or for a
 * card the file does not hold.
 *   path   progress.path: { intros, seen }
 *   stage  the step's stage, for its card
 */
export function dueCards(cards, path, step, stage) {
  const intros = path.intros || 'new';
  if (intros === 'off' || !step) return [];
  const seen = new Set(path.seen || []);
  const out = [];
  if (stage && stage.card && cards.has(stage.card) && !seen.has(stage.card)) out.push(stage.card);
  for (const id of step.cards || []) {
    if (!cards.has(id) || out.indexOf(id) >= 0) continue;
    if (intros === 'always' || !seen.has(id)) out.push(id);
  }
  return out;
}

/* Every card of a stage, for its Lessons row: the stage's own, then each
 * step's in the order the stage takes them. */
export function stageCards(cards, stage, steps) {
  const out = [];
  const add = (id) => { if (id && cards.has(id) && out.indexOf(id) < 0) out.push(id); };
  add(stage.card);
  for (const st of steps) for (const id of st.cards || []) add(id);
  return out;
}
