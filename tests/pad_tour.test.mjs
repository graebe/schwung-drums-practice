// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Meet the pads: every drum of the layout in force, the beat first, and a
 * screen that fits whatever the drum and whatever was struck.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PT from '../src/pad_tour.mjs';
import * as P from '../src/padmap.mjs';
import { VOICE_IDS, VOICES } from '../src/kit.mjs';
import { parseLessons, wrapText } from '../src/lessons.mjs';
import { copyPreset, setPad } from '../src/pads_io.mjs';
import { createScreen } from '../tools/screen_buffer.mjs';
import * as L from '../src/layout.mjs';

const screen = createScreen();
const measure = (t) => screen.textWidth(t);
const { pads: texts } = parseLessons(readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8'));
const tourOf = (id, opts = {}) => PT.createTour(P.resolveLayout(id, opts), { texts, measure, width: L.SCREEN_W - 2 });

test('the order names every voice once, the beat first', () => {
  assert.deepEqual([...PT.TOUR_ORDER].sort(), [...VOICE_IDS].sort());
  assert.deepEqual(PT.TOUR_ORDER.slice(0, 3), ['KK', 'SN', 'HH']);
});

test('the stops are the layout\'s own sounds, in tour order, one each', () => {
  const mpc = tourOf('mpc');
  assert.deepEqual(mpc.stops, ['KK', 'SN', 'HH', 'HO', 'HF', 'RM', 'CL', 'K2', 'HT', 'MT', 'LT', 'CR', 'RD', 'FX', 'P1', 'P2']);
  for (const id of P.PRESET_IDS) {
    const layout = P.resolveLayout(id);
    const t = PT.createTour(layout);
    assert.deepEqual([...t.stops].sort(), [...new Set(layout.grid.filter(Boolean))].sort(), id);
  }
  assert.deepEqual(tourOf('mpc', { flip: true }).stops, mpc.stops, 'Flip moves the pads, not the kit');
  assert.deepEqual(tourOf('sticking').stops, ['SN']);
});

test('Custom tours what it holds; a voice the order does not name comes last; an empty one ends at once', () => {
  const c = setPad(copyPreset('mpc'), 0, 'SH', true);
  assert.equal(tourOf('custom', { custom: c }).stops.at(-1), 'SH');
  const odd = PT.createTour({ grid: ['KK', 'ZZ', null] });
  assert.deepEqual(odd.stops, ['KK', 'ZZ']);
  const empty = PT.createTour({ grid: new Array(32).fill(null) });
  assert.equal(empty.done, true);
  assert.equal(PT.current(empty), null);
  assert.equal(PT.skip(empty, 1), false);
});

test('the right drum moves on after a moment; another is named and waits', () => {
  const t = tourOf('mpc');
  assert.equal(PT.current(t), 'KK');
  assert.equal(PT.press(t, 'SN', 1000), 'other');
  assert.equal(PT.screenOf(t).lines.join(' '), 'That was the snare. The kick is the pad that pulses.');
  assert.equal(PT.service(t, 1000 + PT.NOTE_MS), false, 'the name gives way, the stop stays');
  assert.match(PT.screenOf(t).lines.join(' '), /low thump/);
  assert.equal(PT.press(t, 'KK', 5000), 'right');
  assert.equal(PT.press(t, 'KK', 5100), 'ignored', 'once is enough');
  assert.equal(PT.screenOf(t).sounding, true, 'nothing to do while it sounds');
  assert.equal(PT.service(t, 5000 + PT.HOLD_MS - 1), false);
  assert.equal(PT.service(t, 5000 + PT.HOLD_MS), true);
  assert.equal(PT.current(t), 'SN');
  assert.deepEqual([PT.screenOf(t).title, PT.screenOf(t).right], ['Snare', '2/16']);
});

test('the jog skips both ways and stops at the ends; past the last stop is the last page', () => {
  const t = tourOf('mpc');
  assert.equal(PT.skip(t, -1), false, 'nothing before the first');
  assert.equal(PT.skip(t, 3), true);
  assert.equal(PT.current(t), 'HO');
  PT.skip(t, 100);
  assert.equal(t.done, true);
  assert.equal(PT.press(t, 'KK', 0), 'ignored');
  const end = PT.screenOf(t);
  assert.deepEqual([end.title, end.right, end.done], [PT.END_TITLE, '', true]);
  assert.equal(PT.skip(t, 1), false, 'nothing after the end');
  assert.equal(PT.skip(t, -1), true);
  assert.equal(PT.current(t), 'P2', 'back from the end is the last drum');
});

test('walking every stop by its pad reaches the end', () => {
  const t = tourOf('mpc');
  let at = 1000;
  for (const voice of t.stops) {
    assert.equal(PT.press(t, voice, at), 'right', voice);
    at += PT.HOLD_MS;
    PT.service(t, at);
  }
  assert.equal(t.done, true);
});

test('every page fits the screen: a line about each drum, a name, the end', () => {
  const t = PT.createTour({ grid: [...VOICE_IDS] }, { texts, measure, width: L.SCREEN_W - 2 });
  const fits = (s, what) => {
    assert.ok(s.lines.length <= 6, `${what}: ${s.lines.length} lines`);
    for (const line of s.lines) assert.ok(measure(line) <= L.SCREEN_W - 2, `${what}: "${line}"`);
  };
  for (let i = 0; i < t.stops.length; i++) {
    const voice = PT.current(t);
    assert.ok(texts.has(voice), `no line about ${voice}`);
    fits(PT.screenOf(t), voice);
    PT.press(t, voice === 'HM' ? 'F2' : 'HM', 0);
    fits(PT.screenOf(t), `${voice}, another struck`);
    PT.skip(t, 1);
  }
  fits(PT.screenOf(t), 'the end');
  const bare = PT.createTour({ grid: ['KK'] });
  assert.deepEqual(bare.lines, ['Kick'], 'without lessons.json a drum is shown by its name');
});

test('every page of the tour fits the five lines a page shows', () => {
  const pads = parseLessons(readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8')).pads;
  const measure = (x) => x.length * 6 - 1;
  const lines = (text) => wrapText(text, L.PAGE_FULL_PX, measure);
  for (const [voice, text] of pads) assert.ok(lines(text).length <= L.PAGE_ROWS, `${voice}: ${lines(text).join('|')}`);
  assert.ok(lines(PT.END_TEXT).length <= L.PAGE_ROWS, PT.END_TEXT);
  /* Every "That was the ..." a wrong pad can bring up. */
  for (const a of VOICES) for (const b of VOICES) {
    const t = `That was the ${a.label.toLowerCase()}. The ${b.label.toLowerCase()} is the pad that pulses.`;
    assert.ok(lines(t).length <= L.PAGE_ROWS, t);
  }
});
