// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * The screen is 128x64 and the bands are tight. These assert the geometry
 * itself rather than any drawing — a band that overlaps its neighbour, or a
 * line that runs past where the host stops plotting, fails silently on the
 * device and takes a number with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/layout.mjs';
import { VOICES } from '../src/kit.mjs';
import { diatonicToY } from '../src/notation.mjs';
import { lanes } from '../src/grid_render.mjs';
import { READY_BOX } from '../src/view.mjs';

test('the bands run top to bottom without overlapping', () => {
  const bands = [
    ['header', 0, L.HEADER_H - 1],
    ['rule', L.HEADER_RULE_Y, L.HEADER_RULE_Y],
    ['chart', L.STAFF_AREA_TOP_Y, L.STAFF_AREA_BOTTOM_Y],
    ['under rule', L.UNDER_RULE_Y, L.UNDER_RULE_Y],
    /* The ticks hang off the rule into the top of the lane, deliberately: a
     * tick with a gap above it reads as a stray mark rather than as a
     * graduation. They must still not reach the text row. */
    ['under lane', L.UNDER_LANE_Y, L.UNDER_LANE_Y + L.TEXT_H - 1],
    ['footer', L.FOOTER_Y - 2, L.FOOTER_Y - 2 + L.TEXT_H - 1],
  ];
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i][1] > bands[i - 1][2],
      `${bands[i][0]} starts at ${bands[i][1]}, inside ${bands[i - 1][0]}`);
  }
  const last = bands[bands.length - 1];
  assert.ok(last[2] < L.SCREEN_H, `${last[0]} runs off the bottom`);
});

test('the bar ticks graduate the rule and stay inside the lane', () => {
  assert.equal(L.UNDER_TICK_Y, L.UNDER_RULE_Y + 1, 'a tick must touch the rule it graduates');
  /* A tick is two rows and the text row starts on its second, which is fine
   * VERTICALLY — they are separated horizontally, and the render test measures
   * that. What must not happen is a tick reaching the footer. */
  assert.ok(L.UNDER_TICK_Y + L.UNDER_TICK_H <= L.UNDER_LANE_Y + L.TEXT_H,
    'the ticks run out of the lane');
  assert.ok(L.UNDER_TICK_Y + L.UNDER_TICK_H < L.FOOTER_Y - 2, 'the ticks reach the footer');
});

