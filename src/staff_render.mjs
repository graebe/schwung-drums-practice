/*
 * staff_render.mjs — the percussion staff and every glyph on it.
 *
 * Draws through a `ctx` object rather than calling the host globals directly.
 * On the Move `ctx` is a thin wrapper over clear_screen/fill_rect/draw_line/
 * print; in tests it is a 128x64 byte buffer. That is what makes the drawing
 * testable and `npm run preview` possible.
 *
 * ctx: { clear(), fillRect(x,y,w,h,v), drawRect(x,y,w,h,v),
 *        line(x0,y0,x1,y1,v), text(x,y,s,v), textWidth(s) }
 */

import * as L from './layout.mjs';
import { blit, rowsToRuns, drawRing, drawX, CIRCLE_RUNS } from './glyphs.mjs';
import { ledgerYs, diatonicToY } from './notation.mjs';
import { voiceById, sortVoices } from './kit.mjs';
import * as B from './beam.mjs';

/* ---- Percussion clef ---------------------------------------------------- */
/*
 * Two heavy vertical bars spanning the staff. This is the real glyph, which
 * is a piece of luck: a treble clef at this size is a smudge, and the
 * percussion clef is two rectangles.
 */
export function drawClef(ctx, x = L.CLEF_X) {
  const h = L.CLEF_BOTTOM_Y - L.CLEF_TOP_Y + 1;
  ctx.fillRect(x, L.CLEF_TOP_Y, L.CLEF_W, h, 1);
  ctx.fillRect(x + L.CLEF_W + L.CLEF_GAP, L.CLEF_TOP_Y, L.CLEF_W, h, 1);
}

/* ---- Staff and furniture ------------------------------------------------ */
export function drawStaff(ctx) {
  for (let i = 0; i < L.STAFF_LINE_YS.length; i++) {
    ctx.fillRect(L.STAFF_LEFT_X, L.STAFF_LINE_YS[i], L.SCREEN_W - L.STAFF_LEFT_X, 1, 1);
  }
}

/* The "now" line. `strong` thickens it on the beat. */
export function drawHitLine(ctx, strong = false) {
  const h = L.HIT_LINE_BOTTOM_Y - L.HIT_LINE_TOP_Y + 1;
  ctx.fillRect(L.HIT_X, L.HIT_LINE_TOP_Y, strong ? 2 : 1, h, 1);
}

export function drawBarLine(ctx, x) {
  if (x < L.DESPAWN_X || x >= L.SCREEN_W) return;
  const h = L.STAFF_BOTTOM_Y - L.STAFF_TOP_Y + 1;
  ctx.fillRect(Math.round(x), L.STAFF_TOP_Y, 1, h, 1);
}

/* ---- Noteheads ---------------------------------------------------------- */
/*
 * A 5x5 ring, used both for a notehead you hit and for the marker showing
 * where you actually played. Deliberately the same glyph: play in time and
 * the two land on top of each other as one mark; play late and you see two,
 * and the gap between them is your error, read straight off the chart.
 *
 * Authored as rows and blitted as runs rather than using the host's
 * draw_circle — that is draw_arc underneath, and the desktop test buffer
 * would have to reproduce its rasterisation exactly or the rendering tests
 * would be asserting a shape the Move never draws.
 */
/* Where a pad actually went down: same ring, placed at the true time. */
export function drawPlayedMarker(ctx, x, y) {
  drawRing(ctx, Math.round(x), y);
}

/*
 * One notehead.
 *
 *   head    'note' | 'x' | 'circled-x'   which drum it is
 *   state   'pending' | 'hit' | 'missed' how it went
 *
 * The two are orthogonal and both have to survive: a missed crash must still
 * read as a crash, or the feedback names the wrong drum. So the HEAD says
 * which voice and the STATE modifies it — a hit opens into a ring, a miss
 * gets struck through — rather than the state replacing the glyph.
 */
export function drawNote(ctx, x, y, head, state, dyn = 'normal', spacingPx = undefined) {
  const cx = Math.round(x);
  if (state === 'hit') {
    drawRing(ctx, cx, y);
    if (head === 'x' || head === 'circled-x') {
      /* A hit cymbal keeps a dot of its x inside the ring, so the ring does
       * not turn every voice into the same anonymous circle. */
      ctx.fillRect(cx, y, 1, 1, 1);
    }
    return;
  }

  const w = headWidth(dyn, spacingPx);
  if (head === 'x' || head === 'circled-x') {
    drawX(ctx, cx, y, w);
  } else {
    ctx.fillRect(cx - (w >> 1), y - (L.HEAD_H >> 1), w, L.HEAD_H, 1);
  }
  if (head === 'circled-x' && w >= L.HEAD_W) {
    blit(ctx, CIRCLE_RUNS, cx - L.CIRCLED_R, y - L.CIRCLED_R);
  }

  if (state === 'missed') {
    /* Struck through rather than replaced, so a missed crash is still
     * legibly a crash. */
    const r = L.HEAD_MISS >> 1;
    ctx.line(cx - r - 1, y + r + 1, cx + r + 1, y - r - 1, 1);
  }
}

