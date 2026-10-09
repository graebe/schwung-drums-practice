// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, VOICE_IDS, voiceById, voiceIndex, sortVoices, voicesInChart, stackLabel, isVoice }
  from '../src/kit.mjs';
import { diatonicToY, ledgerYs } from '../src/notation.mjs';
import * as L from '../src/layout.mjs';

test('every voice is distinct and complete', () => {
  assert.equal(new Set(VOICE_IDS).size, VOICES.length);
  for (const v of VOICES) {
    assert.ok(v.label && v.short, `${v.id} needs a label`);
    assert.ok(['note', 'x', 'circled-x'].includes(v.head), `${v.id} head`);
    assert.ok(['up', 'down'].includes(v.stem), `${v.id} stem`);
    assert.equal(v.limb, v.stem === 'down' ? 'foot' : 'hand');
  }
});

test('the legend sits where a drum chart engraves it', () => {
  const y = (id) => diatonicToY(voiceById(id).diatonic);
  /* Lines are 20,24,28,32,36; spaces are 22,26,30,34. */
  assert.equal(y('RD'), L.STAFF_LINE_YS[0], 'ride on the top line');
  assert.equal(y('HT'), 22, 'high tom in the 4th space');
  assert.equal(y('SN'), 26, 'snare in the 3rd space');
  assert.equal(y('LT'), 30, 'low tom in the 2nd space');
  assert.equal(y('KK'), 34, 'kick in the bottom space');
  assert.ok(y('HH') < L.STAFF_TOP_Y, 'hi-hat above the staff');
  assert.ok(y('HF') > L.STAFF_BOTTOM_Y, 'hat pedal below the staff');
});

test('the crash is the only voice needing a ledger', () => {
  const needing = VOICES.filter((v) => ledgerYs(diatonicToY(v.diatonic)).length > 0);
  assert.deepEqual(needing.map((v) => v.id), ['CR']);
});

test('the whole legend fits the drawable band', () => {
  for (const v of VOICES) {
    const y = diatonicToY(v.diatonic);
    assert.ok(y - L.HEAD_H >= L.STAFF_AREA_TOP_Y, `${v.id} head clears the top`);
    assert.ok(y + L.HEAD_H <= L.STAFF_AREA_BOTTOM_Y, `${v.id} head clears the bottom`);
  }
});

test('the open hat is engraved with the closed one, told apart by its head', () => {
  assert.equal(voiceById('HO').pitch, voiceById('HH').pitch);
  assert.notEqual(voiceById('HO').head, voiceById('HH').head);
});

test('voices sort into staff order however they are written', () => {
  assert.deepEqual(sortVoices(['KK', 'HH', 'SN']), ['HH', 'SN', 'KK']);
  assert.equal(stackLabel(['KK', 'HH']), 'HH KK');
  /* The index is the DSP channel, so staff order and channel order are one. */
  assert.ok(voiceIndex('HH') < voiceIndex('SN'));
  assert.ok(voiceIndex('SN') < voiceIndex('KK'));
  assert.equal(voiceIndex('nope'), -1);
  assert.equal(isVoice('SN'), true);
  assert.equal(isVoice('ZZ'), false);
  assert.equal(voiceById('ZZ'), null);
});

test('voicesInChart reports what a chart uses, in staff order', () => {
  const chart = { events: [{ voices: ['KK', 'HH'] }, { voices: ['SN'] }, { voices: ['KK'] }] };
  assert.deepEqual(voicesInChart(chart), ['HH', 'SN', 'KK']);
  assert.deepEqual(voicesInChart({ events: [] }), []);
});
