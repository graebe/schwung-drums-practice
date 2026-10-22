// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The lesson cards, against the file that ships and the path that names them:
 * a card a step names and the file lacks is an explanation nobody reads, and
 * a card longer than two screens is not a short explanation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as LES from '../src/lessons.mjs';
import * as PLAN from '../src/program.mjs';
import * as P from '../src/progress.mjs';
import { createScreen } from '../tools/screen_buffer.mjs';
import { drawCard, CARD_TEXT_Y } from '../src/view.mjs';
import * as L from '../src/layout.mjs';

const { cards, ok } = LES.parseLessons(readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8'));
const screen = createScreen();
const measure = (t) => screen.textWidth(t);
const named = () => {
  const ids = new Set();
  for (const spec of PLAN.STAGES) {
    ids.add(spec.card);
    for (const s of spec.core.concat(spec.electives, [spec.checkpoint])) {
      for (const id of [].concat(s.card || [])) ids.add(id);
    }
  }
  return ids;
};

test('the file reads, and every card the path names is in it', () => {
  assert.equal(ok, true);
  for (const id of named()) assert.ok(cards.has(id), `${id} is named but not written`);
  for (const id of cards.keys()) assert.ok(named().has(id), `${id} is written but nothing shows it`);
});

test('every card fits two screens, every line the width', () => {
  for (const c of cards.values()) {
    const lines = LES.wrapText(c.text, L.SCREEN_W - 2, measure);
    for (const line of lines) assert.ok(measure(line) <= L.SCREEN_W - 2, `${c.id}: "${line}"`);
    assert.ok(LES.paginate(lines).length <= 2, `${c.id} runs to ${LES.paginate(lines).length} pages`);
    assert.ok(measure(c.title) <= L.SCREEN_W - 20, `${c.id}: title "${c.title}" crowds its page count`);
  }
});

test('words wrap at spaces, and a word too long for a line is cut, not run off', () => {
  const m = (t) => t.length;
  assert.deepEqual(LES.wrapText('one two three', 7, m), ['one two', 'three']);
  assert.deepEqual(LES.wrapText('abcdefghij', 4, m), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(LES.wrapText('', 4, m), []);
  assert.deepEqual(LES.paginate([]), [[]]);
  assert.equal(LES.paginate(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 2);
});

test('a broken file shows no cards rather than failing', () => {
  for (const text of [null, '', '{', '{"cards": 3}']) {
    const r = LES.parseLessons(text);
    assert.equal(r.cards.size, 0);
  }
  assert.equal(LES.parseLessons('{"cards":[{"id":"x"},{"id":"y","text":"t"}]}').cards.size, 1);
});

test('due: the stage card once, the step cards once — or always, or never', () => {
  const stage = { card: 'stage-0' };
  const step = { cards: ['pulse', 'result', 'nowhere'] };
  const path = P.defaultPath();
  assert.deepEqual(LES.dueCards(cards, path, step, stage), ['stage-0', 'pulse', 'result']);
  path.seen = ['stage-0', 'pulse'];
  assert.deepEqual(LES.dueCards(cards, path, step, stage), ['result']);
  path.intros = 'always';
  assert.deepEqual(LES.dueCards(cards, path, step, stage), ['pulse', 'result'],
    'always repeats the step\'s cards, not the stage\'s');
  path.intros = 'off';
  assert.deepEqual(LES.dueCards(cards, path, step, stage), []);
});

test('a stage\'s Lessons are its card, then its steps\' in order, once each', () => {
  const ids = LES.stageCards(cards, { card: 'stage-0' }, [{ cards: ['pulse', 'result'] }, { cards: ['pulse'] }]);
  assert.deepEqual(ids, ['stage-0', 'pulse', 'result']);
});

test('the card screen: title, page count, text and footer apart', () => {
  const texts = [];
  const c = createScreen();
  const text = c.text.bind(c);
  c.text = (x, y, s, v) => { texts.push({ x, y, w: c.textWidth(s), s }); return text(x, y, s, v); };
  const lines = LES.wrapText(cards.get('ghost-notes').text, L.SCREEN_W - 2, measure);
  drawCard(c, { title: 'Ghost notes', lines: LES.paginate(lines)[0], page: 0, pages: 2,
    footer: 'CLICK start PLAY hear' });
  assert.ok(texts.some((t) => t.s === '1/2'));
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    assert.ok(a.x >= 0 && a.x + a.w <= L.SCREEN_W && a.y + L.TEXT_H <= L.SCREEN_H, `off screen: ${a.s}`);
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j];
      if (Math.abs(a.y - b.y) >= L.TEXT_H || a.x + a.w <= b.x || b.x + b.w <= a.x) continue;
      assert.fail(`${a.s} over ${b.s}`);
    }
  }
  assert.ok(CARD_TEXT_Y + LES.LINES_PER_PAGE * L.TEXT_H <= L.SCREEN_H - L.TEXT_H, 'text runs into the footer');
});
