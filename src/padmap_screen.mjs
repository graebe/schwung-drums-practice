// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * padmap_screen.mjs — the Pad map screen's state and rules. Pure.
 *
 * Settings › Pad map shows the layout in force, every pad named. On a preset a
 * pad sounds its drum and names it, the jog steps through the layouts, and
 * Click makes an editable copy of it — Custom. On Custom a pad is picked, the
 * jog gives it a sound, and knob 1 says whether the edit lands on both halves
 * (the pad its layout pairs it with: the same column of the other half, or its
 * mirror image). Back saves Custom to pads.json and returns to Settings.
 *
 * What happens is decided here, from the screen's state and the layout it is
 * shown — `view` = { layout (resolved, padmap.mjs), custom (true when Custom
 * is in force), sticking, flip } — and returned; ui.js does the sounding,
 * the saving and the settings. The screen's rules can be tested without the
 * host, which ui.js's never could be.
 */

import { VOICE_IDS, voiceById } from './kit.mjs';
import { PAD_FIRST, COLS, padAt, pairCol } from './padmap.mjs';
import { setPad } from './pads_io.mjs';

/* How long a struck or edited pad's name holds the header. */
export const NOTE_MS = 2000;

export function createPadMap() {
  return { sel: -1, both: true, note: '', noteUntil: 0, edited: false };
}

/* Opened afresh: nothing picked, nothing edited yet. */
export function reset(pm) {
  pm.sel = -1;
  pm.note = '';
  pm.noteUntil = 0;
  pm.edited = false;
  return pm;
}

function name(voice) {
  const v = voice ? voiceById(voice) : null;
  return v ? v.label : 'no sound';
}

/* A pad went down: the voice it plays (to be sounded), and on Custom it is
 * picked to edit. */
export function press(pm, view, pad, nowMs) {
  const i = pad - PAD_FIRST;
  const voice = view.layout.grid[i] || null;
  pm.note = name(voice);
  pm.noteUntil = nowMs + NOTE_MS;
  if (view.custom) pm.sel = i;
  return { voice, note: pm.note };
}

/* A grid index as an index into Custom's own, unflipped rows. */
export function customIndex(i, flip) {
  if (!flip) return i;
  const row = Math.floor(i / COLS);
  return row * COLS + (COLS - 1 - (i % COLS));
}

/*
 * The jog. On a picked Custom pad it steps the pad's sound through no sound
 * and every voice in staff order and returns `{ custom }`, the edited layout;
 * anywhere else it steps the layout and returns `{ layoutDelta }`.
 */
export function jog(pm, view, delta, custom, nowMs) {
  if (view.custom && pm.sel >= 0) {
    const list = [null].concat(VOICE_IDS);
    const at = Math.max(0, list.indexOf(view.layout.grid[pm.sel] || null));
    const next = list[Math.max(0, Math.min(list.length - 1, at + delta))];
    pm.edited = true;
    pm.note = name(next);
    pm.noteUntil = nowMs + NOTE_MS;
    return { custom: setPad(custom, customIndex(pm.sel, view.flip), next, pm.both) };
  }
  pm.sel = -1;
  pm.note = '';
  return { layoutDelta: delta };
}

/* Click: on Custom it puts the picked pad down; on a preset it asks for a
 * copy to edit (`{ copy: true }`); Sticking has nothing to copy. */
export function click(pm, view) {
  if (view.custom) {
    pm.sel = -1;
    return {};
  }
  if (view.sticking) return {};
  pm.edited = true;
  return { copy: true };
}

/* Knob 1 on Custom: whether an edit lands on both halves. */
export function toggleBoth(pm, view) {
  if (view.custom) pm.both = !pm.both;
  return pm.both;
}

/* The pads an edit is landing on, lit on the grid. Flip leaves the pairing
 * where it was: a twin is four columns away, a mirror image 7 - c, either way. */
export function selectedPads(pm, view) {
  if (!view.custom || pm.sel < 0) return null;
  const row = Math.floor(pm.sel / COLS);
  const out = [PAD_FIRST + pm.sel];
  if (pm.both) out.push(padAt(row, pairCol(pm.sel % COLS, view.layout.pair)));
  return out;
}

/* Everything drawPadMap draws, for this moment. */
export function screenOf(pm, view, nowMs) {
  const sel = selectedPads(pm, view);
  let footer = 'PAD hear CLICK edit';
  if (view.custom) footer = pm.sel >= 0 ? 'JOG sound KNOB1 both' : 'PAD pick  JOG layout';
  else if (view.sticking) footer = 'JOG layout';
  return {
    title: pm.note && nowMs < pm.noteUntil ? pm.note : view.layout.name,
    right: view.custom ? (pm.both ? 'both' : 'one') : view.flip ? 'flip' : '',
    grid: view.layout.grid,
    selected: sel ? sel.map((p) => p - PAD_FIRST) : [],
    footer,
  };
}
