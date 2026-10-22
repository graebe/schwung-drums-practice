// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANSWER_COLOURS, COLOUR_NAMES, LIST_MAX, MAX_ANSWERS,
  answerPads, answerAt, inAnswerBar, answerColour, answerLeds,
} from '../src/answer_pads.mjs';
import {
  PAD_FIRST, LED_OFF, LED_VOICE, LED_TARGET_FAR, LED_TARGET_NEAR, LED_PROMPT,
  LED_PRESSED, LED_HIT, LED_STICK, LED_MISS,
} from '../src/padmap.mjs';
import { paint } from '../src/led_paint.mjs';
import { createQuiz, pickAt, takeHint } from '../src/guess.mjs';

const cols = (n) => answerPads(n).map((pad) => pad - PAD_FIRST);

test('up to four answers sit on every other pad of the bottom row, centred', () => {
  assert.deepEqual(cols(0), []);
  assert.deepEqual(cols(1), [3]);
  assert.deepEqual(cols(2), [2, 5]);
  assert.deepEqual(cols(3), [1, 3, 5]);
  assert.deepEqual(cols(4), [0, 2, 4, 6]);
  assert.deepEqual(cols(8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(cols(99).length, MAX_ANSWERS, 'capped, never off the row');
});

test('a pad says which answer it is, and the bar includes its gaps', () => {
  assert.equal(answerAt(3, PAD_FIRST + 3), 1);
  assert.equal(answerAt(3, PAD_FIRST + 2), -1, 'a gap is no answer');
  assert.ok(inAnswerBar(3, PAD_FIRST + 2), 'but it is part of the bar: silent, not a drum');
  assert.ok(!inAnswerBar(3, PAD_FIRST + 8), 'the row above is drums');
  assert.ok(!inAnswerBar(0, PAD_FIRST), 'no answers, no bar');
});

test('the layouts are shared, so the LED repaint does not allocate', () => {
  assert.equal(answerPads(3), answerPads(3));
});

test('answer colours never borrow a colour that already means something on the drums', () => {
  /* LED_STICK — right drum, wrong hand — is why piano's orange is not here. */
  const taken = [LED_OFF, LED_VOICE, LED_TARGET_FAR, LED_TARGET_NEAR, LED_PROMPT,
    LED_PRESSED, LED_HIT, LED_STICK, LED_MISS];
  const seen = new Set();
  for (const c of ANSWER_COLOURS) {
    assert.ok(!taken.includes(c.bright) && !taken.includes(c.dim), c.name);
    assert.notEqual(c.bright, c.dim, c.name);
    assert.ok(!seen.has(c.bright), 'each colour once');
    seen.add(c.bright);
  }
  assert.ok(ANSWER_COLOURS.length >= LIST_MAX, 'a different colour for every listed answer');
  assert.deepEqual(COLOUR_NAMES, ANSWER_COLOURS.map((c) => c.name));
  assert.equal(answerColour(ANSWER_COLOURS.length), ANSWER_COLOURS[0]);
});

test('struck answers go dark, and the jog answer pulses in its own hue', () => {
  const out = [];
  answerLeds(3, 1, (i) => i === 2, 0, out);
  assert.deepEqual(out, [ANSWER_COLOURS[0].bright, ANSWER_COLOURS[1].dim, 0]);
  answerLeds(3, 1, () => false, 1, out);
  assert.equal(out[1], ANSWER_COLOURS[1].bright);
});

test('the bar owns the bottom row and nothing else; a judgement still shows over it', () => {
  const out = new Array(32);
  const pads = answerPads(3);
  const state = { layout: 'mpc', held: new Set([PAD_FIRST + 1, PAD_FIRST + 9]), flash: null,
    answerPads: pads, answerColours: [16, 14, 120] };
  paint(out, state);
  assert.deepEqual(out.slice(0, 8), [0, 16, 0, 14, 0, 120, 0, 0]);
  assert.equal(out[9], LED_PRESSED, 'above the bar the pads are drums');
  paint(out, { ...state, flash: { pads: [PAD_FIRST + 3], color: LED_HIT } });
  assert.equal(out[3], LED_HIT);
  paint(out, { ...state, answerPads: null });
  assert.equal(out[1], LED_PRESSED, 'no bar, no answers');
});

test('a pad answers exactly as the jog and Click would', () => {
  const q = createQuiz({ kind: 'subdiv', mode: 'pick', seed: 3 });
  const right = q.options.indexOf(q.prompt);
  const wrong = right === 0 ? 1 : 0;
  assert.equal(pickAt(q, wrong, 10), 'wrong');
  assert.ok(q.eliminated.includes(wrong));
  assert.equal(pickAt(q, wrong, 20), 'ignored', 'a struck answer cannot be chosen again');
  assert.equal(pickAt(q, 9, 20), 'ignored');
  assert.equal(pickAt(q, right, 30), 'right');
  assert.equal(q.correct, 1);
  assert.equal(pickAt(q, right, 40), 'ignored', 'answered: further presses do nothing');
  const g = createQuiz({ kind: 'voice', mode: 'guess', seed: 3 });
  assert.equal(pickAt(g, 0), 'ignored', 'a drum drill has no answers to pick');
  const h = createQuiz({ kind: 'groove', mode: 'pick', seed: 3, charts: [] });
  takeHint(h);
  assert.equal(pickAt(h, 0), 'ignored', 'no grooves, no options');
});
