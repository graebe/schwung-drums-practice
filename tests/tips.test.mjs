// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The welcome and the first-visit tips: who is welcomed, what each page says
 * in the words Piano Practice shares, and that every line fits the panel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/tips.mjs';
import * as P from '../src/progress.mjs';

const measure = (s) => s.length * 6 - 1;
const WIDTH = 126;

test('a newcomer is welcomed; a learner from before is only marked; once is enough', () => {
  const p = P.emptyProgress();
  assert.equal(T.welcomeOnLoad(p, 0), 'show');
  assert.equal(T.welcomeOnLoad(p, 3), 'silent', 'practised before the welcome existed');
  P.addTip(p, 'welcome');
  assert.equal(T.welcomeOnLoad(p, 0), 'none');
});

test('a tip is due once per screen kind, and never for the welcome', () => {
  const p = P.emptyProgress();
  assert.deepEqual(T.TIP_KEYS, ['welcome', 'sheet', 'practice', 'quiz']);
  for (const key of ['sheet', 'practice', 'quiz']) {
    assert.equal(T.tipDue(p, key), key);
    P.addTip(p, key);
    assert.equal(T.tipDue(p, key), null);
  }
  assert.equal(T.tipDue(p, 'welcome'), null);
  assert.equal(T.tipDue(p, null), null);
  assert.equal(T.tipDue(p, 'map'), null, 'a tip without words is none');
});

test('the words are the shared ones, wrapped to the panel', () => {
  assert.deepEqual(T.TIPS.sheet, ['Options for this row. JOG choose, CLICK do it, BACK close.']);
  assert.deepEqual(T.TIPS.practice, ['REC plays and scores it, PLAY lets you listen first. MENU: help.']);
  assert.deepEqual(T.TIPS.quiz, ['Answer with the lit pads or the jog. MENU: help.']);
  for (const key of Object.keys(T.TIPS)) {
    const lines = T.wrapParas(T.TIPS[key], WIDTH, measure);
    assert.ok(lines.length <= 6, `${key} runs past the card`);
    for (const l of lines) assert.ok(measure(l) <= WIDTH, `${key}: "${l}"`);
    assert.equal(lines.join(' '), T.TIPS[key].join(' '), `${key}: wrapping changed a word`);
  }
});

test('the welcome: two pages to read, then the question', () => {
  const pages = T.welcomePages();
  assert.deepEqual(pages.map((p) => p.title), ['Welcome', 'Keys', 'New to drums?']);
  assert.equal(pages[0].paras.join(' '),
    'Drums Practice takes you from your first beat to pro, one step a day. Lit pads can be pressed.');
  assert.deepEqual(pages[1].lines, ['JOG    move', 'CLICK  open', 'BACK   up one level', 'MENU   help, anywhere',
    'SHIFT+CLICK  options']);
  assert.deepEqual(pages[2].choices, ['From the start', 'I already play']);
  const first = T.wrapParas(pages[0].paras, WIDTH, measure);
  assert.ok(first.length <= 6);
  for (const l of pages[1].lines) assert.ok(l.length <= 21, l);
});

test('the jog pages and chooses, Click goes on and answers', () => {
  const w = T.createWelcome();
  T.welcomeJog(w, -1);
  assert.equal(w.page, 0);
  T.welcomeJog(w, 1);
  assert.equal(w.page, 1);
  assert.equal(T.welcomeClick(w), null);
  assert.equal(w.page, 2);
  assert.equal(T.welcomeClick(w), 'start');
  T.welcomeJog(w, 5);
  assert.equal(w.choice, 1);
  assert.equal(T.welcomeClick(w), 'play');
  T.welcomeJog(w, -5);
  assert.equal(w.choice, 0);
});
