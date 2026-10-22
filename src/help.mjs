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
 * help.json's lines are written for the panel, 21 characters at most, and
 * are shown as they are; a lesson card is prose and is wrapped by the caller's
 * measure.
 */

import * as H from './hints.mjs';
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
  [S.MENU]: ['LIST', ['The list: CLICK a row', 'to open it or play.']],
  [S.SHEET]: ['OPTIONS', ['Options for this row.']],
  [S.HELP]: ['HELP', ['This help.']],
  [S.WELCOME]: ['WELCOME', ['Your first steps.']],
  [S.TIP]: ['TIP', ['A tip, shown once.']],
  [S.CARD]: ['LESSON', ['A lesson card: what', 'comes next, and why.']],
  [S.READY]: ['READY', ['A drill, ready. REC', 'plays and scores it,', 'PLAY lets you listen.']],
  [S.RUNNING]: ['PLAYING', ['A take, under way.']],
  [S.SUMMARY]: ['RESULT', ['How the take went.']],
  [S.LADDER]: ['LADDER', ['How the climb went.']],
  [S.QUIZ]: ['QUIZ', ['A quiz round: answer', 'with the lit pads or', 'the jog.']],
  [S.RESULT]: ['ROUND', ['How the round went.']],
  [S.PROGRESS]: ['PROGRESS', ['How far you have got.']],
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

/* Lesson cards as help lines: a heading each, the text wrapped to `width`
 * as `measure` reckons it. */
export function cardLines(cards, width, measure) {
  const out = [];
  for (const c of cards || []) {
    out.push('', String(c.title || '').toUpperCase().slice(0, H.HINT_CHARS));
    out.push(...wrapText(c.text || '', width, measure));
  }
  return out;
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
  for (const title of topicsFor(screen, st)) {
    const t = topics.get(title);
    if (!t || !t.length) continue;
    lines.push('', title.toUpperCase(), ...t);
  }
  return { title: `HELP: ${about[0]}`, lines };
}

/* The help page's window: HELP_LINES at a time, scrolled by the jog. */
export const HELP_LINES = 6;

export function scrollHelp(help, delta) {
  const max = Math.max(0, help.lines.length - HELP_LINES);
  help.top = Math.max(0, Math.min(max, (help.top || 0) + delta));
  return help.top;
}
