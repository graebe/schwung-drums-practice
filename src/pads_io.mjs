// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * pads_io.mjs — the Custom pad layout, as pads.json. Pure.
 *
 * One layout of the player's own, edited on the device (the Pad map screen)
 * and kept beside the module in a form a person can read and write too:
 *
 *   { "version": 1, "pair": "twin",
 *     "rows": ["CR RD P1 FX CR RD P1 FX", "...", "...", "KK SN HH HO KK SN HH HO"] }
 *
 * eight voice ids a row, top row first, `.` for a pad with no sound. `pair` is
 * how its halves relate, which is where an edit to "both halves" lands: the
 * same column of the other half (`twin`, as the MPC layouts are) or its mirror
 * image (`mirror`, as Mirrored Performance is). The file doubles as export and
 * import: copy it off the Move, edit it, copy it back.
 */

import { isVoice } from './kit.mjs';
import { PRESETS, ROWS, COLS, TWIN, MIRROR, gridOf, rowsOf, pairCol, PAD_COUNT } from './padmap.mjs';

export const PADS_VERSION = 1;

/* { custom: { rows, pair } | null, ok }. Never throws; `ok` false on a file
 * that is there but will not read, which the caller says on screen. */
export function readPads(text) {
  if (!text) return { custom: null, ok: true };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { custom: null, ok: false };
  }
  if (!obj || !Array.isArray(obj.rows) || obj.rows.length !== ROWS) return { custom: null, ok: false };
  const rows = [];
  for (const r of obj.rows) {
    const cells = String(r).trim().split(/\s+/);
    if (cells.length !== COLS) return { custom: null, ok: false };
    if (!cells.every((c) => c === '.' || isVoice(c))) return { custom: null, ok: false };
    rows.push(cells.join(' '));
  }
  return { custom: { rows, pair: obj.pair === MIRROR ? MIRROR : TWIN }, ok: true };
}

export function serialisePads(custom) {
  return `${JSON.stringify({ version: PADS_VERSION, pair: custom.pair, rows: custom.rows }, null, 1)}\n`;
}

/* A preset as a Custom to edit: its own grid, unflipped (Flip stays a setting
 * of its own), and its pairing. */
export function copyPreset(id) {
  const p = PRESETS[id] || PRESETS.mpc;
  return { rows: rowsOf(gridOf(p.rows)), pair: p.pair };
}

/*
 * One pad of Custom given a voice (or null), at grid index `i` (0 = bottom
 * left). With `both`, the pad its pairing matches in the other half gets the
 * same voice — so an edit keeps a duplicated layout duplicated and a mirrored
 * one mirrored.
 */
export function setPad(custom, i, voice, both = true) {
  const grid = gridOf(custom.rows);
  if (i < 0 || i >= PAD_COUNT) return custom;
  grid[i] = voice || null;
  if (both) {
    const row = Math.floor(i / COLS);
    grid[row * COLS + pairCol(i % COLS, custom.pair)] = voice || null;
  }
  return { rows: rowsOf(grid), pair: custom.pair };
}
