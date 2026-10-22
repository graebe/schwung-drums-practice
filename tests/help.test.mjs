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

const text = readFileSync(new URL('../src/help.json', import.meta.url), 'utf8');
const topics = HP.parseHelp(text);
const measure = (s) => s.length * 6 - 1;

test('every line of help.json fits one line of the panel', () => {
  assert.ok(topics.size >= 15);
  for (const [title, lines] of topics) {
    assert.ok(title.length <= H.HINT_CHARS, title);
    for (const l of lines) assert.ok(l.length <= H.HINT_CHARS, `${title}: "${l}" is ${l.length}`);
  }
});

test('help speaks the shared words: Path, stage, Review — never the old names', () => {
  for (const [title, lines] of topics) {
    const all = [title].concat(lines).join(' ');
    for (const old of [/Learning Path/, /\bphase/i, /Repetition/, /Training/, /Your path/, /Skip all here/,
      /Skip next/, /Basics/]) {
      assert.ok(!old.test(all), `${title} still says ${old}`);
    }
  }
});

test('every screen has a page: what it is, its keys, and topics help.json holds', () => {
  for (const screen of Object.values(H.SCREENS)) {
    for (const st of [{}, { section: 'Path' }, { section: 'Practice' }, { group: 'pads' }, { untimed: true,
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

test('a lesson card joins the page wrapped, under its title', () => {
  const lines = HP.cardLines([{ title: '1 Eighth notes', text: 'Two notes per beat: 1 & 2 &. Most rock and pop lives here.' }],
    126, measure);
  assert.equal(lines[0], '');
  assert.equal(lines[1], '1 EIGHTH NOTES');
  for (const l of lines) assert.ok(measure(l) <= 126, l);
  const page = HP.helpPage(H.SCREENS.MENU, { topics, extra: lines });
  assert.ok(page.lines.includes('1 EIGHTH NOTES'));
  assert.deepEqual(HP.cardLines(null, 126, measure), []);
});

test('the page scrolls by the jog and stops at both ends', () => {
  const help = { lines: new Array(10).fill('x'), top: 0 };
  assert.equal(HP.scrollHelp(help, -3), 0);
  assert.equal(HP.scrollHelp(help, 3), 3);
  assert.equal(HP.scrollHelp(help, 30), 10 - HP.HELP_LINES);
  assert.equal(HP.scrollHelp({ lines: ['a'] }, 5), 0, 'a short page does not scroll');
});

test('a help.json that will not read is no help, not a crash', () => {
  assert.equal(HP.parseHelp('{oops').size, 0);
  assert.equal(HP.parseHelp(null).size, 0);
  assert.equal(HP.parseHelp('{"children": [{"title": 3}, {"title": "A", "lines": ["x", 4]}]}').get('A').length, 1);
  assert.ok(HP.helpPage('nowhere', {}).lines.length >= 0);
});
