// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * hints.mjs — what every screen's keys do, as one table. Pure.
 *
 * The student is never left to guess which keys work: the bottom line of a
 * screen names them, in the Move's own words — `CLICK open  BACK up` — and
 * MENU's help page lists the same pairs. One table, so the hint line and the
 * help cannot disagree, and a test walks every screen and fails on one the
 * table forgot.
 *
 * A hint is a list of [KEY, verb] pairs, packed into parts of at most 21
 * characters — one line of the 5x7 font — with two spaces between pairs. A
 * hint that needs more than one part rotates, a part every ROTATE_MS. While
 * Shift is held the line shows what Shift does on that screen instead.
 *
 * The screen names live here too, so the table and ui.js cannot drift apart.
 */

export const SCREENS = Object.freeze({
  MENU: 'menu',
  READY: 'ready',
  RUNNING: 'running',
  SUMMARY: 'summary',
  LADDER: 'ladder',
  QUIZ: 'quiz',
  RESULT: 'result',
  PROGRESS: 'progress',
  PROGRESS_ITEM: 'progressItem',
  SETTINGS: 'settings',
  ERROR: 'error',
  CARD: 'card',
  PADMAP: 'padmap',
  SHEET: 'sheet',
  HELP: 'help',
  WELCOME: 'welcome',
  TIP: 'tip',
  /* A folder of the Path shown as its map (map_places.mjs): ui.js keeps the
   * screen MENU and draws the map when the open folder is one. */
  MAP: 'map',
});

const S = SCREENS;

/* One line of the host font: 21 characters on a 6px advance is 126px. */
export const HINT_CHARS = 21;
export const ROTATE_MS = 3000;
export const KEYS = ['JOG', 'CLICK', 'BACK', 'MENU', 'SHIFT', 'PLAY', 'REC', 'PAD'];

const QUIT = ['BACK', 'quit'];
const SETTINGS = ['CLICK', 'settings'];

/*
 * The pairs a screen's hint line names, and what Shift does there.
 *   st   what the screen is showing: { depth } for the list, { mode, paused,
 *        untimed } for a run, { pick, audible, hintsLeft } for a quiz,
 *        { guided, more, pages } for a card, { asks } for the welcome, …
 * Returns { keys, shift }, or null for a screen it does not know.
 */
