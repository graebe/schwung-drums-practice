// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/padmap.mjs';
import { VOICE_IDS, CORE_VOICES, gmOf } from '../src/kit.mjs';

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

test('every preset assigns every pad a known voice', () => {
  for (const layout of P.PRESET_IDS) {
    for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
      const v = P.padVoice(pad, layout);
      assert.ok(v !== null, `${layout} pad ${pad} is unassigned`);
      assert.ok(VOICE_IDS.includes(v), `${layout} pad ${pad} -> unknown voice ${v}`);
    }
  }
});

const DUPLICATED = ['mpc', 'family', 'centre', 'gm', 'sticking'];

test('a 4x4 preset is duplicated: the same voice under the same finger of either hand', () => {
  for (const id of DUPLICATED) {
    for (let row = 0; row < P.ROWS; row++) {
      for (let col = 0; col < 4; col++) {
        assert.equal(P.padVoice(P.padAt(row, col), id), P.padVoice(P.padAt(row, P.twinCol(col)), id),
          `${id} row ${row} col ${col}`);
      }
    }
  }
});

test('MPC Classic is the default: kick, snare and hats along the bottom, from the corner', () => {
  assert.equal(P.DEFAULT_LAYOUT, 'mpc');
  assert.deepEqual([68, 69, 70, 71].map((p) => P.padVoice(p)), ['KK', 'SN', 'HH', 'HO']);
  assert.equal(P.padVoice(P.padAt(1, 3)), 'HF', 'its shaker pad is the hat foot, for jazz and Latin');
});

test('Chromatic is General MIDI 36..51, bottom left to top right, as Move\'s drum mode', () => {
  for (let n = 0; n < 16; n++) {
    const pad = P.padAt(Math.floor(n / 4), n % 4);
    assert.equal(gmOf(P.padVoice(pad, 'gm')), 36 + n, `pad ${n}`);
  }
});

test('Mirrored sits in the middle, its outer columns the mirror of each other', () => {
  for (let row = 0; row < P.ROWS; row++) {
    for (const col of [0, 1]) {
      assert.equal(P.padVoice(P.padAt(row, col), 'mirror'), P.padVoice(P.padAt(row, 7 - col), 'mirror'));
    }
  }
  /* The kick under both hands, at the centre's edge. */
  assert.equal(P.padVoice(P.padAt(0, 2), 'mirror'), 'KK');
  assert.equal(P.padVoice(P.padAt(0, 5), 'mirror'), 'KK');
  assert.equal(P.PRESETS.mirror.pair, P.MIRROR);
});

test('Flip mirrors the grid, column c to 7-c; the hand stays the physical half', () => {
  for (const id of P.PRESET_IDS) {
    const flat = P.resolveLayout(id);
    const flipped = P.resolveLayout(id, { flip: true });
    for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
      const { row, col } = P.padRowCol(pad);
      assert.equal(P.padVoice(pad, flipped), P.padVoice(P.padAt(row, 7 - col), flat));
    }
  }
  const f = P.resolveLayout('mpc', { flip: true });
  assert.equal(P.padVoice(P.padAt(0, 3), f), 'KK', 'the kick is under the left hand\'s right finger');
  assert.equal(P.padHand(P.padAt(0, 3)), P.LEFT);
});

test('a duplicated layout puts every voice it reaches under BOTH hands', () => {
  /* Mirrored is a two-handed kit by design: its crash is the left hand's. */
  for (const id of DUPLICATED) {
    for (const flip of [false, true]) {
      const lay = P.resolveLayout(id, { flip });
      for (const v of P.layoutVoices(lay)) {
        assert.ok(P.padsForVoice(v, lay, P.LEFT).length > 0, `${id}: ${v} has no left-hand pad`);
        assert.ok(P.padsForVoice(v, lay, P.RIGHT).length > 0, `${id}: ${v} has no right-hand pad`);
      }
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

test('every preset reaches the nine core voices; together they reach all twenty-one', () => {
  const all = new Set();
  for (const id of P.PRESET_IDS) {
    if (id === 'sticking') continue;
    for (const v of CORE_VOICES) assert.ok(P.layoutVoices(id).includes(v), `${id} has no ${v}`);
    for (const v of P.layoutVoices(id)) all.add(v);
  }
  for (const v of VOICE_IDS) assert.ok(all.has(v), `no preset has ${v}`);
  assert.deepEqual(P.layoutVoices('sticking'), ['SN']);
});

test('missingVoices names what a layout cannot play; layoutForChart finds one that can', () => {
  const groove = { events: [{ voices: ['KK', 'HH'] }, { voices: ['SN'] }, { voices: ['P1'] }] };
  assert.deepEqual(P.missingVoices(groove, 'gm'), ['P1'], 'Chromatic has no cowbell');
  assert.deepEqual(P.missingVoices(groove, 'mpc'), []);
  assert.deepEqual(P.missingVoices(groove, 'sticking'), ['P1', 'HH', 'KK']);
  assert.equal(P.layoutForChart({ events: [{ voices: ['SN'] }] }), 'mpc');
  assert.equal(P.layoutForChart({ events: [{ voices: ['XX'] }] }), null);
});

test('an unknown layout is MPC Classic, an unknown pad no voice', () => {
  assert.equal(P.resolveLayout('kit').id, 'mpc', 'the old default lands on the new one');
  assert.equal(P.padVoice(50), null);
  assert.equal(P.layoutExists('custom'), true);
  assert.equal(P.layoutExists('kit'), false);
  assert.equal(P.pairCol(1, P.MIRROR), 6);
  assert.equal(P.pairCol(1, P.TWIN), 5);
});

test('Custom without a pads.json is MPC Classic; with one, its own', () => {
  assert.deepEqual(P.resolveLayout('custom').grid, P.resolveLayout('mpc').grid);
  const rows = ['. . . . . . . .', '. . . . . . . .', '. . . . . . . .', 'K2 . . . . . . SH'];
  const c = P.resolveLayout('custom', { custom: { rows, pair: P.MIRROR } });
  assert.equal(P.padVoice(68, c), 'K2');
  assert.equal(P.padVoice(75, c), 'SH');
  assert.equal(P.padVoice(69, c), null);
  assert.equal(c.pair, P.MIRROR);
  assert.deepEqual(P.rowsOf(c.grid), rows);
});

test('a judgement colour is never one of the music colours', () => {
  const music = [P.LED_OFF, P.LED_VOICE, P.LED_TARGET_FAR, P.LED_TARGET_NEAR, P.LED_PROMPT];
  const judge = [P.LED_HIT, P.LED_STICK, P.LED_MISS, P.LED_PRESSED];
  for (const j of judge) assert.ok(!music.includes(j), `${j} is in both families`);
  assert.equal(new Set(judge).size, judge.length, 'judgements must be told apart');
});
