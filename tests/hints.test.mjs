// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The hint line: every screen names its keys, every part fits one line of
 * the panel, and Shift shows its own layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as H from '../src/hints.mjs';

/* Each screen in every state its hint depends on. */
const STATES = [
  {}, { depth: 1 }, { depth: 3 }, { page: 0 }, { page: 2 },
  { guided: true, more: true, pages: 2 }, { guided: true }, { more: true }, { pages: 3 },
  { untimed: true }, { mode: 'listen' }, { mode: 'practice' }, { paused: true }, { paused: true, mode: 'listen' },
  { untimed: true, paused: true }, { clock: true }, { path: true }, { editing: true },
  { pick: true, audible: true, hintsLeft: 2 }, { pick: true, audible: true, hintsLeft: 0 }, { hintsLeft: 1 },
];

test('every screen has a hint, in every state, and every part fits the line', () => {
  for (const screen of Object.values(H.SCREENS)) {
    for (const st of STATES) {
      for (const shift of [false, true]) {
        const parts = H.hintFor(screen, { ...st, shift });
        assert.ok(parts.length > 0, `${screen} has no hint for ${JSON.stringify(st)}`);
        for (const p of parts) {
          assert.ok(p.length <= H.HINT_CHARS, `${screen}: "${p}" is ${p.length} characters`);
          assert.ok(!/[^\x20-\x7e]/.test(p), `${screen}: "${p}" is not plain ASCII`);
          if (shift) assert.ok(p.startsWith('SHIFT: '), `${screen}: "${p}" is not the Shift layer`);
        }
      }
    }
  }
});

test('a hint names a Move key, then its verb, two spaces between pairs', () => {
  for (const screen of Object.values(H.SCREENS)) {
    const k = H.keysFor(screen, {});
    for (const [key, verb] of k.keys.concat(k.shift)) {
      assert.ok(H.KEYS.includes(key), `${screen}: ${key} is no key of the Move`);
      assert.match(verb, /^[a-z][a-z ]*$/, `${screen}: "${verb}"`);
    }
  }
  assert.deepEqual(H.hintFor(H.SCREENS.MENU, { depth: 1 }), ['CLICK open  MENU help']);
  assert.deepEqual(H.hintFor(H.SCREENS.MENU, { depth: 2 }), ['CLICK open  BACK up']);
  assert.deepEqual(H.hintFor(H.SCREENS.SHEET), ['CLICK do it', 'BACK close']);
  assert.deepEqual(H.hintFor(H.SCREENS.HELP), ['JOG scroll', 'BACK close']);
  assert.deepEqual(H.hintFor(H.SCREENS.WELCOME, { page: 0 }), ['JOG page  CLICK go on']);
  assert.deepEqual(H.hintFor(H.SCREENS.MENU, { shift: true }), ['SHIFT: CLICK options', 'SHIFT: BACK quit']);
});

test('pairs pack as many to a part as fit, and an unknown screen has none', () => {
  assert.deepEqual(H.pack([['A', 'b'], ['C', 'd']]), ['A b  C d']);
  assert.deepEqual(H.pack([['REC', 'start'], ['PLAY', 'listen'], ['BACK', 'up']]),
    ['REC start', 'PLAY listen  BACK up']);
  assert.deepEqual(H.hintFor(H.SCREENS.READY), ['REC start', 'PLAY listen  BACK up']);
  assert.deepEqual(H.pack([['CLICK', 'a very long verb indeed']]), ['CLICK a very long verb indeed'],
    'a pair too long is a part of its own, never lost');
  assert.deepEqual(H.hintFor('nowhere'), []);
  assert.deepEqual(H.keyLines('nowhere'), []);
});

test('a long hint rotates a part every three seconds', () => {
  const parts = ['one', 'two', 'three'];
  assert.equal(H.hintAt(parts, 0), 'one');
  assert.equal(H.hintAt(parts, H.ROTATE_MS - 1), 'one');
  assert.equal(H.hintAt(parts, H.ROTATE_MS), 'two');
  assert.equal(H.hintAt(parts, 3 * H.ROTATE_MS), 'one');
  assert.equal(H.hintAt([], 5), '');
  assert.equal(H.hintAt(['only'], 99999), 'only');
});

test('help lines are the same pairs, the key in a column, then Shift', () => {
  assert.deepEqual(H.keyLines(H.SCREENS.MENU, { depth: 2 }),
    ['CLICK  open', 'BACK   up', 'SHIFT+CLICK  options', 'SHIFT+BACK  quit']);
  for (const screen of Object.values(H.SCREENS)) {
    for (const line of H.keyLines(screen, {})) assert.ok(line.length <= H.KEY_LINE_CHARS, `${screen}: "${line}"`);
  }
});

test('ui.js takes its screen names from the table, so none can be left without a hint', () => {
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.equal(/^const [A-Z_]+ = '[a-zA-Z]+';$/m.test(src.replace(/^const MODULE_DIR.*$/m, '')), false,
    'a screen declared outside hints.mjs');
  assert.match(src, /= H\.SCREENS;/);
});