test('the whole kit fits between the beams', () => {
  let top = Infinity;
  let bottom = -Infinity;
  for (const v of VOICES) {
    const y = diatonicToY(v.diatonic);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const upBeamBottom = L.STEM_UP_Y + (L.MAX_BEAMS - 1) * L.BEAM_GAP + L.BEAM_H - 1;
  assert.ok(upBeamBottom < top - (L.HEAD_H >> 1),
    `the last up-beam at y${upBeamBottom} strikes the top voice at y${top}`);
  const downBeamTop = L.STEM_DOWN_Y - (L.MAX_BEAMS - 1) * L.BEAM_GAP - L.BEAM_H + 1;
  assert.ok(downBeamTop > bottom + (L.HEAD_H >> 1),
    `the last down-beam at y${downBeamTop} strikes the bottom voice at y${bottom}`);
  assert.ok(top - 2 >= L.STAFF_AREA_TOP_Y && bottom + 2 <= L.STAFF_AREA_BOTTOM_Y);
});

test('a third beam would not fit, which is why there are two', () => {
  const third = L.STEM_UP_Y + L.MAX_BEAMS * L.BEAM_GAP;
  let top = Infinity;
  for (const v of VOICES) top = Math.min(top, diatonicToY(v.diatonic));
  assert.ok(third >= top - 1, 'MAX_BEAMS could be raised — the comment is now wrong');
});

test('the footer bar leaves room for the hits and misses beside it', () => {
  /* Three-digit counts either side of the slash: 7 characters at the 6px
   * advance, 41px, beside a bar that ends 44px short of the edge. */
  assert.ok(L.SCREEN_W - (1 + L.FOOTER_BAR_W) - 2 >= 7 * 6 - 1, 'a long count runs into the bar');
  assert.ok(L.FOOTER_Y + L.PROGRESS_H <= L.SCREEN_H, 'the bar runs off the bottom');
  assert.ok(L.FOOTER_Y - 2 > L.UNDER_LANE_Y + L.TEXT_H - 1, 'the footer starts inside the lane');
});

test('the scroll runs the right way and the clef is clear of it', () => {
  assert.ok(L.DESPAWN_X < L.HIT_X, 'notes must vanish before the hit line');
  assert.ok(L.HIT_X < L.SPAWN_X, 'and enter after it');
  assert.ok(L.DESPAWN_X >= L.STAFF_LEFT_X, 'a note must not scroll into the clef');
  assert.ok(L.CLEF_X + L.CLEF_W * 2 + L.CLEF_GAP <= L.STAFF_LEFT_X);
  assert.ok(L.BLOCKED_MIN_X >= L.DESPAWN_X,
    'a note the scroll is frozen on must still be drawn');
});

test('the read-ahead range always shows at least a bar', () => {
  const widest = (L.SPAWN_X - L.HIT_X) / L.PX_PER_BEAT_MAX;
  assert.ok(widest >= 2, `only ${widest} beats visible at the tightest read-ahead`);
  assert.ok(L.PX_PER_BEAT_DEFAULT >= L.PX_PER_BEAT_MIN);
  assert.ok(L.PX_PER_BEAT_DEFAULT <= L.PX_PER_BEAT_MAX);
});

test('sixteenths get room to breathe at the default read-ahead', () => {
  /* The failure this fixes: at 24px/beat a 5px head left one pixel of gap. */
  const spacing = L.PX_PER_BEAT_DEFAULT / 4;
  assert.ok(spacing - L.HEAD_W_TIGHT >= 3, `only ${spacing - L.HEAD_W_TIGHT}px of gap`);
});

test('the three head weights stay distinct at any density', () => {
  for (const base of [L.HEAD_W, L.HEAD_W_TIGHT]) {
    assert.ok(base - L.HEAD_STEP >= 1, 'a ghost note must still be a mark');
    assert.ok(base + L.HEAD_STEP <= 7, 'an accent must not be a blob');
  }
});

test('grid lanes fit their band for every plausible voice count', () => {
  for (let n = 1; n <= 9; n++) {
    const list = lanes(new Array(n).fill(0).map((_, i) => `v${i}`));
    assert.equal(list.length, n);
    assert.ok(list[0].top >= L.GRID_TOP_Y, `${n} lanes overflow the top`);
    const last = list[n - 1];
    assert.ok(last.top + last.h - 1 <= L.GRID_BOTTOM_Y, `${n} lanes overflow the bottom`);
    assert.ok(last.h >= 3, `${n} lanes are too short to draw a cell in`);
  }
});

test('grid lanes FILL their band, not just fit inside it', () => {
  /*
   * Fitting was all the audit asked for, and a cap of 9 fitted three lanes
   * into 36 rows by using 27 of them and splitting the rest into margin above
   * and below — which read on the device as a chart that had failed to draw.
   * Two lanes and up must now leave at most a row and a half either side.
   */
  const avail = L.GRID_BOTTOM_Y - L.GRID_TOP_Y + 1;
  for (let n = 2; n <= 9; n++) {
    const list = lanes(new Array(n).fill(0).map((_, i) => `v${i}`));
    const used = list[n - 1].top + list[n - 1].h - list[0].top;
    /*
     * Short of the band by less than one lane — that is, no row is left over
     * that could have been given to EVERY lane. Lanes stay a uniform height
     * (cellWidth reads it, so an odd lane one row taller would draw its cells
     * a size bigger than its neighbours), which is why the remainder of the
     * division is allowed to go unused and nothing more.
     */
    assert.ok(avail - used < n, `${n} lanes use ${used} of ${avail} rows`);
  }
});

test('the grid label column leaves room for a two-letter name', () => {
  assert.ok(L.GRID_LEFT_X - L.GRID_LABEL_X >= 12, 'two chars is 11px plus a gap');
});

test('no result row runs past where the host stops plotting', () => {
  for (const y of [L.RESULT_BIG_Y, L.RESULT_ROW_A_Y, L.RESULT_ROW_B_Y,
                   L.PROGRESS_ROW_Y, L.VOICE_TABLE_Y]) {
    assert.ok(y + L.TEXT_H <= L.SCREEN_H, `a row at y${y} runs off the bottom`);
  }
  assert.ok(L.RESULT_PLOT.x + L.RESULT_PLOT.w <= L.SCREEN_W);
  assert.ok(L.RESULT_PLOT.y + L.RESULT_PLOT.h <= L.SCREEN_H);
  assert.ok(L.PROGRESS_PLOT.x + L.PROGRESS_PLOT.w <= L.SCREEN_W);
  assert.ok(L.PROGRESS_PLOT.y + L.PROGRESS_PLOT.h <= L.SCREEN_H);
  assert.ok(L.TEXT_MAX_PX < L.SCREEN_W);
});

test('the per-voice table stops before it falls off the screen', () => {
  const lastRow = L.VOICE_TABLE_Y + 16 + (L.VOICE_TABLE_MAX_ROWS - 1) * L.VOICE_TABLE_ROW_H;
  assert.ok(lastRow < L.SCREEN_H, 'the table is allowed more rows than fit');
});

test('the ready box fits: three rows, the rule, the tempo row, clear of the title and the hint line', async () => {
  /*
   * At an earlier geometry the third row landed on screen row 51 — outside a
   * box ending at 46, and across the sticking rule at 47. An overflow has to
   * fail here rather than ship.
   */
  const { READY_ROW_Y, READY_RULE_Y, READY_TEMPO_Y, readyTempoText } = await import('../src/chrome.mjs');
  const b = READY_BOX;
  assert.ok(b.x >= 0 && b.x + b.w <= L.SCREEN_W, 'the box runs off the side');
  assert.ok(b.y > L.HEADER_RULE_Y + 1, 'the box touches the title rule');
  assert.ok(L.HINT_Y - (b.y + b.h) >= 2, 'fewer than 2 clear rows between the box and the hint line');
  /* Three rows, each a line of text tall, a row clear of the rule. */
  for (let i = 0; i < 3; i++) {
    assert.ok(READY_ROW_Y + i * 9 + L.TEXT_H < READY_RULE_Y, `row ${i} runs into the rule`);
  }
  assert.ok(READY_ROW_Y >= 2, 'the first row touches the top edge');
  /* The LEVEL's digit (at +13, 15 tall) ends above the rule. */
  assert.ok(13 + 15 < READY_RULE_Y, 'the digit runs into the rule');
  /* The tempo row under the rule, inside the box, for 2 and 3 digits. */
  assert.ok(READY_TEMPO_Y > READY_RULE_Y + 1, 'the tempo row touches the rule');
  assert.ok(READY_TEMPO_Y + L.TEXT_H < b.h - 1, 'the tempo row runs into the bottom edge');
  const w = (s) => s.length * 6 - 1;
  for (const bpm of [92, 120, 240]) {
    assert.ok(3 + w(readyTempoText(bpm)) <= b.w - 3, `"${readyTempoText(bpm)}" runs out of the box`);
  }
  assert.equal(readyTempoText(92).length, readyTempoText(120).length, 'the bpm keeps its place');
});

/*
 * The ready box on one vertical rhythm, measured from its top edge (row 0)
 * to its bottom edge (row h-1); every line in it is 7 tall.
 */
test('the ready box\'s rhythm: even padding round the controls, the tempo and the digit centred, no row to spare', async () => {
  const C = await import('../src/chrome.mjs');
  const b = READY_BOX;
  const H7 = L.TEXT_H;
  const topPad = C.READY_ROW_Y - 1;
  const between = C.READY_ROW_PITCH - H7;
  const lastEnd = C.READY_ROW_Y + 2 * C.READY_ROW_PITCH + H7;     /* the row after the third control */
  const overRule = C.READY_RULE_Y - lastEnd;
  assert.deepEqual([topPad, between, overRule], [C.READY_PAD, C.READY_PAD, C.READY_PAD],
    'the same padding above the first control, between them and down to the rule');
  const underRule = C.READY_TEMPO_Y - (C.READY_RULE_Y + 1);
  const overEdge = (b.h - 1) - (C.READY_TEMPO_Y + H7);
  assert.equal(underRule, overEdge, `the tempo is not centred between the rule and the edge: ${underRule}/${overEdge}`);
  assert.equal(underRule, C.READY_PAD, 'and on the same rhythm');
  /* LEVEL on the first control's row; its digit (15 tall) between the word and the rule. */
  const underWord = C.READY_DIGIT_Y - (C.READY_ROW_Y + H7);
  const overRuleDigit = C.READY_RULE_Y - (C.READY_DIGIT_Y + 15);
  assert.ok(Math.abs(underWord - overRuleDigit) <= 1, `the digit is off centre: ${underWord}/${overRuleDigit}`);
  /* As compact as the rhythm allows: a row less, and the tempo is off centre. */
  assert.equal(b.h, C.READY_TEMPO_Y + H7 + C.READY_PAD + 1, 'a row to spare');
});

/* ---- L0's still page ---------------------------------------------------------- */

test('the page clears both renderers\' clipping, and the peek stays on screen', () => {
  /* The staff drops a head left of DESPAWN_X, the grid a cell left of
   * GRID_LEFT_X - 4; the bar line before the first stack must still draw. */
  assert.ok(L.PAGE_LEFT_STAFF_X + L.BAR_OFFSET_PX >= L.DESPAWN_X, 'the staff page bar line is clipped');
  assert.ok(L.PAGE_LEFT_STAFF_X - (L.HEAD_W >> 1) - 1 >= L.DESPAWN_X, 'the first head is clipped');
  assert.ok(L.PAGE_LEFT_GRID_X + L.BAR_OFFSET_PX >= L.GRID_LEFT_X, 'the grid page bar line is clipped');
  /* The peek and the double bar never stand together — the double bar is
   * what stands there when nothing follows — so each is checked on its own. */
  assert.ok(L.PAGE_PEEK_X - 4 > L.PAGE_BAR_X, 'the widest peek cell runs into the bar line');
  assert.ok(L.PAGE_PEEK_X + 4 < L.SCREEN_W, 'the widest peek cell runs off the screen');
  assert.ok(L.PAGE_BAR_X + 2 < L.SCREEN_W, 'the double bar runs off the screen');
});

test('every bundled groove\'s bar fits a page with its stacks apart', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseExercise, parseManifest } = await import('../src/exercise_io.mjs');
  const { pageGeometry } = await import('../src/page_view.mjs');
  const { availableLevels } = await import('../src/levels.mjs');
  const dir = new URL('../src/exercises/', import.meta.url);
  const man = parseManifest(readFileSync(new URL('index.json', dir), 'utf8'));
  for (const e of man.entries) {
    const c = parseExercise(readFileSync(new URL(e.file, dir), 'utf8'), e.id).chart;
    if (availableLevels(c)[0].id !== 'l0') continue;   /* a rudiment has no page */
    for (const view of ['grid', 'staff']) {
      const { px } = pageGeometry(view, c);
      for (let i = 1; i < c.events.length; i++) {
        const gap = (c.events[i].beat - c.events[i - 1].beat) * px;
        assert.ok(gap >= 3, `${e.id} (${view}): stacks ${gap.toFixed(1)}px apart`);
      }
    }
  }
});

