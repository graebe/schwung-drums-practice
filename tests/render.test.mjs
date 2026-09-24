/*
 * Pixel assertions on both renderers.
 *
 * The interesting failures in a 1-bit chart are geometric — a voice one step
 * out, a beam broken across a group, a kick whose stem points the wrong way —
 * and none of them throw. So the drawing is rendered into the same 128x64
 * buffer `npm run preview` uses and asserted on directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreen, countOn, isOn } from '../tools/screen_buffer.mjs';
import * as L from '../src/layout.mjs';
import * as SR from '../src/staff_render.mjs';
import * as GR from '../src/grid_render.mjs';
import { drawReadingView, timingX } from '../src/view.mjs';
import { createRun, ensureEntries, judgeHit, expireMissed } from '../src/scoring.mjs';
import { subdivisionDrill, grooveVariation } from '../src/generator.mjs';
import { voiceById, VOICES } from '../src/kit.mjs';
import { diatonicToY } from '../src/notation.mjs';
import { createTiming, pushOffset } from '../src/timing.mjs';

const yOf = (id) => diatonicToY(voiceById(id).diatonic);

function frame(chart, opts = {}) {
  const run = createRun(chart, {
    looping: opts.looping !== false,
    sticking: opts.sticking || chart.sticking || 'off',
  });
  ensureEntries(run, (opts.songBeats || 0) + 8);
  if (opts.play) opts.play(run);
  const ctx = createScreen();
  drawReadingView(ctx, {
    run, chart,
    songBeats: opts.songBeats || 0,
    pxPerBeat: opts.px || L.PX_PER_BEAT_DEFAULT,
    view: opts.view || 'staff',
    title: opts.title || chart.name,
    bpm: chart.bpm, looping: opts.looping !== false,
    dynamics: opts.dynamics !== false,
  });
  return { ctx, run };
}

/* ---- The staff itself --------------------------------------------------- */

test('the five staff lines are where the layout says', () => {
  const ctx = createScreen();
  SR.drawStaff(ctx);
  for (const y of L.STAFF_LINE_YS) {
    assert.ok(isOn(ctx, 60, y), `no staff line at y${y}`);
    assert.ok(!isOn(ctx, 60, y + 1), `staff line at y${y} is too thick`);
  }
  assert.ok(!isOn(ctx, L.STAFF_LEFT_X - 1, L.STAFF_TOP_Y), 'lines start after the clef');
});

test('the percussion clef is two bars, not a smudge', () => {
  const ctx = createScreen();
  SR.drawClef(ctx);
  const h = L.CLEF_BOTTOM_Y - L.CLEF_TOP_Y + 1;
  assert.equal(countOn(ctx, L.CLEF_X, L.CLEF_TOP_Y, L.CLEF_W, h), L.CLEF_W * h);
  const second = L.CLEF_X + L.CLEF_W + L.CLEF_GAP;
  assert.equal(countOn(ctx, second, L.CLEF_TOP_Y, L.CLEF_W, h), L.CLEF_W * h);
  /* And there is real space between them. */
  assert.equal(countOn(ctx, L.CLEF_X + L.CLEF_W, L.CLEF_TOP_Y, L.CLEF_GAP, h), 0);
});

/* ---- Heads -------------------------------------------------------------- */

test('every voice draws at its own height, and no two share one', () => {
  const seen = new Map();
  for (const v of VOICES) {
    const ctx = createScreen();
    SR.drawNote(ctx, 60, yOf(v.id), v.head, 'pending', 'normal', 16);
    assert.ok(countOn(ctx, 55, yOf(v.id) - 3, 11, 7) > 0, `${v.id} drew nothing`);
    const key = `${yOf(v.id)}:${v.head}`;
    assert.ok(!seen.has(key), `${v.id} is indistinguishable from ${seen.get(key)}`);
    seen.set(key, v.id);
  }
});

test('a drum reads as a block and a cymbal as an x', () => {
  const block = createScreen();
  SR.drawNote(block, 60, 26, 'note', 'pending', 'normal', 16);
  /* A filled head is solid all the way across its middle row. */
  assert.equal(countOn(block, 58, 26, 5, 1), 5);

  const x = createScreen();
  SR.drawNote(x, 60, 26, 'x', 'pending', 'normal', 16);
  /* An x is hollow in the middle of its top row and lit at the corners. */
  assert.ok(isOn(x, 58, 24) && isOn(x, 62, 24), 'x has no top corners');
  assert.ok(!isOn(x, 60, 24), 'x is filled in');
  assert.ok(isOn(x, 60, 26), 'x has no centre');
});

