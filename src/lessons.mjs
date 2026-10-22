// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * lessons.mjs — the lesson cards: a short explanation before a practice.
 * Pure.
 *
 * A card names ONE concept — what a ghost note is, where you hear it, what to
 * listen for — in a screen or two, and stands before the first step of the
 * Path that needs it. One card per concept, not per drill, so a
 * concept is explained once and the cards read as a thread through the
 * course; each stage has a card of its own, what that world is.
 *
 * A card is never in the way. Click starts the practice — one press, read or
 * not — and Settings › Path › Intros says whether cards show once (new), every
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

/* ---- A deck on screen ------------------------------------------------------ */
/*
 * The cards shown in a row: before a step (`guided`, with the practice
 * waiting behind the last one) or from a stage's Lessons row. Each card is
 * wrapped to the screen when it comes up, by the caller's `measure` — the
 * font it is drawn in. ui.js holds the deck and does what only the host can
 * (marking a card read in progress, opening the step); what the deck does is
 * decided here.
 */
export function createDeck(cards, ids, { guided = false, measure, width }) {
  const deck = { cards, ids: ids.slice(), at: 0, page: 0, pages: [[]], title: '', guided, measure, width };
  lay(deck);
  return deck;
}

function lay(deck) {
  const c = deck.cards.get(deck.ids[deck.at]);
  deck.title = c ? c.title : '';
  deck.pages = paginate(wrapText(c ? c.text : '', deck.width, deck.measure));
  deck.page = 0;
}

export function turnPage(deck, delta) {
  deck.page = Math.max(0, Math.min(deck.pages.length - 1, deck.page + delta));
}

/* Click: the card on screen is read. Returns { read: [ids], done }: done when
 * that was the last, and the deck has nothing left to show. */
export function advance(deck) {
  const read = [deck.ids[deck.at]];
  if (deck.at + 1 < deck.ids.length) {
    deck.at++;
    lay(deck);
    return { read, done: false };
  }
  return { read, done: true };
}

/* Play, on a guided deck: every card left counts as read, and the deck is
 * done — the practice is heard at once. Nothing on a Lessons deck. */
export function skipToEnd(deck) {
  if (!deck.guided) return { read: [], done: false };
  return { read: deck.ids.slice(deck.at), done: true };
}

/* What drawCard draws. */
export function deckScreen(deck) {
  const more = deck.at + 1 < deck.ids.length;
  let footer;
  if (deck.guided) footer = more ? 'CLICK next  PLAY hear' : 'CLICK start PLAY hear';
  else footer = more ? 'CLICK next  BACK list' : 'CLICK done';
  return { title: deck.title, lines: deck.pages[deck.page], page: deck.page, pages: deck.pages.length, footer };
}