export function keysFor(screen, st = {}) {
  switch (screen) {
    case S.MENU:
      return { keys: st.depth > 1 ? [['CLICK', 'open'], ['BACK', 'up']] : [['CLICK', 'open'], ['MENU', 'help']],
        shift: [['CLICK', 'options'], QUIT] };
    case S.MAP:
      return { keys: [['PAD', 'go'], ['CLICK', 'enter'], ['PLAY', 'continue'], ['MENU', 'help']],
        shift: [['CLICK', 'options'], QUIT] };
    case S.SHEET:
      return { keys: [['CLICK', 'do it'], ['BACK', 'close']], shift: [['CLICK', 'do it'], QUIT] };
    case S.HELP:
      return { keys: [['JOG', 'scroll'], ['BACK', 'close']], shift: [QUIT] };
    case S.WELCOME:
      return { keys: st.asks ? [['JOG', 'pick'], ['CLICK', 'go on']] : [['JOG', 'page'], ['CLICK', 'go on']],
        shift: [QUIT] };
    case S.TIP:
      return { keys: st.scrolls ? [['JOG', 'scroll'], ['CLICK', 'go on']] : [['CLICK', 'go on']], shift: [QUIT] };
    case S.CARD: {
      const keys = st.pages > 1 ? [['JOG', 'page']] : [];
      if (st.guided) keys.push(['CLICK', st.more ? 'next' : 'start'], ['PLAY', 'hear']);
      else keys.push(...(st.more ? [['CLICK', 'next'], ['BACK', 'list']] : [['CLICK', 'done']]));
      return { keys, shift: [SETTINGS, QUIT] };
    }
    case S.READY:
      return { keys: [['REC', 'start'], ['PLAY', st.untimed ? 'hear' : 'listen'], ['BACK', 'up']],
        shift: [SETTINGS, QUIT] };
    case S.RUNNING: {
      let keys;
      if (st.untimed) keys = [['REC', st.paused ? 'go on' : 'pause'], ['PLAY', 'hear'], ['BACK', 'stop']];
      else if (st.paused) keys = [[st.mode === 'listen' ? 'PLAY' : 'REC', 'go on'], ['BACK', 'stop']];
      else if (st.mode === 'listen') keys = [['PLAY', 'pause'], ['BACK', 'stop']];
      else keys = [['REC', 'pause'], ['BACK', 'stop']];
      return { keys, shift: [SETTINGS, QUIT] };
    }
    case S.SUMMARY:
      return { keys: st.clock ? [['REC', 'again'], ['BACK', 'start']] : [['CLICK', 'next'], ['REC', 'again']],
        shift: [SETTINGS, QUIT] };
    case S.LADDER:
      return { keys: [['REC', 'again'], ['BACK', 'start']], shift: [SETTINGS, QUIT] };
    case S.QUIZ: {
      const keys = [['PAD', 'answer']];
      if (st.hintsLeft > 0) keys.push(['REC', 'help']);
      else if (st.pick) keys.push(['CLICK', 'ok']);
      if (st.audible) keys.push(['PLAY', 'again']);
      keys.push(['BACK', 'list']);
      return { keys, shift: [SETTINGS, QUIT] };
    }
    case S.RESULT:
      return { keys: st.path ? [['CLICK', 'next'], ['BACK', 'list']] : [['CLICK', 'done']],
        shift: [SETTINGS, QUIT] };
    case S.PROGRESS:
      return { keys: [['CLICK', 'chart'], ['BACK', 'up']], shift: [SETTINGS, QUIT] };
    case S.PROGRESS_ITEM:
      return { keys: [['JOG', 'next'], ['BACK', 'list']], shift: [SETTINGS, QUIT] };
    case S.SETTINGS:
      return { keys: st.editing ? [['JOG', 'change'], ['CLICK', 'done']] : [['CLICK', 'edit'], ['BACK', 'up']],
        shift: [['CLICK', 'close'], QUIT] };
    case S.PADMAP:
      return { keys: [['PAD', 'hear'], ['JOG', 'layout'], ['BACK', 'save']], shift: [SETTINGS, QUIT] };
    case S.ERROR:
      return { keys: [['BACK', 'close']], shift: [QUIT] };
    default:
      return null;
  }
}

/*
 * Pairs into parts no longer than `width`: as many pairs to a part as fit,
 * two spaces apart, each part opening with `prefix` ("SHIFT: ").
 */
export function pack(pairs, prefix = '', width = HINT_CHARS) {
  const parts = [];
  let line = '';
  for (const [key, verb] of pairs) {
    const pair = `${key} ${verb}`;
    const tryLine = line ? `${line}  ${pair}` : `${prefix}${pair}`;
    if (tryLine.length <= width || !line) {
      line = tryLine;
      continue;
    }
    parts.push(line);
    line = `${prefix}${pair}`;
  }
  if (line) parts.push(line);
  return parts;
}

/* The hint line of a screen, as its parts. Shift held shows the Shift layer. */
export function hintFor(screen, st = {}) {
  const k = keysFor(screen, st);
  if (!k) return [];
  return st.shift ? pack(k.shift, 'SHIFT: ') : pack(k.keys);
}

/* The part on screen at `nowMs`: each stays ROTATE_MS. */
export function hintAt(parts, nowMs) {
  if (!parts || !parts.length) return '';
  return parts[Math.floor(Math.max(0, nowMs) / ROTATE_MS) % parts.length];
}

/*
 * The same pairs as help lines, the key padded to a column as the welcome
 * card writes them — "CLICK  open" — then Shift's: "SHIFT+CLICK  options".
 * A help page with a scrollbar has 20 characters, so a Shift line that
 * would take 21 closes up to one space rather than wrap.
 */
export const KEY_LINE_CHARS = 20;

export function keyLines(screen, st = {}) {
  const k = keysFor(screen, st);
  if (!k) return [];
  const out = k.keys.map(([key, verb]) => `${key.padEnd(7)}${verb}`);
  for (const [key, verb] of k.shift) {
    const line = `SHIFT+${key}  ${verb}`;
    out.push(line.length <= KEY_LINE_CHARS ? line : `SHIFT+${key} ${verb}`);
  }
  return out;
}
