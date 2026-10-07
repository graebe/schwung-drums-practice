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
import { drawReadingView, timingX, stuckLabel } from '../src/view.mjs';
import { rulerBars } from '../src/chart.mjs';
import { createRun, ensureEntries, judgeHit, expireMissed, blockingBeat, visibleEntries } from '../src/scoring.mjs';
import { subdivisionDrill, grooveVariation } from '../src/generator.mjs';
import { voiceById, VOICES } from '../src/kit.mjs';
import { diatonicToY } from '../src/notation.mjs';
import { createTiming, pushOffset } from '../src/timing.mjs';

const yOf = (id) => diatonicToY(voiceById(id).diatonic);

function frame(chart, opts = {}) {
  const run = createRun(chart, {
    repeats: opts.repeats === undefined ? 0 : opts.repeats,
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
    bpm: chart.bpm, repeats: opts.repeats === undefined ? 0 : opts.repeats,
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

/*
 * The timing band. It used to draw minor ticks every 50ms — nine evenly-spaced
 * marks across the full width, which is what an eight-segment bar counter looks
 * like, and is how it got read. Those marks were also the biggest thing in the
 * band and identical in every state, while the hits got two rows out of seven.
 *
 * The old test here asserted only that eight early hits tipped a left-vs-right
 * pixel count. It passed throughout, because the graduations were symmetric and
 * cancelled: it proved a difference existed, not that two performances looked
 * different from each other or that the picture was legible at all.
 */
function timingBand(offsets, windows = { goodMs: 60, okMs: 120, goneMs: 160 }) {
  const ctx = createScreen();
  const t = createTiming();
  for (let i = 0; i < offsets.length; i++) pushOffset(t, 'SN', offsets[i], i);
  drawReadingView(ctx, {
    run: { timing: t, entries: [], markers: [], windows, sticking: 'off', endBeat: Infinity },
    chart: { timeSig: [4, 4], events: [], bpm: 90 },
    songBeats: 0, pxPerBeat: 32, view: 'grid', title: 't', bpm: 90, looping: true,
  });
  return ctx;
}

/* Offsets with a given mean and spread, from a fixed seed. */
function spread(n, meanMs, sdMs, seed = 20260929) {
  let st = seed;
  const rnd = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: n }, () => meanMs + (rnd() + rnd() - 1) * sdMs * 1.7);
}

/* Lit columns of the histogram rows only — the data, never the furniture. */
function histCols(ctx) {
  const out = [];
  for (let x = 0; x < L.SCREEN_W; x++) {
    if (countOn(ctx, x, L.TIMING_BAR_Y, 1, L.TIMING_HIST_ROWS) > 0) out.push(x);
  }
  return out;
}
const centreOfMass = (cols) => cols.reduce((a, b) => a + b, 0) / cols.length;

test('two different performances do not draw the same picture', () => {
  const tight = timingBand(spread(48, 0, 12));
  const rushing = timingBand(spread(48, -55, 12));
  const dragging = timingBand(spread(48, 55, 12));
  const scattered = timingBand(spread(48, 0, 130));

  const all = { tight, rushing, dragging, scattered };
  const names = Object.keys(all);
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      assert.ok(!all[names[a]].pixels.every((v, k) => v === all[names[b]].pixels[k]),
        `${names[a]} and ${names[b]} draw identical pixels`);
    }
  }

  /* And differ in the RIGHT direction, not merely somewhere. */
  const c = (x) => centreOfMass(histCols(x));
  assert.ok(c(rushing) < c(tight) - 4, 'rushing did not sit left of centred playing');
  assert.ok(c(dragging) > c(tight) + 4, 'dragging did not sit right of centred playing');
  assert.ok(histCols(scattered).length > histCols(tight).length + 8,
    'scattered playing did not draw a wider shape than tight playing');
});

