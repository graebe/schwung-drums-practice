/*
 * layout.mjs — every screen coordinate the module uses, in one leaf module.
 *
 * A LEAF: it imports nothing, on purpose. Both renderers, the scroll engine
 * and the desktop preview harness read their geometry from here, so the
 * staff can be re-proportioned by editing this file alone and re-running
 * `npm run preview`.
 *
 * Screen is 128x64 and 1-bit: every colour argument is truthy/falsy only.
 *
 *   y 0..6    header (title, tempo, mean, sigma)
 *   y 8       rule
 *   y 10..45  chart area — the staff, or the grid's lanes
 *   y 47      rule
 *   y 48      bar ticks, hanging off the rule
 *   y 49..55  the under lane — bar numbers, or the sticking
 *   y 57..63  the timing bar
 */

export const SCREEN_W = 128;
export const SCREEN_H = 64;

/* ---- Header ------------------------------------------------------------- */
export const HEADER_H = 7;
export const HEADER_RULE_Y = 8;

/* ---- Staff -------------------------------------------------------------- */
/* One diatonic step (line -> adjacent space) is STEP_PX pixels, so a
 * line-to-line gap is 2*STEP_PX. At 2px/step the five lines land on
 * 20,24,28,32,36, which puts the whole nine-voice legend between y16 (crash,
 * on its ledger) and y38 (hi-hat pedal, in the space below). */
export const STEP_PX = 2;
export const STAFF_LINE_GAP = STEP_PX * 2;
export const STAFF_TOP_Y = 20;
export const STAFF_BOTTOM_Y = STAFF_TOP_Y + 4 * STAFF_LINE_GAP;  /* 36 */
export const STAFF_LINE_YS = [20, 24, 28, 32, 36];
export const STAFF_LEFT_X = 13;   /* lines begin where the clef ends */

/* The anchor the diatonic->y mapping is built on: E4 sits on the bottom line.
 * E4 = MIDI 64, diatonic index 4*7 + 2 = 30 (see notation.mjs). */
export const ANCHOR_DIATONIC = 30;
export const ANCHOR_Y = STAFF_BOTTOM_Y;

/* The drawable band. The kit needs 16..38; the slack either side is what
 * stems, beams and accent marks live in. */
export const STAFF_AREA_TOP_Y = 10;
export const STAFF_AREA_BOTTOM_Y = 45;

/* ---- Clef --------------------------------------------------------------- */
/* The percussion clef is two heavy vertical bars, not a glyph — which is
 * lucky, because at this size a drawn one would be a smudge. */
export const CLEF_X = 4;
export const CLEF_W = 2;
export const CLEF_GAP = 3;
export const CLEF_TOP_Y = STAFF_TOP_Y;
export const CLEF_BOTTOM_Y = STAFF_BOTTOM_Y;

/* ---- Scroll ------------------------------------------------------------- */
export const HIT_X = 30;            /* the "now" line                        */
export const SPAWN_X = SCREEN_W;    /* notes enter here                      */
export const DESPAWN_X = 20;        /* ...and vanish shortly before the clef */
/* Where a note the scroll is frozen on is pinned, if its own position would
 * put it off screen. Study mode only. */
export const BLOCKED_MIN_X = 24;
/* Bar lines sit just before their downbeat, as engraved, so they do not cut
 * through the notehead that falls on beat 1. */
export const BAR_OFFSET_PX = -4;
export const HIT_LINE_TOP_Y = 14;
export const HIT_LINE_BOTTOM_Y = 40;

/*
 * 32, not 24. At 24 a bar of sixteenths puts its heads 6px apart, and a 5px
 * head leaves one pixel of gap — a solid grey smear rather than four notes.
 * 32 gives 8px and still shows three beats of lookahead, which is more than
 * anyone reads ahead on a drum chart.
 */
export const PX_PER_BEAT_DEFAULT = 32;
export const PX_PER_BEAT_MIN = 12;
export const PX_PER_BEAT_MAX = 48;

