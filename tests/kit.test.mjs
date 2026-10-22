// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, VOICE_IDS, CORE_VOICES, voiceById, voiceIndex, sortVoices, voicesInChart, stackLabel, isVoice }
  from '../src/kit.mjs';
import { diatonicToY, ledgerYs } from '../src/notation.mjs';
import * as L from '../src/layout.mjs';

test('every voice is distinct and complete', () => {
  assert.equal(new Set(VOICE_IDS).size, VOICES.length);
  for (const v of VOICES) {
    assert.ok(v.label && v.short, `${v.id} needs a label`);
    assert.ok(['note', 'x', 'circled-x', 'triangle', 'diamond', 'slash'].includes(v.head), `${v.id} head`);
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

test('only the voices on the crash\'s line need a ledger', () => {
  const needing = VOICES.filter((v) => ledgerYs(diatonicToY(v.diatonic)).length > 0);
  assert.deepEqual(needing.map((v) => v.id), ['CR', 'FX', 'P1']);
});

test('twenty-one voices, each its own sound and its own mark', () => {
  assert.equal(VOICES.length, 21);
  const gms = VOICES.map((v) => v.gm);
  assert.equal(new Set(gms).size, 21, 'two voices send the same note');
  for (let n = 36; n <= 51; n++) assert.ok(gms.includes(n), `no voice for GM ${n}`);
  const marks = new Map();
  for (const v of VOICES) {
    const key = `${v.pitch}:${v.head}:${v.stem}`;
    assert.ok(!marks.has(key), `${v.id} is engraved exactly like ${marks.get(key)}`);
    marks.set(key, v.id);
  }
});

test('the nine voices every drill was written in keep their place on the staff', () => {
  const was = { CR: 81, HH: 79, HO: 79, RD: 77, HT: 76, SN: 72, LT: 69, KK: 65, HF: 62 };
  for (const [id, pitch] of Object.entries(was)) assert.equal(voiceById(id).pitch, pitch, id);
  assert.deepEqual(CORE_VOICES, Object.keys(was));
  /* Staff order, top to bottom, is the list order. */
  for (let i = 1; i < VOICES.length; i++) assert.ok(VOICES[i - 1].pitch >= VOICES[i].pitch, VOICES[i].id);
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
