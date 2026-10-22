// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as PIO from '../src/pads_io.mjs';
import * as P from '../src/padmap.mjs';

test('a preset copied to Custom is the same pads, with its pairing', () => {
  for (const id of ['mpc', 'family', 'centre', 'gm', 'mirror']) {
    const c = PIO.copyPreset(id);
    assert.deepEqual(P.resolveLayout('custom', { custom: c }).grid, P.resolveLayout(id).grid, id);
    assert.equal(c.pair, P.PRESETS[id].pair);
  }
});

test('Custom round-trips through pads.json', () => {
  const c = PIO.setPad(PIO.copyPreset('mpc'), 0, 'K2', false);
  const back = PIO.readPads(PIO.serialisePads(c));
  assert.equal(back.ok, true);
  assert.deepEqual(back.custom, c);
  assert.equal(P.padVoice(68, P.resolveLayout('custom', { custom: back.custom })), 'K2');
});

test('an edit to both halves lands where the layout pairs the pad', () => {
  const twin = PIO.setPad(PIO.copyPreset('mpc'), P.padAt(0, 1) - P.PAD_FIRST, 'S2', true);
  const t = P.resolveLayout('custom', { custom: twin });
  assert.equal(P.padVoice(P.padAt(0, 1), t), 'S2');
  assert.equal(P.padVoice(P.padAt(0, 5), t), 'S2', 'the same finger of the other hand');
  const mir = PIO.setPad(PIO.copyPreset('mirror'), P.padAt(3, 0) - P.PAD_FIRST, 'P2', true);
  const m = P.resolveLayout('custom', { custom: mir });
  assert.equal(P.padVoice(P.padAt(3, 7), m), 'P2', 'the mirror image');
  const one = PIO.setPad(PIO.copyPreset('mpc'), 0, null, false);
  const o = P.resolveLayout('custom', { custom: one });
  assert.equal(P.padVoice(68, o), null, 'a pad can hold no sound');
  assert.equal(P.padVoice(72, o), 'KK', 'and one half alone is edited when asked');
});

test('a pads.json that will not read is reported, never half-used', () => {
  assert.deepEqual(PIO.readPads(null), { custom: null, ok: true }, 'no file is no Custom yet');
  for (const bad of ['{', '{"rows": 3}', JSON.stringify({ rows: ['KK'] }),
    JSON.stringify({ rows: ['KK SN', '', '', ''] }),
    JSON.stringify({ rows: Array(4).fill('KK KK KK KK KK KK KK XX') })]) {
    const r = PIO.readPads(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.custom, null);
  }
  const mirror = PIO.readPads(JSON.stringify({ pair: 'mirror', rows: Array(4).fill('. . . . . . . .') }));
  assert.equal(mirror.custom.pair, P.MIRROR);
});