test('a circled x is an x with a ring round it', () => {
  const plain = createScreen();
  const circled = createScreen();
  SR.drawNote(plain, 60, 26, 'x', 'pending', 'normal', 16);
  SR.drawNote(circled, 60, 26, 'circled-x', 'pending', 'normal', 16);
  assert.ok(countOn(circled, 54, 20, 13, 13) > countOn(plain, 54, 20, 13, 13));
});

test('a hit opens into a ring; the ring is hollow', () => {
  const ctx = createScreen();
  SR.drawNote(ctx, 60, 26, 'note', 'hit', 'normal', 16);
  assert.ok(!isOn(ctx, 60, 26), 'the ring is filled in — it must open');
  assert.ok(isOn(ctx, 58, 26) && isOn(ctx, 62, 26), 'the ring has no sides');
});

test('a missed note is struck through, and still reads as its own voice', () => {
  const missed = createScreen();
  const pending = createScreen();
  SR.drawNote(missed, 60, 26, 'x', 'missed', 'normal', 16);
  SR.drawNote(pending, 60, 26, 'x', 'pending', 'normal', 16);
  assert.ok(countOn(missed, 52, 18, 17, 17) > countOn(pending, 52, 18, 17, 17),
    'a miss must add a mark, not replace the head');
  assert.ok(isOn(missed, 60, 26), 'the cymbal is no longer legible as a cymbal');
});

/* ---- Dynamics ----------------------------------------------------------- */

test('the dynamic is carried by weight: ghost < normal < accent', () => {
  const width = (dyn, spacing) => {
    const ctx = createScreen();
    SR.drawNote(ctx, 60, 26, 'note', 'pending', dyn, spacing);
    return countOn(ctx, 50, 26, 25, 1);
  };
  for (const spacing of [16, 8]) {
    const g = width('ghost', spacing);
    const n = width('normal', spacing);
    const a = width('accent', spacing);
    assert.ok(g < n && n < a, `at ${spacing}px: ${g}/${n}/${a} are not three steps`);
    assert.ok(g >= 1, 'a ghost note must still be a mark, not an absence');
  }
});

test('heads shrink when the bar is tight, keeping the three steps apart', () => {
  assert.ok(SR.headWidth('normal', 8) < SR.headWidth('normal', 16));
  assert.ok(SR.headWidth('accent', 8) > SR.headWidth('normal', 8));
  assert.ok(SR.headWidth('ghost', 8) < SR.headWidth('normal', 8));
});

test('sixteenths do not run into each other at the default read-ahead', () => {
  /* The failure this guards: at 24px/beat a 5px head left one pixel of gap and
   * a bar of sixteenths was a grey smear. */
  const { ctx } = frame(subdivisionDrill('sixteenths', { bpm: 90 }));
  const y = yOf('SN');
  let gaps = 0;
  for (let x = L.HIT_X; x < L.HIT_X + 32; x++) if (!isOn(ctx, x, y)) gaps++;
  assert.ok(gaps >= 8, `only ${gaps} clear pixels in a beat of sixteenths`);
});

/* ---- Stems and beams ---------------------------------------------------- */

test('hands stem up and feet stem down', () => {
  const up = createScreen();
  SR.drawStem(up, 60, yOf('SN'), true, 5, true);
  assert.ok(countOn(up, 58, 10, 5, 14) > 0, 'no up-stem above the snare');
  assert.equal(countOn(up, 58, yOf('SN') + 2, 5, 8), 0, 'the up-stem went down');

  const down = createScreen();
  SR.drawStem(down, 60, yOf('KK'), false, 5, false);
  assert.ok(countOn(down, 56, yOf('KK') + 2, 5, 8) > 0, 'no down-stem below the kick');
  assert.equal(countOn(down, 56, 10, 5, 8), 0, 'the down-stem went up');
});

test('a stem joins every head in its stack', () => {
  /* A hi-hat over a snare is one hit, and the stem has to say so: drawn from
   * the hi-hat alone, the snare floats unattached. */
  const ctx = createScreen();
  SR.drawStack(ctx, {
    x: 60,
    entry: { notes: [
      { voice: 'HH', state: 'pending', wantDyn: 'normal' },
      { voice: 'SN', state: 'pending', wantDyn: 'normal' },
    ] },
  }, { spacingPx: 16, beams: 1 });
  let lit = 0;
  for (let y = yOf('HH'); y <= yOf('SN'); y++) {
    for (let x = 60; x <= 64; x++) if (isOn(ctx, x, y)) { lit++; break; }
  }
  assert.equal(lit, yOf('SN') - yOf('HH') + 1, 'the stem does not reach the lower head');
});

