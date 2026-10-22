// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as PMS from '../src/padmap_screen.mjs';
import * as P from '../src/padmap.mjs';
import { copyPreset } from '../src/pads_io.mjs';

const preset = (id, flip = false) => ({ layout: P.resolveLayout(id, { flip }), custom: false, sticking: id === 'sticking', flip });
const custom = (c, flip = false) => ({ layout: P.resolveLayout('custom', { custom: c, flip }), custom: true, sticking: false, flip });

test('on a preset a pad names its drum, the jog steps the layout, Click asks for a copy', () => {
  const pm = PMS.createPadMap();
  assert.deepEqual(PMS.press(pm, preset('mpc'), 68, 0), { voice: 'KK', note: 'Kick' });
  assert.equal(pm.sel, -1, 'a preset is not edited');
  assert.equal(PMS.screenOf(pm, preset('mpc'), 100).title, 'Kick');
  assert.equal(PMS.screenOf(pm, preset('mpc'), PMS.NOTE_MS + 1).title, 'MPC Classic', 'the name gives way');
  assert.deepEqual(PMS.jog(pm, preset('mpc'), 1, null, 0), { layoutDelta: 1 });
  assert.deepEqual(PMS.click(pm, preset('mpc')), { copy: true });
  assert.equal(pm.edited, true);
  assert.deepEqual(PMS.click(PMS.createPadMap(), preset('sticking')), {}, 'nothing to copy');
  assert.equal(PMS.screenOf(pm, preset('mpc', true), 0).right, 'flip');
});

test('on Custom a pad is picked, the jog gives it a sound, on both halves or one', () => {
  const pm = PMS.createPadMap();
  let c = copyPreset('mpc');
  PMS.press(pm, custom(c), 68, 0);
  assert.equal(pm.sel, 0);
  assert.deepEqual(PMS.selectedPads(pm, custom(c)), [68, 72], 'the twin is lit with it');
  c = PMS.jog(pm, custom(c), 1, c, 0).custom;
  assert.equal(P.padVoice(68, custom(c).layout), 'K2');
  assert.equal(P.padVoice(72, custom(c).layout), 'K2');
  assert.equal(PMS.toggleBoth(pm, custom(c)), false);
  c = PMS.jog(pm, custom(c), -1, c, 0).custom;
  assert.equal(P.padVoice(68, custom(c).layout), 'KK');
  assert.equal(P.padVoice(72, custom(c).layout), 'K2', 'one half only');
  assert.equal(PMS.screenOf(pm, custom(c), 0).footer, 'JOG sound KNOB1 both');
  PMS.click(pm, custom(c));
  assert.equal(pm.sel, -1, 'Click puts the pad down');
  assert.equal(PMS.screenOf(pm, custom(c), 0).footer, 'PAD pick  JOG layout');
});

test('the jog runs from no sound through every voice and stops at the ends', () => {
  const pm = PMS.createPadMap();
  let c = copyPreset('mpc');
  PMS.press(pm, custom(c), 68, 0);
  c = PMS.jog(pm, custom(c), -100, c, 0).custom;
  assert.equal(P.padVoice(68, custom(c).layout), null);
  assert.equal(PMS.screenOf(pm, custom(c), 0).title, 'no sound');
  c = PMS.jog(pm, custom(c), 100, c, 0).custom;
  assert.equal(P.padVoice(68, custom(c).layout), 'HF', 'the last voice in staff order');
});

test('flipped, an edit lands on the pad pressed, in the unflipped rows', () => {
  const pm = PMS.createPadMap();
  let c = copyPreset('mpc');
  pm.both = false;
  PMS.press(pm, custom(c, true), P.padAt(0, 3), 0);   /* the kick, flipped */
  c = PMS.jog(pm, custom(c, true), 1, c, 0).custom;
  assert.equal(P.padVoice(P.padAt(0, 3), custom(c, true).layout), 'K2');
  assert.equal(P.padVoice(P.padAt(0, 4), custom(c).layout), 'K2', 'which is column 4 unflipped');
  assert.equal(P.padVoice(P.padAt(0, 0), custom(c).layout), 'KK', 'and its twin untouched');
  assert.equal(PMS.customIndex(3, true), 4);
  assert.equal(PMS.customIndex(3, false), 3);
});

test('Mirrored pairs with the mirror image; reset forgets the last visit', () => {
  const pm = PMS.createPadMap();
  const c = copyPreset('mirror');
  PMS.press(pm, custom(c), P.padAt(3, 0), 0);
  assert.deepEqual(PMS.selectedPads(pm, custom(c)), [P.padAt(3, 0), P.padAt(3, 7)]);
  PMS.reset(pm);
  assert.equal(PMS.selectedPads(pm, custom(c)), null);
  assert.equal(pm.edited, false);
});
