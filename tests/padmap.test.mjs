// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/padmap.mjs';
import { VOICE_IDS } from '../src/kit.mjs';

test('the grid covers 32 pads, four rows of eight', () => {
  assert.equal(P.PAD_LAST - P.PAD_FIRST + 1, P.PAD_COUNT);
  for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
    const { row, col } = P.padRowCol(pad);
    assert.ok(row >= 0 && row < P.ROWS);
    assert.ok(col >= 0 && col < P.COLS);
    assert.equal(P.padAt(row, col), pad);
  }
  assert.equal(P.isPad(67), false);
  assert.equal(P.isPad(100), false);
});

test('the hand split is the left half of the grid', () => {
  for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
    const { col } = P.padRowCol(pad);
    assert.equal(P.padHand(pad), col < 4 ? P.LEFT : P.RIGHT);
  }
  assert.equal(P.twinCol(0), 4);
  assert.equal(P.twinCol(3), 7);
  assert.equal(P.twinCol(7), 3);
});

test('every layout assigns every pad a known voice', () => {
  for (const layout of P.LAYOUT_IDS) {
    for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
      const v = P.padVoice(pad, layout);
      assert.ok(v !== null, `${layout} pad ${pad} is unassigned`);
      assert.ok(VOICE_IDS.includes(v), `${layout} pad ${pad} -> unknown voice ${v}`);
    }
  }
});

test('the halves DUPLICATE, so the Ableton order reads the same under each hand', () => {
  /* Not mirrored: a Drum Rack reads left to right, and reversing it for the
   * right hand would put the kick under the wrong finger. */
  for (const layout of P.LAYOUT_IDS) {
    for (let row = 0; row < P.ROWS; row++) {
      for (let col = 0; col < P.COLS; col++) {
        assert.equal(
          P.padVoice(P.padAt(row, col), layout),
          P.padVoice(P.padAt(row, P.twinCol(col)), layout),
          `${layout} row ${row} col ${col} differs from its twin`,
        );
      }
    }
  }
});

test('the kit follows Ableton\'s Drum Rack order', () => {
  /*
   * Move lays a Drum Rack on the left 16 pads as a 4x4, General MIDI from C1
   * ascending left to right, bottom to top. Matching it means muscle memory
   * carries between this module and Move's own kits.
   */
  const at = (row, col) => P.padVoice(P.padAt(row, col), 'kit');
  assert.equal(at(0, 0), 'KK', 'GM 36 — the kick is the bottom-left corner');
  assert.equal(at(0, 2), 'SN', 'GM 38 — the snare');
  assert.equal(at(1, 2), 'HH', 'GM 42 — closed hi-hat, directly above the snare');
  assert.equal(at(2, 2), 'HO', 'GM 46 — open hi-hat, above the closed one');
  assert.equal(at(2, 0), 'HF', 'GM 44 — hi-hat pedal');
  assert.equal(at(3, 1), 'CR', 'GM 49 — crash');
  assert.equal(at(3, 3), 'RD', 'GM 51 — ride');
  /* And the three the Basics need sit in the bottom-left corner together. */
  for (const v of ['KK', 'SN', 'HH']) {
    assert.ok(P.padsForVoice(v, 'kit', P.LEFT).length > 0, `${v} is not under the left hand`);
  }
});

test('every voice a layout reaches is reachable with BOTH hands', () => {
  /* Sticking is only scoreable if each voice exists under each hand. A voice
   * on one side only would make half its written stickings impossible. */
  for (const layout of P.LAYOUT_IDS) {
    for (const voice of P.layoutVoices(layout)) {
      assert.ok(P.padsForVoice(voice, layout, P.LEFT).length > 0, `${layout}/${voice} left`);
      assert.ok(P.padsForVoice(voice, layout, P.RIGHT).length > 0, `${layout}/${voice} right`);
    }
  }
});

test('padsForVoice round-trips against padVoice', () => {
  for (const layout of P.LAYOUT_IDS) {
    for (const voice of P.layoutVoices(layout)) {
      const pads = P.padsForVoice(voice, layout);
      assert.ok(pads.length > 0);
      for (const pad of pads) assert.equal(P.padVoice(pad, layout), voice);
      const both = P.padsForVoice(voice, layout, P.LEFT).length
                 + P.padsForVoice(voice, layout, P.RIGHT).length;
      assert.equal(both, pads.length, 'every pad belongs to exactly one hand');
    }
  }
});

test('sticking is one surface; the kit reaches every voice', () => {
  assert.deepEqual(P.layoutVoices('sticking'), ['SN']);
  assert.equal(P.layoutVoices('kit').length, 9, 'the whole legend is playable');
});

test('layoutForChart picks the narrowest layout that can play it', () => {
  assert.equal(P.layoutForChart({ events: [{ voices: ['SN'] }] }), 'sticking');
  assert.equal(P.layoutForChart({ events: [{ voices: ['KK', 'SN', 'HH'] }] }), 'kit');
  assert.equal(P.layoutForChart({ events: [{ voices: ['HF'] }] }), 'kit',
    'the hi-hat pedal has a pad now, at its GM slot');
});

test('unknown layouts and pads are refused rather than guessed at', () => {
  assert.equal(P.padVoice(68, 'nope'), null);
  assert.equal(P.padVoice(5, 'kit'), null);
  assert.deepEqual(P.padsForVoice('SN', 'nope'), []);
  assert.deepEqual(P.layoutVoices('nope'), []);
  assert.equal(P.layoutExists('kit'), true);
  assert.equal(P.layoutExists('nope'), false);
});

test('a judgement colour is never one of the music colours', () => {
  const music = [P.LED_OFF, P.LED_VOICE, P.LED_TARGET_FAR, P.LED_TARGET_NEAR, P.LED_PROMPT];
  const judge = [P.LED_HIT, P.LED_STICK, P.LED_MISS, P.LED_PRESSED];
  for (const j of judge) assert.ok(!music.includes(j), `${j} is in both families`);
  assert.equal(new Set(judge).size, judge.length, 'judgements must be told apart');
});