/* ---- Dynamics ----------------------------------------------------------- */
/*
 * How wide a head is: one step per dynamic, one size smaller when the notes
 * are close together. See the note in layout.mjs for why the dynamic is
 * carried by weight rather than by an engraved `>` and parentheses.
 *
 * Never below 1, so a ghost note in a tight bar is still a mark on the page
 * and not an absence — the player has to be able to see that they are being
 * asked for something quiet, not for nothing.
 */
export function headWidth(dyn, spacingPx) {
  const base = spacingPx !== undefined && spacingPx < L.TIGHT_SPACING_PX
    ? L.HEAD_W_TIGHT : L.HEAD_W;
  const step = dyn === 'accent' ? L.HEAD_STEP : dyn === 'ghost' ? -L.HEAD_STEP : 0;
  return Math.max(1, base + step);
}

/* ---- Ledgers ------------------------------------------------------------ */
export function drawLedgers(ctx, x, y) {
  const cx = Math.round(x);
  const ys = ledgerYs(y);
  for (let i = 0; i < ys.length; i++) {
    const ly = ys[i];
    if (ly < L.STAFF_AREA_TOP_Y || ly > L.STAFF_AREA_BOTTOM_Y) continue;
    ctx.fillRect(cx - (L.LEDGER_W >> 1), ly, L.LEDGER_W, 1, 1);
  }
}

/* ---- Stems and beams ---------------------------------------------------- */
/*
 * Stems up are hands, stems down are feet — which is how a drum chart is
 * engraved, and free: the reader learns which limb plays what with no legend.
 * A stack with both (a kick under a hi-hat) draws both, meeting at the heads.
 */
export function beamY(up, index) {
  return up ? L.STEM_UP_Y + index * L.BEAM_GAP
            : L.STEM_DOWN_Y - index * L.BEAM_GAP - L.BEAM_H + 1;
}

export function drawStem(ctx, x, fromY, up, headW = L.HEAD_W, beamed = true) {
  const cx = Math.round(x);
  const toBeam = up ? beamY(true, 0) + L.BEAM_H - 1 : beamY(false, 0) - L.BEAM_H + 1;
  const plain = up ? fromY - L.STEM_PLAIN_LEN : fromY + L.STEM_PLAIN_LEN;
  /* A beamed note's stem has to reach the beam; an unbeamed one stops at its
   * own length, and never runs PAST where a beam would be. */
  const to = beamed ? toBeam : (up ? Math.max(toBeam, plain) : Math.min(toBeam, plain));
  /* The stem meets the head at its EDGE, not its centre, as engraved — so it
   * has to follow the head's width, which varies with the dynamic and with
   * how much room the bar has. */
  const side = Math.max(1, headW >> 1);
  const head = up ? fromY - 1 : fromY + 1;
  const y0 = Math.min(head, to);
  const y1 = Math.max(head, to);
  ctx.fillRect(up ? cx + side : cx - side, y0, 1, y1 - y0 + 1, 1);
}

export function drawBeam(ctx, x0, x1, up, count) {
  const a = Math.round(Math.min(x0, x1));
  const b = Math.round(Math.max(x0, x1));
  const w = Math.max(1, b - a + 1);
  for (let i = 0; i < count; i++) {
    ctx.fillRect(a + (up ? 2 : -2), beamY(up, i), w, L.BEAM_H, 1);
  }
}

/* ---- A whole stack ------------------------------------------------------ */
/*
 * `item` is { entry, x } from scoring.visibleEntries. Every voice in the
 * stack is drawn at its own height with its own head and its own state, so a
 * kick you hit and a hat you missed appear as a ring and a struck-through x
 * in the same column — which is far more use than one verdict on the pair.
 */