test('an unbeamed note does not reach for a beam that is not there', () => {
  const beamed = createScreen();
  const plain = createScreen();
  SR.drawStem(beamed, 60, yOf('SN'), true, 5, true);
  SR.drawStem(plain, 60, yOf('SN'), true, 5, false);
  assert.ok(countOn(beamed, 58, L.STEM_UP_Y, 5, 3) > 0, 'a beamed stem must reach the beam');
  assert.equal(countOn(plain, 58, L.STEM_UP_Y, 5, 3), 0, 'an unbeamed stem must stop short');
});

test('a run of sixteenths is beamed unbroken, and breaks at the beat', () => {
  const { ctx } = frame(subdivisionDrill('sixteenths', { bpm: 90 }));
  const px = L.PX_PER_BEAT_DEFAULT;
  const y = L.STEM_UP_Y;
  /* Inside the first beat the beam is continuous from the first head to the
   * last — four sixteenths, so from HIT_X to HIT_X + 3/4 of a beat. */
  const from = L.HIT_X + 2;
  const to = L.HIT_X + Math.round(px * 0.75);
  for (let x = from; x <= to; x++) assert.ok(isOn(ctx, x, y), `beam broken at x${x}`);
  /* And there is a gap before the next beat's group begins. */
  let gap = 0;
  for (let x = to + 1; x < L.HIT_X + px; x++) if (!isOn(ctx, x, y)) gap++;
  assert.ok(gap >= 2, 'the beam does not break between beats');
});

test('sixteenths get two beams, eighths one, quarters none', () => {
  const px = L.PX_PER_BEAT_DEFAULT;
  /* Probe MIDWAY between the first two notes of the beat, where a beam is the
   * only thing that can be lit — a stem or a head would make any x near a
   * notehead report a beam that is not there. */
  const beamRows = (chart, per) => {
    const { ctx } = frame(chart);
    const x = L.HIT_X + Math.round(px / per / 2);
    let rows = 0;
    for (let i = 0; i < L.MAX_BEAMS; i++) {
      if (isOn(ctx, x, L.STEM_UP_Y + i * L.BEAM_GAP)) rows++;
    }
    return rows;
  };
  assert.equal(beamRows(subdivisionDrill('sixteenths', { bpm: 90 }), 4), 2);
  assert.equal(beamRows(subdivisionDrill('eighths', { bpm: 90 }), 2), 1);
  assert.equal(beamRows(subdivisionDrill('triplets', { bpm: 90 }), 3), 1, 'a triplet is one beam');
  assert.equal(beamRows(subdivisionDrill('quarters', { bpm: 90 }), 1), 0);
});

test('the crash gets a ledger line and nothing else does', () => {
  for (const v of VOICES) {
    const ctx = createScreen();
    SR.drawLedgers(ctx, 60, yOf(v.id));
    const lit = countOn(ctx, 54, L.STAFF_AREA_TOP_Y, 13, 36);
    if (v.id === 'CR') assert.ok(lit > 0, 'the crash needs its ledger');
    else assert.equal(lit, 0, `${v.id} drew a ledger it does not need`);
  }
});

/* ---- Chrome ------------------------------------------------------------- */

test('the timing bar puts zero in the middle and early on the left', () => {
  assert.equal(timingX(0), L.TIMING_CENTER_X);
  assert.ok(timingX(-50) < timingX(0), 'early must be to the left');
  assert.ok(timingX(50) > timingX(0), 'late must be to the right');
  /* The scale never rescales itself to the data, so a wild hit pins rather
   * than redrawing the axis. */
  assert.equal(timingX(-9999), timingX(-L.TIMING_SPAN_MS));
  assert.equal(timingX(9999), timingX(L.TIMING_SPAN_MS));
});