test('the Path map sits between the title rule and the hint line, and its cells are the pads', async () => {
  const PL = await import('../src/pathmap/layout.mjs');
  assert.ok(PL.MAP_Y > L.HEADER_RULE_Y, 'the map runs into the title rule');
  assert.ok(PL.MAP_Y + PL.MAP_H <= L.HINT_Y, 'the map runs into the hint line');
  assert.equal(PL.MAP_W, L.SCREEN_W, 'the map is the screen\'s width: a column a pad');
  /* Seven islands, and any island the folder can have (hut, four tracks, cove, fort). */
  for (const n of [7, 1, 2, 3, 4, 5, 6]) {
    const layout = PL.layoutPlaces(n);
    const pads = new Set(layout.cells.map((c) => PL.padOfCell(c)));
    assert.equal(pads.size, n, `${n} places share a pad`);
  }
});

test('the split ready box: the words keep left of the line, LEVEL and its digit inside the right', async () => {
  const { READY_SPLIT } = await import('../src/chrome.mjs');
  const { bigTextWidth } = await import('../src/staff_render.mjs');
  const b = L.READY_BOX;
  const w = (s) => s.length * 6 - 1;
  for (const word of ['listen', 'practise', 'scrub', 'hear bar', 'own pace']) {
    /* The glyph column 9 wide, the words 3px after it. */
    assert.ok(b.x + 3 + 9 + 3 + w(word) + 1 < b.x + READY_SPLIT, `"${word}" crosses into the level`);
  }
  const right = b.w - READY_SPLIT - 1;
  assert.ok(3 + w('LEVEL') + 5 + 2 <= right, 'LEVEL and the done mark do not fit their half');
  for (const d of ['0', '1', '2', '3', '4']) {
    const dw = bigTextWidth(d, 3);
    const cx = b.x + READY_SPLIT + 1 + (right >> 1);
    assert.ok(cx - (dw >> 1) - 10 > b.x + READY_SPLIT, `the < of ${d} crosses the line`);
    assert.ok(cx + (dw >> 1) + 5 + 5 < b.x + b.w, `the > of ${d} leaves the box`);
  }
  assert.ok(b.y + 13 + 15 <= b.y + b.h, 'the digit runs out of the box');
  /* The longest level name beside its keys, or taking turns with them. */
  assert.ok('L4  Everything'.length <= 21);
});
