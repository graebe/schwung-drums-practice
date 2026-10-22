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

test('the words are the shared ones', () => {
  assert.deepEqual(T.TIPS.sheet, ['Options for this row. JOG choose, CLICK do it, BACK close.']);
  assert.deepEqual(T.TIPS.practice, ['REC plays and scores it, PLAY lets you listen first. MENU: help.']);
  assert.deepEqual(T.TIPS.quiz, ['Answer with the lit pads or the jog. MENU: help.']);
  assert.deepEqual(T.tipItems('quiz'), [{ para: T.TIPS.quiz[0] }]);
  assert.deepEqual(T.tipItems('nope'), []);
});

test('the welcome: the shared words on two pages, the keys, then the question', () => {
  const pages = T.welcomePages();
  assert.deepEqual(pages.map((p) => p.title), ['Welcome', 'Welcome', 'Keys', 'New to drums?']);
  assert.equal(pages.slice(0, 2).map((p) => p.items[0].para).join(' '),
    'Drums Practice takes you from your first beat to pro, one step a day. Lit pads can be pressed.');
  assert.deepEqual(pages[2].items, ['JOG    move', 'CLICK  open', 'BACK   up one level', 'MENU   help, anywhere',
    'SHIFT+CLICK  options']);
  assert.deepEqual(pages[3].choices, ['From the start', 'I already play']);
});

test('the jog pages and chooses, Click goes on and answers', () => {
  const w = T.createWelcome();
  T.welcomeJog(w, -1);
  assert.equal(w.page, 0);
  T.welcomeJog(w, 1);
  assert.equal(w.page, 1);
  assert.equal(T.welcomeClick(w), null);
  assert.equal(T.welcomeClick(w), null);
  assert.equal(w.page, 3);
  assert.equal(T.welcomeAsks(w), true);
  assert.equal(T.welcomeClick(w), 'start');
  T.welcomeJog(w, 5);
  assert.equal(w.choice, 1);
  assert.equal(T.welcomeClick(w), 'play');
  T.welcomeJog(w, -5);
  assert.equal(w.choice, 0);
});