test('every pixel above the axis is data, and the furniture is not graduations', () => {
  const empty = timingBand([]);
  /* Nothing played: the histogram rows are completely blank, so anything there
   * later can only be hits. */
  assert.equal(countOn(empty, 0, L.TIMING_BAR_Y, L.SCREEN_W, L.TIMING_HIST_ROWS), 0,
    'the band drew something above the axis before a note was played');

  /* No row is a row of evenly-spaced isolated marks — the shape that read as
   * eight bars. A dotted axis row is allowed; a row of 1px marks with 10px
   * gaps, repeated across the width, is not. */
  for (let y = L.TIMING_BAR_Y; y < L.TIMING_BAR_Y + L.TIMING_BAR_H; y++) {
    const gaps = [];
    let prev = -1;
    for (let x = 0; x < L.SCREEN_W; x++) {
      if (!isOn(empty, x, y)) continue;
      if (prev >= 0 && x - prev > 1) gaps.push(x - prev);
      prev = x;
    }
    const wide = gaps.filter((g) => g > 3);
    assert.ok(wide.length <= 1, `row ${y} is a row of ${wide.length + 1} spaced marks`);
  }
});

test('the picture and the header read the same hits', () => {
  /* Enough early hits to fill the horizon, then a horizon's worth of late ones:
   * the early hits have aged out and the picture must say so, exactly as the
   * header's mean does. */
  const offsets = [...spread(60, -90, 8, 11), ...spread(L.TIMING_RECENT_N, 90, 8, 22)];
  const cols = histCols(timingBand(offsets));
  assert.ok(centreOfMass(cols) > L.TIMING_CENTER_X,
    'the band still showed the hits that have aged out of the header');
});

test('a hit past the end of the scale pins, it does not vanish', () => {
  const cols = histCols(timingBand(spread(20, 0, 8).concat([400, 420, 460])));
  const edge = timingX(L.TIMING_SPAN_MS);
  assert.ok(cols.some((x) => x >= edge - L.TIMING_HIST_BIN_W),
    'a hit 400ms late was dropped rather than pinned to the edge');
});

test('one bad hit among many good ones is still drawn', () => {
  /*
   * The case a proportional height loses. Forty hits on the beat put forty in
   * one bin, so a lone hit elsewhere is 1/40 of the peak — 0.125 of a row,
   * which rounds to nothing. You played one note badly and the bar would have
   * said you played them all well.
   */
  const cols = histCols(timingBand(new Array(40).fill(0).concat([150])));
  const at = timingX(150);
  assert.ok(cols.some((x) => Math.abs(x - at) <= L.TIMING_HIST_BIN_W),
    'the single late hit rounded away to nothing beside a tall peak');
});

test('on the beat is a column centred on zero', () => {
  assert.equal(L.TIMING_HIST_BINS % 2, 1,
    'an even bin count splits the beat across two columns, so a centred spike cannot exist');
  const cols = histCols(timingBand(new Array(24).fill(0)));
  assert.equal(Math.round(centreOfMass(cols)), L.TIMING_CENTER_X,
    'perfectly-timed hits did not draw on the centre');
  assert.ok(cols.length <= L.TIMING_HIST_BIN_W + 1, `one bin should be lit, ${cols.length} were`);
});

test('the good window is the one solid run on the axis', () => {
  const windows = { goodMs: 60, okMs: 120, goneMs: 160 };
  const ctx = timingBand([], windows);
  const axisY = L.TIMING_BAR_Y + L.TIMING_HIST_ROWS;
  /* Continuous between the window edges... */
  for (let x = timingX(-windows.goodMs); x <= timingX(windows.goodMs); x++) {
    assert.ok(isOn(ctx, x, axisY), `the window has a hole at x${x}`);
  }
  /* ...and immediately outside it there is a gap, so the run's width is the
   * window's width and not a pixel or two more. */
  assert.ok(!isOn(ctx, timingX(-windows.goodMs) - 1, axisY), 'a dot is stuck to the left edge');
  assert.ok(!isOn(ctx, timingX(windows.goodMs) + 1, axisY), 'a dot is stuck to the right edge');
});

