// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * tips.mjs — the welcome, the placement question, and the first-visit tips.
 * Pure.
 *
 * A newcomer is greeted once: what the module is, its keys, and one question
 * — new to drums, or already playing? — which either starts the path at the
 * beginning or opens it with a tip on testing out of a stage. Someone who has
 * practised before the welcome existed is not greeted: their first launch
 * after the update only notes the welcome as seen.
 *
 * Each tip is one card, shown the first time its screen comes up and never
 * again, until Settings › Help › Show tips again clears the list. The keys of
 * the tips shown are kept in progress.tips (progress.mjs) and saved with it.
 *
 * The words are shared with Piano Practice. They are written as sentences and
 * wrapped to the panel by the caller's measure (help.mjs fitPage), because a
 * line of the shared wording can be longer than the panel shows.
 */

import { hasTip } from './progress.mjs';

export const TIP_KEYS = ['welcome', 'sheet', 'practice', 'quiz', 'map', 'island'];

/* The tips, as paragraphs. `sheet` on the first action sheet, `practice` on
 * the first ready screen, `quiz` on the first quiz, `map` on the world map
 * and `island` on the first island. */
export const TIPS = {
  sheet: ['Options for this row. JOG choose, CLICK do it, BACK close.'],
  practice: ['REC plays and scores it, PLAY lets you listen first. MENU: help.'],
  quiz: ['Answer with the lit pads or the jog. MENU: help.'],
  map: ['Lit pads are places. Press one to walk there, again to go in. PLAY continues.'],
  island: ['Each place is part of the stage. The fort is its checkpoint, the signpost its lessons.'],
  placement: ['Know a stage already? SHIFT+CLICK a stage, then Test out: checkpoint. Pass it and the path '
    + 'moves on.'],
};

export const TIP_TITLE = 'Tip';

/*
 * The welcome's pages: the shared first page — on two screens, because its
 * words wrap to six lines and a page shows five — then the keys, then the
 * question. Each is page items for help.mjs fitPage: { para } is prose, a
 * string a line as it stands.
 */
export const WELCOME_CHOICES = ['From the start', 'I already play'];

export function welcomePages(moduleName = 'Drums Practice') {
  return [
    { title: 'Welcome', items: [{ para: `${moduleName} takes you from your first beat to pro, one step a day.` }] },
    { title: 'Welcome', items: [{ para: 'Lit pads can be pressed.' }] },
    { title: 'Keys', items: ['JOG    move', 'CLICK  open', 'BACK   up one level', 'MENU   help, anywhere',
      'SHIFT+CLICK  options'] },
    { title: 'New to drums?', choices: WELCOME_CHOICES },
  ];
}

const LAST = welcomePages().length - 1;

/* A tip as page items. */
export function tipItems(key) {
  return (TIPS[key] || []).map((para) => ({ para }));
}

/*
 * What a first launch does about the welcome:
 *   'show'    a newcomer — no welcome yet, and nothing practised
 *   'silent'  someone who practised before it existed: note it as seen
 *   'none'    already welcomed
 * `history` is how many takes and items there are on record.
 */
export function welcomeOnLoad(progress, history) {
  if (hasTip(progress, 'welcome')) return 'none';
  return history > 0 ? 'silent' : 'show';
}

/* The tip a screen shows on its first visit, or null when it has none or
 * it has been seen. */
export function tipDue(progress, key) {
  if (!key || key === 'welcome' || !TIPS[key]) return null;
  return hasTip(progress, key) ? null : key;
}

/* ---- The welcome on screen ---------------------------------------------- */

export function createWelcome() {
  return { page: 0, choice: 0 };
}

/* Whether the welcome is on its question. */
export function welcomeAsks(w) {
  return w.page >= LAST;
}

/* The jog: turns the pages to read, moves the choice on the last. */
export function welcomeJog(w, delta) {
  if (welcomeAsks(w)) {
    w.choice = Math.max(0, Math.min(WELCOME_CHOICES.length - 1, w.choice + delta));
    return;
  }
  w.page = Math.max(0, Math.min(LAST, w.page + delta));
}

/* Click: on to the next page, or, on the last, the answer —
 * 'start' (from the start) or 'play' (already plays). */
export function welcomeClick(w) {
  if (!welcomeAsks(w)) {
    w.page++;
    return null;
  }
  return w.choice === 0 ? 'start' : 'play';
}
