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

test('the bands run top to bottom without overlapping', () => {
  const bands = [
    ['header', 0, L.HEADER_H - 1],
    ['rule', L.HEADER_RULE_Y, L.HEADER_RULE_Y],
    ['chart', L.STAFF_AREA_TOP_Y, L.STAFF_AREA_BOTTOM_Y],
    ['name rule', L.NAME_RULE_Y, L.NAME_RULE_Y],
    ['sticking', L.NAME_LANE_Y, L.NAME_LANE_Y + L.TEXT_H - 1],
    ['timing', L.TIMING_BAR_Y, L.TIMING_BAR_Y + L.TIMING_BAR_H - 1],
  ];
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i][1] > bands[i - 1][2],
      `${bands[i][0]} starts at ${bands[i][1]}, inside ${bands[i - 1][0]}`);
  }
  const last = bands[bands.length - 1];
  assert.ok(last[2] < L.SCREEN_H, `${last[0]} runs off the bottom`);
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

test('the timing bar fits the screen and is centred on it', () => {
  assert.equal(L.TIMING_CENTER_X, L.SCREEN_W / 2);
  assert.ok(L.TIMING_CENTER_X - L.TIMING_HALF_W >= 0);
  assert.ok(L.TIMING_CENTER_X + L.TIMING_HALF_W < L.SCREEN_W);
  assert.ok(L.TIMING_BAR_Y + L.TIMING_BAR_H <= L.SCREEN_H);
});

test('the timing scale is wider than the worst window it must show', () => {
  /* Otherwise a disastrous hit pins at the end and reads as merely bad. */
  assert.ok(L.TIMING_SPAN_MS > 160, 'the loose "gone" window is 160ms');
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

test('the grid label column leaves room for a two-letter name', () => {
  assert.ok(L.GRID_LEFT_X - L.GRID_LABEL_X >= 12, 'two chars is 11px plus a gap');
});

test('no result row runs past where the host stops plotting', () => {
  for (const y of [L.RESULT_BIG_Y, L.RESULT_ROW_A_Y, L.RESULT_ROW_B_Y,
                   L.PROGRESS_TITLE_Y, L.PROGRESS_ROW_Y, L.VOICE_TABLE_Y]) {
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