export function drawStack(ctx, item, opts = {}) {
  const { entry, x } = item;
  if (x < L.DESPAWN_X || x >= L.SCREEN_W) return;
  const spacing = opts.spacingPx;

  /*
   * A stem joins every notehead in the stack that shares its direction, so it
   * runs from the note FURTHEST from the beam — the lowest hand, the highest
   * foot. Drawing it from the nearest one instead leaves the rest of the
   * stack floating unattached, which reads as separate notes that happen to
   * line up rather than as one simultaneous hit.
   */
  let anyUp = false;
  let anyDown = false;
  let upFromY = -Infinity;   /* lowest hand note   */
  let downFromY = Infinity;  /* highest foot note  */
  let topY = Infinity;
  let bottomY = -Infinity;
  let widest = L.HEAD_W_TIGHT;

  for (let i = 0; i < entry.notes.length; i++) {
    const note = entry.notes[i];
    const v = voiceById(note.voice);
    if (!v) continue;
    const y = diatonicToY(v.diatonic);
    if (y < topY) topY = y;
    if (y > bottomY) bottomY = y;
    if (v.stem === 'up') {
      anyUp = true;
      if (y > upFromY) upFromY = y;
    } else {
      anyDown = true;
      if (y < downFromY) downFromY = y;
    }

    drawLedgers(ctx, x, y);
    const dyn = opts.dynamics === false ? 'normal' : note.wantDyn;
    const w = headWidth(dyn, spacing);
    if (w > widest) widest = w;
    drawNote(ctx, x, y, v.head, note.state, dyn, spacing);
  }

  if (topY === Infinity) return;
  /* A stack with only feet still gets an up-stem's worth of rhythm, because
   * the beams live on one side and a bar of kick-only sixteenths has to show
   * its rhythm somewhere. */
  const beamed = opts.beams > 0;
  /* A feet-only stack still gets an up-stem's worth of rhythm when it is
   * beamed: the beams live above the staff, and a bar of kick-only sixteenths
   * has to show its rhythm somewhere. */
  if (anyUp) drawStem(ctx, x, upFromY, true, widest, beamed);
  else if (!anyDown) drawStem(ctx, x, topY, true, widest, beamed);
  else if (beamed) drawStem(ctx, x, topY, true, widest, true);
  if (anyDown) drawStem(ctx, x, downFromY, false, widest, false);
}

/*
 * Beams for the visible run. Drawn in a second pass, after every stack, so a
 * beam is never painted over by a notehead that comes later in the list.
 *
 * `visible` is the array from scoring.visibleEntries and `entries` the run's
 * full list — the group a note belongs to can begin off the left edge, and
 * asking the full list is what keeps a beam from breaking at the screen edge.
 */
export function drawBeams(ctx, visible, entries, gb) {
  for (let k = 0; k < visible.length; k++) {
    const { index, x } = visible[k];
    const up = true;
    const n = B.beamsAt(entries, index, gb);
    if (n === 0) continue;

    const join = B.beamsBetween(entries, index, gb);
    if (join > 0) {
      const next = visible[k + 1];
      /* The neighbour may be off the right edge; project to it anyway so the
       * beam runs off the screen rather than stopping short of it. */
      const nx = next ? next.x : x + 24;
      drawBeam(ctx, x, nx, up, join);
    }
    const prev = B.beamsBetween(entries, index - 1, gb);
    const outer = n - Math.max(join, prev);
    if (outer > 0) {
      /* The extra beams this note has and its neighbours do not — the second
       * beam of the sixteenth in a dotted-eighth pair. */
      for (let i = Math.max(join, prev); i < n; i++) {
        ctx.fillRect(Math.round(x) + 2, beamY(up, i), L.BEAM_STUB_W, L.BEAM_H, 1);
      }
    }
  }
}

/* ---- Sticking lane ------------------------------------------------------ */
/*
 * R and L under the notes, in the lane the pitched module fills with note
 * names. `ok` false draws it in a box — the stroke you played with the wrong
 * hand, marked where you can see it against what was asked for.
 */
export function drawSticking(ctx, x, hand, ok = true, limitPx = 12) {
  if (!hand) return;
  const w = ctx.textWidth(hand);
  if (w > limitPx) return;
  const cx = Math.round(x) - (w >> 1);
  ctx.text(cx, L.UNDER_LANE_Y, hand, 1);
  if (!ok) ctx.drawRect(cx - 2, L.UNDER_LANE_Y - 1, w + 4, L.TEXT_H, 1);
}

export { sortVoices };

/* ---- Big numbers -------------------------------------------------------- */
/*
 * The result screens lead with one number — a tempo, a sigma — and it has to
 * be readable from a music stand rather than from six inches away. The host
 * font has one size, so the digits are drawn as scaled blocks.
 *
 * Digits and a few marks only. Anything needing letters is small text.
 */
const BIG_ROWS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['..#', '..#', '..#', '..#', '..#'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['...', '...', '...', '...', '..#'],
  ' ': ['...', '...', '...', '...', '...'],
};
const BIG_W = 3;
const BIG_H = 5;
const BIG_GAP = 1;

export function bigTextWidth(text, scale) {
  if (!text.length) return 0;
  return text.length * BIG_W * scale + (text.length - 1) * BIG_GAP * scale;
}

export function drawBigText(ctx, x, y, text, scale) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const rows = BIG_ROWS[text[i]];
    if (rows) {
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          if (rows[r][c] === '#') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale, 1);
        }
      }
    }
    cx += (BIG_W + BIG_GAP) * scale;
  }
}
