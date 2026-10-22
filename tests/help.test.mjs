// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * MENU's help: help.json fits the panel, every screen has a page, and the
 * page names the screen's keys as its hint line does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as HP from '../src/help.mjs';
import * as H from '../src/hints.mjs';
import * as L from '../src/layout.mjs';
import * as T from '../src/tips.mjs';

const text = readFileSync(new URL('../src/help.json', import.meta.url), 'utf8');
const topics = HP.parseHelp(text);
const measure = (s) => s.length * 6 - 1;

test('every line of help.json fits beside the scrollbar as written, so none is wrapped', () => {
  assert.ok(topics.size >= 15);
  for (const [title, lines] of topics) {
    assert.ok(measure(title) <= L.PAGE_TEXT_PX, title);
    for (const l of lines) assert.ok(measure(l) <= L.PAGE_TEXT_PX, `${title}: "${l}" is ${measure(l)} px`);
  }
});

test('help speaks the shared words: Learning Path, stage, Review — never the old names', () => {
  for (const [title, lines] of topics) {
    const all = [title].concat(lines).join(' ');
    for (const old of [/\bphase/i, /Repetition/, /Training/, /Your path/, /Skip all here/,
      /Skip next/, /Basics/]) {
      assert.ok(!old.test(all), `${title} still says ${old}`);
    }
  }
});

test('every screen has a page: what it is, its keys, and topics help.json holds', () => {
  for (const screen of Object.values(H.SCREENS)) {
    for (const st of [{}, { section: 'Learning Path' }, { section: 'Practice' }, { group: 'pads' }, { untimed: true,
      ladder: true, clock: true }]) {
      for (const t of HP.topicsFor(screen, st)) assert.ok(topics.has(t), `${screen}: no topic "${t}"`);
      const page = HP.helpPage(screen, { st, topics });
      assert.ok(page.title.startsWith('HELP: ') && page.title.length <= H.HINT_CHARS, page.title);
      assert.ok(page.lines.length > 3, `${screen} has an empty page`);
      for (const l of page.lines) assert.ok(l.length <= H.HINT_CHARS, `${screen}: "${l}"`);
    }
  }
});

test('the keys on a page are the hint line\'s pairs, then Shift\'s', () => {
  const page = HP.helpPage(H.SCREENS.MENU, { st: { depth: 2 }, topics });
  for (const l of H.keyLines(H.SCREENS.MENU, { depth: 2 })) assert.ok(page.lines.includes(l), l);
  assert.ok(page.lines.includes('THE SHEET'), 'the list explains the sheet');
});

test('a lesson card joins the page as prose, under its title', () => {
  const items = HP.cardLines([{ title: '1 Eighth notes', text: 'Two notes per beat: 1 & 2 &. Most rock and pop lives here.' }]);
  assert.deepEqual(items.slice(0, 2), ['', '1 EIGHTH NOTES']);
  const lines = HP.fitPage(items, measure);
  assert.ok(lines.length > 3, 'the prose was not wrapped');
  assert.deepEqual(HP.cardLines(null), []);
});

test('the page opens on this screen: what it is, its keys, Shift\'s, the card — then More help', () => {
  const card = HP.cardLines([{ title: 'Pulse', text: 'Feel the beat.' }]);
  const page = HP.helpPage(H.SCREENS.MENU, { st: { depth: 2, section: 'Learning Path' }, topics, extra: card });
  const at = (l) => page.lines.indexOf(l);
  assert.equal(at('The list: CLICK a'), 0, 'what the screen is comes first');
  assert.ok(at('CLICK  open') < at('SHIFT+CLICK  options'));
  assert.ok(at('SHIFT+BACK  quit') < at('PULSE'), 'the card follows the keys');
  assert.ok(at('PULSE') < at(HP.MORE_HELP), 'the card is this screen\'s, above the divider');
  assert.ok(at(HP.MORE_HELP) < at('LEARNING PATH'), 'the manual is under the divider');
  assert.equal(page.lines.filter((l) => l === HP.MORE_HELP).length, 1);
});

/* A page's lines against the width drawPage gives them. */
function assertFits(what, lines) {
  const width = lines.length > L.PAGE_ROWS ? L.PAGE_TEXT_PX : L.PAGE_FULL_PX;
  for (const l of lines) assert.ok(measure(l) <= width, `${what}: "${l}" is ${measure(l)} px of ${width}`);
}

test('no line of help, a tip or the welcome runs past its page, measured as drawn', () => {
  for (const screen of Object.values(H.SCREENS)) {
    for (const st of [{}, { depth: 2 }, { section: 'Learning Path' }, { section: 'Practice' }, { group: 'pads' },
      { untimed: true, ladder: true, clock: true }, { editing: true }, { pick: true, audible: true, hintsLeft: 1 }]) {
      const card = HP.cardLines([{ title: 'A card', text: 'Words that run on well past the width of one line of the panel.' }]);
      const page = HP.helpPage(screen, { st, topics, extra: card });
      for (const l of page.lines) {
        if (typeof l === 'string') assert.ok(measure(l) <= L.PAGE_TEXT_PX, `${screen}: "${l}" would wrap`);
      }
      assertFits(screen, HP.fitPage(page.lines, measure));
    }
  }
  for (const key of Object.keys(T.TIPS)) assertFits(`tip ${key}`, HP.fitPage(T.tipItems(key), measure));
  for (const p of T.welcomePages()) {
    if (!p.items) continue;
    const lines = HP.fitPage(p.items, measure);
    assert.ok(lines.length <= L.PAGE_ROWS, `${p.title} needs a scrollbar: ${lines.join('|')}`);
    assertFits(p.title, lines);
  }
});

test('a page fits the whole width while it needs no scrollbar, and narrows when it does', () => {
  const wide = 'x'.repeat(21);
  assert.deepEqual(HP.fitPage([wide], measure), [wide], 'one line, no scrollbar: 125 px fit');
  const many = HP.fitPage(new Array(6).fill(wide), measure);
  assert.ok(many.length > 6, 'six lines scroll, so each is narrowed');
  assert.deepEqual(HP.fitPage(['KEY    verb'], measure), ['KEY    verb'], 'a line that fits keeps its spacing');
  assert.deepEqual(HP.fitPage([{ para: '' }], measure), ['']);
});

test('the page scrolls by the jog and stops at both ends', () => {
  const page = { lines: new Array(10).fill('x'), top: 0 };
  assert.equal(HP.scrollPage(page, -3), 0);
  assert.equal(HP.scrollPage(page, 3), 3);
  assert.equal(HP.scrollPage(page, 30), 10 - L.PAGE_ROWS);
  assert.equal(HP.scrollPage({ lines: ['a'] }, 5), 0, 'a short page does not scroll');
});

test('a help.json that will not read is no help, not a crash', () => {
  assert.equal(HP.parseHelp('{oops').size, 0);
  assert.equal(HP.parseHelp(null).size, 0);
  assert.equal(HP.parseHelp('{"children": [{"title": 3}, {"title": "A", "lines": ["x", 4]}]}').get('A').length, 1);
  assert.ok(HP.helpPage('nowhere', {}).lines.length >= 0);
});