/* ---- Note glyphs -------------------------------------------------------- */
/*
 * Heads are sized by DYNAMIC and by how much room there is.
 *
 * A `>` above the head and parentheses around it are how an accent and a
 * ghost note are engraved, and neither fits here: the nine voices occupy
 * y16..38 in steps of four, so there is no clear row above a notehead to put
 * a mark in, and at sixteenths there is no clear column either. Both marks
 * landed on a staff line or on the voice above.
 *
 * So the dynamic is carried by the WEIGHT of the head instead, which is what
 * it means anyway: a ghost note is lighter and an accent is heavier. Width is
 * the axis with room to spare, and it degrades properly — at any density the
 * three sit one step apart, so they stay distinguishable from each other even
 * when all three have shrunk.
 */
export const HEAD_W = 5;            /* a normal head, when there is room     */
export const HEAD_W_TIGHT = 3;      /* ...and when there is not              */
export const HEAD_H = 3;
export const HEAD_STEP = 2;         /* ghost -> normal -> accent, per step   */
export const TIGHT_SPACING_PX = 9;  /* below this, everything drops a size   */
export const HEAD_MISS = 5;         /* the strike-through                    */
export const RING = 5;              /* hit notehead, and the played marker   */
export const XHEAD = 5;             /* a cymbal's x, XHEAD square            */
export const CIRCLED_R = 3;         /* the ring around a circled-x           */
export const LEDGER_W = 9;
/*
 * Stems and beams. The vertical budget here is the tightest thing in the
 * module and worth spelling out, because it is what caps the notation:
 *
 *   y10..14   up-stem beams   two of them, at 10 and 13
 *   y16..38   the nine voices — crash on its ledger down to the hat pedal
 *   y41..45   down-stem beams two of them, at 44 and 41
 *
 * A THIRD up-beam would land on y16 and strike through the crash, so beams
 * are capped at two. That caps the notation at sixteenths (and sextuplets,
 * which also take two). This is not a regrettable limit: a thirty-second note
 * is under 60ms at any tempo worth practising, which is inside the hit window
 * itself, so the module could not score it even if the screen could draw it.
 */
export const STEM_UP_Y = 10;        /* topmost row of an up-stem's first beam */
export const STEM_DOWN_Y = 45;      /* bottom row of a down-stem's first beam */
export const BEAM_H = 2;
export const BEAM_GAP = 3;
export const MAX_BEAMS = 2;
/* An UNBEAMED note gets a plain stem of its own length instead of one that
 * reaches the beam line. A quarter note whose stem runs all the way up to
 * where a beam would be reads as a beam that failed to draw. */
export const STEM_PLAIN_LEN = 9;
export const BEAM_STUB_W = 4;       /* a lone beamed note gets a stub, not a flag */

/* ---- Grid view ---------------------------------------------------------- */
/* Lanes fill the same band the staff uses, sized to however many voices the
 * chart actually contains — a two-voice rudiment gets tall lanes instead of
 * six empty ones. */
/* The same band the staff uses. It has to hold all NINE voices at the
 * minimum lane height — an imported chart may use the hi-hat pedal even
 * though no pad layout reaches it — and 9 x 4 is exactly 36. */
export const GRID_TOP_Y = 10;
export const GRID_BOTTOM_Y = 45;
export const GRID_LABEL_X = 1;
export const GRID_LEFT_X = 15;      /* where the lanes begin                 */
export const GRID_LANE_H_MIN = 4;
/*
 * 18, not 9. The cap decides how much of the band a drill actually uses, and
 * at 9 the common case wasted it: a three-voice groove drew 27 of the 36 rows
 * and split the other nine into margin above and below, which read as a chart
 * that had failed to fill its frame. At 18 every count from two to nine lands
 * on the band or within a row of it — 2x18, 3x12, 4x9, 6x6 and 9x4 are 36.
 *
 * Height is not empty space: cellWidth() takes the lane's height, so a tall
 * lane draws the 7px disc rather than the 5px one, and drawMarker's tick grows
 * with it. A single lane is the one count that cannot fill the band, and 18 is
 * where it stops — past that its marker would be as tall as a bar line and
 * start competing with the furniture it is supposed to be read against.
 */
export const GRID_LANE_H_MAX = 18;