test('zero is marked, and the mean sits beside it', () => {
  const markY = L.TIMING_BAR_Y + L.TIMING_HIST_ROWS + 1;
  const empty = timingBand([]);
  assert.ok(isOn(empty, L.TIMING_CENTER_X, markY), 'zero is not marked');

  const early = timingBand(spread(48, -90, 8));
  const lit = [];
  for (let x = 0; x < L.SCREEN_W; x++) if (isOn(early, x, markY)) lit.push(x);
  assert.ok(lit.some((x) => x < L.TIMING_CENTER_X - 8), 'the mean mark is not left of zero');
  assert.ok(lit.includes(L.TIMING_CENTER_X), 'zero stopped being marked once a mean appeared');
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

/* ---- The bar ruler ------------------------------------------------------ */
/*
 * The lane under the chart. Before this it was reserved for a sticking and
 * left blank for every groove — nine rows under a rule dividing nothing from
 * nothing, which is a quarter of the useful height of the screen.
 */

const rowLit = (ctx, y) => countOn(ctx, 0, y, L.SCREEN_W, 1);

test('a tick marks every visible bar line, at the bar line own x', () => {
  const chart = grooveVariation(1, 'rock');
  const { ctx } = frame(chart, { view: 'grid', songBeats: 5.2, repeats: 4 });
  const bars = rulerBars(chart, 5.2, L.PX_PER_BEAT_DEFAULT, Infinity);
  const onScreen = bars.filter((b) => b.x >= 0 && b.x < L.SCREEN_W);
  assert.ok(onScreen.length >= 1, 'no bar line was on screen to test with');
  for (const b of onScreen) {
    assert.ok(isOn(ctx, Math.round(b.x), L.UNDER_TICK_Y),
      `no tick under bar ${b.bar} at x${Math.round(b.x)}`);
  }
});

test('a groove gets bar numbers in the lane; a sticking drill keeps its hands', () => {
  const chart = grooveVariation(1, 'rock');
  const groove = frame(chart, { view: 'grid', songBeats: 5.2, repeats: 4, sticking: 'off' }).ctx;
  /* The number sits at the left edge, where the clamp holds it. */
  assert.ok(countOn(groove, 0, L.UNDER_LANE_Y, 12, L.TEXT_H) > 0,
    'no bar number at the left of the lane');

  const drill = subdivisionDrill(2);
  const stuck = frame(drill, { view: 'grid', songBeats: 5.2, repeats: 4, sticking: 'alternate' }).ctx;
  assert.equal(countOn(stuck, 0, L.UNDER_LANE_Y, 12, L.TEXT_H), 0,
    'a bar number was drawn over the sticking, which is where the downbeat hand goes');
  assert.ok(countOn(stuck, 0, L.UNDER_LANE_Y, L.SCREEN_W, L.TEXT_H) > 0,
    'the sticking lane lost its hands');
});

test('the bar number is on screen for the whole of a bar, not just near the line', () => {
  /*
   * At 32px/beat a 4/4 bar is 128px — the entire screen — so an unclamped
   * number shows for a fraction of each bar and is missing for the rest. A
   * readout that blinks out is one you learn to stop reading.
   */
  const chart = grooveVariation(1, 'rock');
  for (let i = 0; i < 8; i++) {
    const beats = 4 + i * 0.5;
    const { ctx } = frame(chart, { view: 'grid', songBeats: beats, repeats: 8 });
    assert.ok(countOn(ctx, 0, L.UNDER_LANE_Y, L.SCREEN_W, L.TEXT_H) > 0,
      `no bar number anywhere in the lane at beat ${beats}`);
  }
});

test('the bar number yields rather than running into the next tick', () => {
  const chart = grooveVariation(1, 'rock');
  for (let i = 0; i < 16; i++) {
    const beats = 4 + i * 0.25;
    const { ctx } = frame(chart, { view: 'grid', songBeats: beats, repeats: 8 });
    for (const b of rulerBars(chart, beats, L.PX_PER_BEAT_DEFAULT, Infinity)) {
      const x = Math.round(b.x);
      if (x < 1 || x >= L.SCREEN_W) continue;
      /* The column just left of a tick belongs to the tick, not to digits. */
      assert.equal(countOn(ctx, x - 1, L.UNDER_LANE_Y, 1, L.TEXT_H), 0,
        `a digit touches the tick for bar ${b.bar} at beat ${beats}`);
    }
  }
});

test('the running view leaves no dead band', () => {
  /*
   * THE ASSERTION THAT WOULD HAVE CAUGHT THIS. The old layout left three dead
   * bands: rows 9-13 and 41-46 as margin around lanes capped at 9px, and 48-56
   * as a sticking lane reserved for grooves that have no sticking. Twenty
   * blank rows of sixty-four, and no single test knew.
   *
   * The budget applies where the layout CHOOSES its geometry. The grid sizes
   * its own lanes, so its whole height is fair game. The staff's band is fixed
   * by the notation — rows 41-45 are the down-beam budget and a drill that
   * beams upward genuinely does not use them — so only the lane under it, the
   * part this change is about, is measured there.
   */
  const worstRun = (ctx, from, to) => {
    let run = 0;
    let worst = 0;
    let at = -1;
    for (let y = from; y < to; y++) {
      run = rowLit(ctx, y) === 0 ? run + 1 : 0;
      if (run > worst) { worst = run; at = y - run + 1; }
    }
    return { worst, at };
  };

  const groove = grooveVariation(1, 'rock');
  const drill = subdivisionDrill(2);

  /*
   * A groove fills its band. This is the case the user hit, and the one the
   * old cap wasted: three lanes of nine in a band of thirty-six.
   *
   * A ONE-LANE drill is exempt and stays exempt. A drum-machine view of a
   * single drum has one row of content, and no cap can conjure a second; the
   * air around it is the drill being what it is, not the layout misjudging.
   * That is also why the rudiments default to the staff.
   */
  const g = worstRun(frame(groove, { view: 'grid', songBeats: 5.2, repeats: 8 }).ctx,
                     L.HEADER_RULE_Y + 1, L.TIMING_BAR_Y);
  assert.ok(g.worst <= 3, `a groove in grid view: ${g.worst} blank rows from y${g.at}`);

  /* The lane under the chart carries something in every drill and every view.
   * Reserved-and-blank is exactly what it used to be. */
  for (const [name, chart] of [['a groove', groove], ['a one-voice drill', drill]]) {
    for (const view of ['grid', 'staff']) {
      const ctx = frame(chart, { view, songBeats: 5.2, repeats: 8 }).ctx;
      const u = worstRun(ctx, L.UNDER_RULE_Y, L.TIMING_BAR_Y);
      assert.ok(u.worst <= 2,
        `${name}, ${view}: the lane under the chart is ${u.worst} blank rows from y${u.at}`);
    }
  }
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

/* ---- drum tab ----------------------------------------------------------- */

test('a cymbal is an x and a drum is a blob — told apart at a glance', () => {
  const lane = GR.lanes(['HH'])[0];
  const cym = createScreen();
  const drum = createScreen();
  GR.drawCell(cym, 60, lane, 'pending', 'x', 'normal');
  GR.drawCell(drum, 60, lane, 'pending', 'note', 'normal');
  /* The x is hollow through its middle row; the blob is solid. */
  assert.ok(!isOn(cym, 60, lane.mid - 2), 'the x has no gap at its top');
  assert.ok(isOn(drum, 60, lane.mid - 2), 'the blob is not filled');
  assert.ok(countOn(drum, 56, lane.mid - 3, 9, 7) > countOn(cym, 56, lane.mid - 3, 9, 7),
    'a drum should read heavier than a cymbal');
});

test('a grid hit OPENS, exactly as the notehead does', () => {
  const lane = GR.lanes(['SN'])[0];
  const pending = createScreen();
  const hit = createScreen();
  GR.drawCell(pending, 60, lane, 'pending', 'note', 'normal');
  GR.drawCell(hit, 60, lane, 'hit', 'note', 'normal');
  assert.ok(isOn(pending, 60, lane.mid), 'a pending drum is solid');
  assert.ok(!isOn(hit, 60, lane.mid), 'a hit drum must open into a ring');
});

test('a missed cell is struck through and still reads as its voice', () => {
  const lane = GR.lanes(['KK'])[0];
  const missed = createScreen();
  const pending = createScreen();
  GR.drawCell(missed, 60, lane, 'missed', 'note', 'normal');
  GR.drawCell(pending, 60, lane, 'pending', 'note', 'normal');
  assert.ok(countOn(missed, 52, lane.top, 17, lane.h) > countOn(pending, 52, lane.top, 17, lane.h),
    'a miss must ADD a mark, not replace the glyph');
});

test('the tab carries dynamics by weight: ghost < normal < accent', () => {
  const lane = GR.lanes(['SN'])[0];
  /* The glyph's horizontal EXTENT, not a row count: an x is two diagonals
   * meeting at a single pixel, so its middle row is one pixel wide whatever
   * size it is drawn at. */
  const width = (dyn, head) => {
    const ctx = createScreen();
    GR.drawCell(ctx, 60, lane, 'pending', head, dyn);
    let lo = 99;
    let hi = -1;
    for (let x = 50; x < 71; x++) {
      if (countOn(ctx, x, lane.top, 1, lane.h) > 0) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    return hi < 0 ? 0 : hi - lo + 1;
  };
  for (const head of ['note', 'x']) {
    const g = width('ghost', head);
    const n = width('normal', head);
    const a = width('accent', head);
    assert.ok(g < n && n < a, `${head}: ${g}/${n}/${a} are not three steps`);
    assert.ok(g >= 1, 'a ghost note must still be a mark, not an absence');
  }
});

test('cell widths stay odd, so a hit sits centred on its beat', () => {
  for (const laneH of [4, 6, 9]) {
    for (const dyn of ['ghost', 'normal', 'accent']) {
      const w = GR.cellWidth(dyn, laneH);
      assert.equal(w % 2, 1, `${dyn} at lane height ${laneH} is ${w}px — even`);
      assert.ok(w >= 1 && w <= 7);
    }
  }
});

test('the header rule doubles as a progress bar, and endless leaves it alone', () => {
  const chart = subdivisionDrill('eighths', { bpm: 90 });
  const half = frame({ ...chart, repeats: 4 }, { repeats: 4, songBeats: 8 }).ctx;
  const none = frame(chart, { repeats: 0, songBeats: 8 }).ctx;
  const y = L.HEADER_RULE_Y - 1;
  const filled = countOn(half, 0, y, L.SCREEN_W, 1);
  assert.ok(filled > 40 && filled < 90, `progress bar is ${filled}px of 128 at the half-way mark`);
  assert.equal(countOn(none, 0, y, L.SCREEN_W, 1), 0, 'there is no fraction of forever');
});

test('the grid is what you see first', async () => {
  const { DEFAULTS } = await import('../src/settings_def.mjs');
  assert.equal(DEFAULTS.view, 'grid');
});

/* ---- the ready overlay -------------------------------------------------- */

import { drawReady, READY_BOX } from '../src/view.mjs';
import { drawScrubGlyph, SCRUB_W, SCRUB_H } from '../src/glyphs.mjs';

function readyFrame(opts = {}) {
  const chart = subdivisionDrill('eighths', { bpm: 90 });
  const run = createRun(chart, { repeats: 8 });
  ensureEntries(run, 32);
  const ctx = createScreen();
  const text = [];
  const orig = ctx.text.bind(ctx);
  ctx.text = (x, y, s, v) => { text.push(s); orig(x, y, s, v); };
  drawReady(ctx, {
    run, chart, songBeats: opts.songBeats || 0, pxPerBeat: 32, view: 'grid',
    title: chart.name, bpm: chart.bpm, dynamics: true, ...opts,
  });
  return { ctx, text };
}

test('the ready box holds three controls, and names all three', () => {
  const { text } = readyFrame();
  const joined = text.join('|');
  for (const word of ['PLAY', 'REC', 'SCRUB']) {
    assert.ok(joined.includes(word), `no ${word} row: ${joined}`);
  }
});

test('the box is over the chart at home and gone once you scrub', () => {
  /* It covers exactly the music you are scrubbing through, so keeping it up
   * would defeat the scrubbing. */
  const home = readyFrame({ songBeats: 0 });
  const away = readyFrame({ songBeats: 4 });
  assert.ok(home.text.join('|').includes('SCRUB'));
  assert.ok(!away.text.join('|').includes('SCRUB'), 'the box stayed up');
  const b = READY_BOX;
  assert.ok(countOn(home.ctx, b.x, b.y, b.w, 1) > b.w / 2, 'the box has no top edge');
  assert.ok(countOn(away.ctx, b.x, b.y, b.w, 1) < b.w / 2, 'the box outline survived');
});

test('a warning takes the scrub row, being rarer and more urgent', () => {
  const { text } = readyFrame({ warning: 'no pad for HF' });
  const joined = text.join('|');
  assert.ok(joined.includes('no pad for HF'));
  assert.ok(!joined.includes('SCRUB'), 'the warning and the hint both claimed the row');
  assert.ok(joined.includes('PLAY') && joined.includes('REC'));
});

test('the scrub glyph is a BROKEN ring, not a closed one', () => {
  /*
   * Closing it and marking the head with one pixel reads as a plain "C" at
   * this size — an arrow needs a wedge and somewhere to point, so the bottom
   * arc is cut short to give it one.
   */
  const ctx = createScreen();
  drawScrubGlyph(ctx, 20, 20);
  const rightEdge = countOn(ctx, 20 + SCRUB_W - 2, 20, 2, SCRUB_H);
  const leftEdge = countOn(ctx, 20, 20, 2, SCRUB_H);
  assert.ok(leftEdge > rightEdge, 'the ring is not open on its right');
  assert.ok(countOn(ctx, 20, 20, SCRUB_W, SCRUB_H) > 18, 'the glyph is too faint to read');
  /* And it is wider than the two buttons, which is what makes it read as a
   * knob rather than a third button. */
  assert.ok(SCRUB_W > 7);
});

test('Study names the drum it has stopped for, and the note is on the hit line', () => {
  const chart = {
    id: 'x', name: 'X', bpm: 120, timeSig: [4, 4], loopBars: 1, repeats: 1, sticking: 'strict',
    events: [{ beat: 0, voices: ['SN'], hand: 'R' }, { beat: 1, voices: ['KK', 'HH'] }],
  };
  const run = createRun(chart, { sticking: 'strict' });
  expireMissed(run, 0.5, true);
  assert.equal(stuckLabel(run), 'Snare R');
  const seen = [];
  const c = createScreen();
  const text = c.text.bind(c);
  c.text = (x, y, str, v) => { seen.push(str); return text(x, y, str, v); };
  drawReadingView(c, { run, chart, songBeats: blockingBeat(run), pxPerBeat: 24, view: 'staff',
    blocked: true, title: 'X', bpm: 120 });
  assert.ok(seen.includes('Snare R'), seen.join(' | '));
  /* The frozen note is drawn ON the hit line, not lost off the left edge
   * where the old one-beat grace put it. */
  const frozen = visibleEntries(run, blockingBeat(run), 24).find((v) => v.index === 0);
  assert.ok(frozen, 'the note Study is waiting for is not on screen');
  assert.equal(frozen.x, L.HIT_X);
  judgeHit(run, { voice: 'SN', hand: 'R' }, 0.5, 0);
  expireMissed(run, 1.5, true);
  assert.equal(stuckLabel(run), 'Kick + Hi-hat', 'no hand named where the drill asks none');
});

import { drawSummary, drawResult, drawQuiz } from '../src/view.mjs';
import { createQuiz, takeHint } from '../src/guess.mjs';

function capture() {
  const seen = [];
  const c = createScreen();
  const text = c.text.bind(c);
  c.text = (x, y, str, v) => { seen.push(str); return text(x, y, str, v); };
  return { c, seen };
}

test('a best take says so, on the summary and on a quiz result', () => {
  const chart = { id: 'x', name: 'X', bpm: 90, timeSig: [4, 4], loopBars: 1, repeats: 1,
    events: [{ beat: 0, voices: ['SN'] }] };
  const run = createRun(chart);
  judgeHit(run, { voice: 'SN' }, 0);
  let { c, seen } = capture();
  drawSummary(c, { run, tightMs: 30, isBest: true });
  assert.ok(seen.includes('BEST YET'));
  ({ c, seen } = capture());
  drawSummary(c, { run, tightMs: 30, isBest: false });
  assert.ok(seen.includes('RESULT') && !seen.includes('BEST YET'));
  ({ c, seen } = capture());
  drawResult(c, { rate: 30, best: 30, errorRate: 0, hints: 0, series: [], isBest: true });
  assert.ok(seen.includes('BEST YET'));
});

test('the first Hear hint names the drum and still hides the staff', () => {
  const quiz = createQuiz({ kind: 'voice', mode: 'hear', roundSize: 10, seed: 3 });
  const draw = () => {
    const { c, seen } = capture();
    drawQuiz(c, { quiz, labelFor: (id) => voiceById(id).label, isEliminated: () => false,
      hintsLeft: 2 - quiz.hints, progress: '0/10' });
    return seen;
  };
  const name = voiceById(quiz.prompt).label;
  assert.ok(!draw().includes(name), 'named before any hint');
  assert.equal(takeHint(quiz), 'name');
  const after = draw();
  assert.ok(after.includes(name), 'the name hint showed no name');
  assert.ok(after.includes('?'), 'and the staff is still withheld');
});
