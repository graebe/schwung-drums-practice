// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * help.mjs — MENU's help page: what the screen is, its keys, and the topics
 * of help.json that explain it. Pure.
 *
 * MENU opens help for the screen you are on, wherever you are: what the
 * screen is, its keys — the same pairs as its hint line, from hints.mjs, so
 * the two cannot disagree — and the topics of help.json that belong to it.
 * On a row of the Path it adds the lesson card behind it, so the WHY of a
 * step is one press away.
 *
 * The page opens on what belongs to this screen — what it is, its keys and
 * Shift's, the card behind the row — and only under a "More help" divider
 * the manual's topics.
 *
 * Every line is fitted by the font's real measure, not by counting
 * characters: help.json's lines are written short, and a line that still
 * runs wide is wrapped (fitPage), to the whole width while a page needs no
 * scrollbar and to the width beside it when it does.
 */

import * as H from './hints.mjs';
import * as L from './layout.mjs';
import { wrapText } from './lessons.mjs';

const S = H.SCREENS;

/* help.json as a map, topic title -> its lines. Never throws. */
export function parseHelp(text) {
  const topics = new Map();
  let obj = null;
  try {
    obj = JSON.parse(text || '');
  } catch (e) {
    return topics;
  }
  for (const t of (obj && Array.isArray(obj.children) ? obj.children : [])) {
    if (t && typeof t.title === 'string' && Array.isArray(t.lines)) {
      topics.set(t.title, t.lines.filter((l) => typeof l === 'string'));
    }
  }
  return topics;
}

/* What each screen is, in a line or two, and what its title says. */
const ABOUT = {
  [S.MENU]: ['LIST', ['The list: CLICK a', 'row to open it.']],
  [S.SHEET]: ['OPTIONS', ['Options for the row.']],
  [S.HELP]: ['HELP', ['This help.']],
  [S.WELCOME]: ['WELCOME', ['Your first steps.']],
  [S.TIP]: ['TIP', ['A tip, shown once.']],
  [S.CARD]: ['LESSON', ['A lesson card: what', 'comes next, and why.']],
  [S.READY]: ['READY', ['A drill, ready: REC', 'plays and scores it,', 'PLAY lets you hear', 'it first.']],
  [S.RUNNING]: ['PLAYING', ['A take, under way.']],
  [S.SUMMARY]: ['RESULT', ['How the take went.']],
  [S.LADDER]: ['LADDER', ['How the climb went.']],
  [S.QUIZ]: ['QUIZ', ['A quiz round: answer', 'with the lit pads or', 'the jog.']],
  [S.RESULT]: ['ROUND', ['How the round went.']],
  [S.PROGRESS]: ['PROGRESS', ['How far you got.']],
  [S.PROGRESS_ITEM]: ['CHART', ['One drill\'s takes.']],
  [S.SETTINGS]: ['SETTINGS', ['CLICK a row, then', 'turn the JOG.']],
  [S.PADMAP]: ['PAD MAP', ['Every pad, named.']],
  [S.ERROR]: ['ERROR', ['Something broke.']],
};

/* The list's topics by where you are in it: the top-level folder's label. */
const SECTION_TOPICS = {
  Continue: ['Path', 'Review', 'The sheet'],
  Path: ['Path', 'Review', 'The sheet'],
  Practice: ['The list', 'Own pace (L0)', 'The Ladder', 'The Clock', 'The sheet'],
  Quiz: ['Quiz'],
  Progress: ['Progress'],
  Settings: ['Settings'],
};

const GROUP_TOPICS = {
  practice: ['Study', 'Accents', 'Clean at tempo', 'Knobs'],
  sound: ['Sound', 'Latency'],
  pads: ['The pads'],
  midi: ['Sound'],
};

/* The topics of help.json a screen shows, in order. */
export function topicsFor(screen, st = {}) {
  switch (screen) {
    case S.MENU: return SECTION_TOPICS[st.section] || ['The list', 'The sheet'];
    case S.SHEET: return ['The sheet'];
    case S.WELCOME: case S.TIP: return ['The list'];
    case S.CARD: return ['Path'];
    case S.READY: case S.RUNNING: {
      const out = ['Playing'];
      if (st.untimed) out.push('Own pace (L0)');
      if (st.ladder) out.push('The Ladder');
      if (st.clock) out.push('The Clock');
      return out.concat('Knobs', 'Colours', 'Study');
    }
    case S.SUMMARY: return ['The result', 'Clean at tempo', 'Accents', 'Scoring'];
    case S.LADDER: return ['The Ladder'];
    case S.QUIZ: case S.RESULT: return ['Quiz'];
    case S.PROGRESS: case S.PROGRESS_ITEM: return ['Progress'];
    case S.SETTINGS: return GROUP_TOPICS[st.group] || ['Settings'];
    case S.PADMAP: return ['The pads'];
    default: return ['Overview'];
  }
}

/* Lesson cards as page items: a heading each, then the text as a paragraph
 * for fitPage to wrap. */
export function cardLines(cards) {
  const out = [];
  for (const c of cards || []) out.push('', String(c.title || '').toUpperCase(), { para: c.text || '' });
  return out;
}

/* The divider between what is this screen's and the manual. */
export const MORE_HELP = '-- More help --';

/*
 * Page items as the lines drawPage shows: a string is a line, kept as it is
 * when it fits and wrapped when it does not; { para } is prose, wrapped. The
 * whole width while the page fits in PAGE_ROWS lines, else the width beside
 * the scrollbar.
 */
export function fitPage(items, measure, rows = L.PAGE_ROWS) {
  const at = (width) => {
    const out = [];
    for (const it of items) {
      const text = typeof it === 'string' ? it : it.para;
      if (typeof it === 'string' && measure(text) <= width) out.push(text);
      else out.push(...(text ? wrapText(text, width, measure) : ['']));
    }
    return out;
  };
  const full = at(L.PAGE_FULL_PX);
  return full.length <= rows ? full : at(L.PAGE_TEXT_PX);
}

/*
 * The help page of a screen.
 *   st      what hints.mjs is told about the screen, plus `section` (the
 *           list's top-level folder) or `group` (the settings group)
 *   topics  parseHelp's map
 *   extra   lines the caller adds: the lesson card behind a row of the Path
 * Returns { title, lines }.
 */
export function helpPage(screen, { st = {}, topics = new Map(), extra = [] } = {}) {
  const about = ABOUT[screen] || ['HELP', []];
  const lines = about[1].slice();
  const keys = H.keyLines(screen, st);
  if (keys.length) lines.push('', ...keys);
  lines.push(...extra);
  let divided = false;
  for (const title of topicsFor(screen, st)) {
    const t = topics.get(title);
    if (!t || !t.length) continue;
    if (!divided) lines.push('', MORE_HELP);
    divided = true;
    lines.push('', title.toUpperCase(), ...t);
  }
  return { title: `HELP: ${about[0]}`, lines };
}

/* A page's window: PAGE_ROWS lines at a time, scrolled by the jog. */
export function scrollPage(page, delta) {
  const max = Math.max(0, page.lines.length - L.PAGE_ROWS);
  page.top = Math.max(0, Math.min(max, (page.top || 0) + delta));
  return page.top;
}
