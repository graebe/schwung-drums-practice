/*
 * controls.mjs — transport colours, the count-in, and where a turn goes.
 * Pure.
 *
 * "Play listens, Record practises": at an instrument, play means play it to
 * me and record means capture what I do. Both pulse when a drill is armed, in
 * their own colours; whichever is running goes solid and the other dims, so
 * the buttons themselves say what state the module is in.
 */

import { LED_OFF } from './padmap.mjs';

export const CC_JOG_CLICK = 3;
export const CC_JOG_TURN = 14;
export const CC_SHIFT = 49;
export const CC_MENU = 50;
export const CC_BACK = 51;
export const CC_PLAY = 85;
export const CC_RECORD = 86;
export const CC_KNOB1 = 71;
export const KNOB_COUNT = 8;

/* Move's pads are notes 68..99; notes below 10 are capacitive knob TOUCH and
 * are not pads at all. Every module that forgets this gets phantom hits the
 * moment someone rests a finger on a knob. */
export const KNOB_TOUCH_MAX = 9;

export const PLAY_COLOR = 126;     /* green  */
export const RECORD_COLOR = 127;   /* red    */
export const DIM = 119;            /* dark grey */

export const MODE_IDLE = 'idle';
export const MODE_LISTEN = 'listen';
export const MODE_PRACTICE = 'practice';

/*
 * The two transport LEDs. `phase` is a 0..1 pulse the caller drives off the
 * clock, so the pulse is a function of time rather than of a counter that
 * could drift.
 */
export function transportColors(mode, armed, phase) {
  const pulse = phase < 0.5;
  if (mode === MODE_LISTEN) return { play: PLAY_COLOR, record: DIM };
  if (mode === MODE_PRACTICE) return { play: DIM, record: RECORD_COLOR };
  if (!armed) return { play: LED_OFF, record: LED_OFF };
  return { play: pulse ? PLAY_COLOR : DIM, record: pulse ? RECORD_COLOR : DIM };
}

/*
 * Where a jog turn goes. It moves the highlight in the list and in settings
 * and does nothing anywhere else — a knock while you are playing must not
 * change what you are playing.
 */
export function jogTarget(screen, editing) {
  if (screen === 'settings') return editing ? 'value' : 'row';
  if (screen === 'menu') return 'menu';
  if (screen === 'levels') return 'level';
  if (screen === 'quiz') return 'choice';
  if (screen === 'progress') return 'drill';
  return 'none';
}

/*
 * The count-in, in beats before zero. Returns the digit to show, or 0 for
 * none — so the drill starts at songBeats 0 however long the count was.
 */
export function countInDigit(songBeats, countIn) {
  if (countIn <= 0 || songBeats >= 0) return 0;
  /*
   * ceil, not floor+1. The digit names the beat you are IN: the window from
   * -3 to -2 is "3", so landing exactly on -3 has to show 3 and not still be
   * showing 4. floor+1 gets every instant right except the beat edges, which
   * are the only instants anyone is looking at.
   */
  return Math.max(1, Math.min(countIn, Math.ceil(-songBeats)));
}

export function countInStart(countIn) {
  /* Not `-Math.max(0, countIn)`: with no count-in that returns NEGATIVE ZERO,
   * which compares unequal to 0 under Object.is and would quietly seed the
   * clock with a value that is not the number it prints as. */
  return countIn > 0 ? -countIn : 0;
}

/*
 * The Clock drill: the click plays for `bars`, then goes silent for `bars`,
 * and you keep the time yourself. Returns true while it is silent.
 *
 * This is the exam. Everything else in the module is played against a
 * metronome, which is a crutch you eventually have to put down; this is the
 * drill that tells you whether you can. Nothing else needs to change to
 * measure it — the chart's beats are still the truth, so the drift shows up
 * as the mean offset over the silent bars, which the timing accumulator is
 * already keeping.
 *
 * The count-in is never muted: a test you cannot start is not a test.
 */
export function clickMuted(songBeats, bars, beatsPerBar) {
  if (!(bars > 0) || songBeats < 0) return false;
  const block = Math.floor(songBeats / (bars * beatsPerBar));
  return block % 2 === 1;
}

/* The beat the current silent stretch began at, or null while it is audible.
 * The drift is measured from there, not from the top of the run. */
export function silenceStart(songBeats, bars, beatsPerBar) {
  if (!clickMuted(songBeats, bars, beatsPerBar)) return null;
  const span = bars * beatsPerBar;
  return Math.floor(songBeats / span) * span;
}

/*
 * Whether the click should sound on this frame, and whether it is a downbeat.
 * `per` is the subdivision: 0 off, 1 on the beat, 2 eighths, 4 sixteenths.
 */
export function clickAt(prevBeats, songBeats, per, beatsPerBar) {
  if (per <= 0) return null;
  const a = Math.floor(prevBeats * per);
  const b = Math.floor(songBeats * per);
  if (a === b) return null;
  /*
   * Ask about the subdivision that was just CROSSED, not about where the
   * frame happens to have landed. A frame arrives a millisecond or two after
   * the crossing, so comparing songBeats to the bar line directly finds it
   * "near" bar one and never exactly on it — and the downbeat never sounds.
   */
  const pos = b / per;
  const onBeat = Math.floor(pos) === pos;
  const atBarStart = onBeat && beatsPerBar > 0 && Math.abs(pos % beatsPerBar) < 1e-6;
  /* A sixteenth that happens to land on bar one is still a sixteenth. The
   * count-in's first beat IS pitched up, which is how you know it started. */
  return { downbeat: atBarStart, onBeat };
}