/* ---- The under lane ----------------------------------------------------- */
/*
 * One band under the chart, and the drill decides what goes in it.
 *
 * A groove has no written hand, so its seven rows used to be reserved and then
 * left blank — a rule across the whole screen dividing nothing from nothing.
 * They now carry the BAR NUMBER, which is what the eye wants while reading and
 * what the header could only say in words.
 *
 * A rudiment keeps its R/L there. The two cannot share the band: at 32px/beat
 * a bar is the whole screen wide, so a bar number has to be clamped to stay
 * visible, and a clamped number sits exactly over the downbeat's hand — the
 * one letter of a paradiddle you least want hidden. The ticks are drawn for
 * both, because a tick costs one row and hangs off the rule.
 */
export const UNDER_RULE_Y = 47;
export const UNDER_TICK_Y = 48;
export const UNDER_TICK_H = 2;
export const UNDER_LANE_Y = 49;

/* ---- Timing bar --------------------------------------------------------- */
/*
 * The one thing on this screen you learn to read. Zero is the centre of the
 * screen, not of a box, so the eye has a fixed landmark it can trust between
 * frames; early is left and late is right, which is the same direction the
 * music scrolls.
 *
 * TIMING_SPAN_MS is the half-width. It is deliberately WIDER than the widest
 * "gone" window (160ms at loose), so a hit never pins silently to the end of
 * the scale and read as merely-bad when it was disastrous.
 */
export const TIMING_BAR_Y = 57;
export const TIMING_BAR_H = 7;
export const TIMING_CENTER_X = SCREEN_W / 2;
export const TIMING_HALF_W = 44;
export const TIMING_SPAN_MS = 200;
export const TIMING_TICK_MS = 50;   /* minor ticks either side of zero       */
export const TIMING_DOTS = 24;      /* how many recent hits the cloud shows  */

/* ---- Text metrics ------------------------------------------------------- */
/*
 * The host font is a 5px glyph on a 6px advance, and a line occupies 7 rows
 * once descenders are counted. TEXT_H is what every band above is measured
 * against, and what the layout audit uses to decide that two lines collide.
 *
 * 21 characters is 126px, so TEXT_MAX_PX is the real limit on any single
 * line: past it the host simply stops plotting and a number goes missing in
 * silence.
 */
export const TEXT_H = 7;
export const TEXT_MAX_PX = SCREEN_W - 2;

/* ---- Summary and result ------------------------------------------------- */
export const RESULT_BIG_Y = 10;
export const RESULT_BIG_SCALE = 3;
export const RESULT_LEFT_X = 3;
export const RESULT_ROW_A_Y = 26;
/* The drill name on the summary. It used to be written as UNDER_LANE_Y - 8,
 * which quietly tied a still screen to the running view's scrolling lane. */
export const SUMMARY_NAME_Y = 41;
export const RESULT_ROW_B_Y = 34;
export const RESULT_PLOT = { x: 3, y: 42, w: SCREEN_W - 6, h: 12 };
/* The per-voice timing table on the summary: one row per voice that played. */
export const VOICE_TABLE_Y = 26;
export const VOICE_TABLE_ROW_H = 7;
export const VOICE_TABLE_MAX_ROWS = 4;

/* ---- Progress ----------------------------------------------------------- */
export const PROGRESS_TITLE_Y = 9;
export const PROGRESS_PLOT = { x: 3, y: 17, w: SCREEN_W - 6, h: 30 };
export const PROGRESS_ROW_Y = 48;

/*
 * The share of a plot's height given to the sigma bars, which grow up from
 * the baseline while the tempo line lives above them. A third leaves the line
 * the two thirds it needs to read as a trend at either box size.
 */
export const PLOT_ERR_FRACTION = 1 / 3;
export const PLOT_ERR_MIN_H = 3;
/*
 * What a full-height sigma bar means, in milliseconds. A fixed ceiling keeps
 * two visits comparable — scaling to the series maximum would redraw the same
 * history differently every time a bad round dropped off the end — and 60ms
 * of spread is already far worse than any drill should get.
 */
export const PLOT_SIGMA_FULL_MS = 60;
