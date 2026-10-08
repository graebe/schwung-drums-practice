/*
 * transport.mjs — where the playhead is, and what moves it. Pure.
 *
 *   READY ─Play─▶ RUNNING ◀─Play─▶ PAUSED ─Back─▶ READY ─Back─▶ list
 *
 * This lived in ui.js as a dozen loose variables changed from a dozen places,
 * and that is where the transport's bugs lived too, out of reach of every
 * test: a run started after a result began at its own end, a scrub while
 * paused was undone by the resume after it, a tempo change rebased the clock
 * from the wrong moment. The state is one object here and every move is a
 * function, so each of those is a test now rather than a report from the
 * hardware.
 *
 * THE ONE CLOCK ORIGIN. `startedAt` alone says where beat 0 is, count-in
 * included:
 *
 *     raw beats = (now - startedAt) in beats
 *     songBeats = raw - waitedBeats        (what is drawn)
 *     scoreBeats                            (what is judged; runs on while
 *                                            Study holds the scroll)
 *
 * Every move that puts the playhead somewhere solves `startedAt` for it, from
 * the moment the clock is actually standing at: now while running, the
 * moment it was paused while paused. Measuring from "now" during a pause is
 * the bug the resume then doubled.
 */

import { msToBeats, beatsToMs, applyWait, isBeatEdge } from './chart.mjs';

export const IDLE = 'idle';
export const LISTEN = 'listen';
export const PRACTICE = 'practice';

export function createTransport() {
  return {
    mode: IDLE,
    songBeats: 0,
    prevBeats: 0,
    scoreBeats: 0,
    waitedBeats: 0,
    frozenAt: null,     /* waitedBeats when the current Study freeze began */
    blocked: false,     /* Study is holding the scroll on a note */
    startedAt: 0,
    paused: false,
    pausedAt: 0,
    scrubCue: false,    /* the playhead was moved by the scrub knob */
    /* The run was moved by hand once started, so it is passage practice and
     * not a whole attempt: it is not recorded. */
    scrubbed: false,
  };
}

/* The moment the clock is standing at. */
function base(t, nowMs) {
  return t.paused ? t.pausedAt : nowMs;
}

function placeAt(t, beat) {
  t.songBeats = beat;
  t.prevBeats = beat;
  t.scoreBeats = beat;
  t.waitedBeats = 0;
  t.frozenAt = null;
  t.blocked = false;
}

/*
 * Home: the top of the drill, nothing running. What READY always starts from
 * when it is entered — from a result, from the Ladder, from Back.
 */
export function home(t) {
  placeAt(t, 0);
  t.mode = IDLE;
  t.paused = false;
  t.scrubCue = false;
  t.scrubbed = false;
  return t;
}

/*
 * Start. From the scrubbed bar if the ready screen was scrubbed, else from the
 * top with the count-in. Returns the beat it starts from (0 = the top), which
 * is what the caller seeks the run to.
 */
export function start(t, { mode, nowMs, bpm, countInBeats }) {
  const from = t.songBeats > 0 ? t.songBeats : 0;
  placeAt(t, from > 0 ? from : -countInBeats);
  t.mode = mode;
  t.paused = false;
  t.scrubCue = false;
  t.scrubbed = from > 0;
  t.startedAt = nowMs - beatsToMs(t.songBeats, bpm);
  return from;
}

export function pause(t, nowMs) {
  if (t.paused) return false;
  t.paused = true;
  t.pausedAt = nowMs;
  return true;
}

export function resume(t, nowMs) {
  if (!t.paused) return false;
  /* The time spent stopped never happened. */
  t.startedAt += nowMs - t.pausedAt;
  t.paused = false;
  t.scrubCue = false;
  return true;
}

/*
 * Put the playhead at `beat`. The clock is solved for it from the moment the
 * clock is standing at, so a resume after it carries on from here.
 */
export function seek(t, beat, nowMs, bpm, byHand = true) {
  placeAt(t, beat);
  t.startedAt = base(t, nowMs) - beatsToMs(beat, bpm);
  if (byHand) {
    t.scrubCue = true;
    if (t.mode !== IDLE) t.scrubbed = true;
  }
  return t;
}

/* Switch between Listen and practice in place, from where the playhead is. */
export function switchMode(t, mode, nowMs, bpm) {
  t.mode = mode;
  const at = Math.max(0, t.songBeats);
  placeAt(t, at);
  t.startedAt = base(t, nowMs) - beatsToMs(at, bpm);
  /* Practice taken up part way through is passage practice. */
  if (mode === PRACTICE && at > 0) t.scrubbed = true;
  return at;
}

/*
 * The tempo changed under a running clock (the Ladder climbs). The raw clock
 * is songBeats PLUS whatever Study held it for, so that is what is rebased;
 * rebasing songBeats alone would subtract the wait twice and jump back.
 */
export function rebaseTempo(t, nowMs, bpm) {
  t.startedAt = base(t, nowMs) - beatsToMs(t.songBeats + t.waitedBeats, bpm);
  return t;
}

/*
 * One tick of the running clock. `blockBeat` is the beat Study is holding at
 * (null when Study is off or nothing blocks). Returns true on the frame a new
 * beat starts.
 */
export function advance(t, nowMs, bpm, study, blockBeat) {
  if (t.paused) return false;
  const raw = msToBeats(nowMs - t.startedAt, bpm);
  t.prevBeats = t.songBeats;
  if (study) {
    const r = applyWait(raw, t.waitedBeats, blockBeat, t.frozenAt);
    t.songBeats = r.songBeats;
    t.waitedBeats = r.waitedBeats;
    t.scoreBeats = r.scoreBeats;
    t.frozenAt = r.frozenAt;
    t.blocked = r.blocked;
  } else {
    t.songBeats = raw - t.waitedBeats;
    t.scoreBeats = t.songBeats;
    t.frozenAt = null;
    t.blocked = false;
  }
  return isBeatEdge(t.prevBeats, t.songBeats);
}

/* Whether a press now is part of an attempt: practising, and not paused. */
export function judging(t) {
  return t.mode === PRACTICE && !t.paused;
}