test('the timing cloud sits where the hits were', () => {
  const ctx = createScreen();
  const t = createTiming();
  for (let i = 0; i < 8; i++) pushOffset(t, 'SN', -80, i);
  drawReadingView(ctx, {
    run: { timing: t, entries: [], markers: [], windows: { goodMs: 60 }, sticking: 'off' },
    chart: { timeSig: [4, 4], events: [], bpm: 90 },
    songBeats: 0, pxPerBeat: 32, view: 'grid', title: 't', bpm: 90, looping: true,
  });
  const left = countOn(ctx, timingX(-80) - 2, L.TIMING_BAR_Y, 5, L.TIMING_BAR_H);
  const right = countOn(ctx, timingX(80) - 2, L.TIMING_BAR_Y, 5, L.TIMING_BAR_H);
  assert.ok(left > right, 'a bar of early hits did not show up on the early side');
});

test('the hit line marks now, and thickens on the beat', () => {
  const thin = createScreen();
  const thick = createScreen();
  SR.drawHitLine(thin, false);
  SR.drawHitLine(thick, true);
  const h = L.HIT_LINE_BOTTOM_Y - L.HIT_LINE_TOP_Y + 1;
  assert.equal(countOn(thin, L.HIT_X, L.HIT_LINE_TOP_Y, 2, h), h);
  assert.equal(countOn(thick, L.HIT_X, L.HIT_LINE_TOP_Y, 2, h), h * 2);
});

/* ---- The grid ----------------------------------------------------------- */

test('grid lanes are sized to the voices the drill actually uses', () => {
  const two = GR.lanes(['SN', 'KK']);
  const six = GR.lanes(['CR', 'HH', 'RD', 'SN', 'LT', 'KK']);
  assert.equal(two.length, 2);
  assert.equal(six.length, 6);
  assert.ok(two[0].h > six[0].h, 'a two-voice drill should get taller lanes');
  for (const list of [two, six]) {
    assert.ok(list[0].top >= L.GRID_TOP_Y);
    const last = list[list.length - 1];
    assert.ok(last.top + last.h - 1 <= L.GRID_BOTTOM_Y, 'lanes overflow the band');
    for (let i = 1; i < list.length; i++) {
      assert.equal(list[i].top, list[i - 1].top + list[i - 1].h, 'lanes must not overlap');
    }
  }
});

test('the grid is centred in its band, not hugging the top', () => {
  const list = GR.lanes(['SN', 'KK']);
  const top = list[0].top - L.GRID_TOP_Y;
  const bottom = L.GRID_BOTTOM_Y - (list[1].top + list[1].h - 1);
  assert.ok(Math.abs(top - bottom) <= 1, `${top} above, ${bottom} below`);
});

test('a grid hit opens when you get it, exactly as the notehead does', () => {
  const lane = GR.lanes(['SN'])[0];
  const pending = createScreen();
  const hit = createScreen();
  GR.drawCell(pending, 60, lane, 'pending');
  GR.drawCell(hit, 60, lane, 'hit');
  assert.ok(countOn(pending, 58, lane.top, 5, lane.h) > countOn(hit, 58, lane.top, 5, lane.h),
    'the hit cell must open, not stay solid');
});

test('both views draw the same drill without throwing, at every density', () => {
  for (const view of ['staff', 'grid']) {
    for (const kind of ['quarters', 'eighths', 'triplets', 'sixteenths', 'sextuplets']) {
      for (const px of [L.PX_PER_BEAT_MIN, L.PX_PER_BEAT_DEFAULT, L.PX_PER_BEAT_MAX]) {
        const { ctx } = frame(subdivisionDrill(kind, { bpm: 90 }), { view, px, songBeats: 1.3 });
        assert.ok(countOn(ctx, 0, 0, L.SCREEN_W, L.SCREEN_H) > 40, `${view}/${kind}/${px} is blank`);
      }
    }
  }
});

test('nothing is drawn outside the screen, at any moment of a loop', () => {
  const chart = grooveVariation({ seed: 5 });
  for (let t = 0; t < 8; t += 0.37) {
    const { ctx } = frame(chart, { songBeats: t, view: 'staff' });
    assert.equal(ctx.pixels.length, L.SCREEN_W * L.SCREEN_H);
  }
});

test('the played marker and the notehead are the same glyph', () => {
  /* Play in time and the two land on top of each other as one mark; play late
   * and the gap between them is the error, read straight off the chart. */
  const marker = createScreen();
  const head = createScreen();
  SR.drawPlayedMarker(marker, 60, 26);
  SR.drawNote(head, 60, 26, 'note', 'hit', 'normal', 16);
  for (let y = 22; y < 30; y++) {
    for (let x = 56; x < 65; x++) {
      assert.equal(isOn(marker, x, y), isOn(head, x, y), `differ at ${x},${y}`);
    }
  }
});
