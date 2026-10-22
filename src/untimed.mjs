// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * untimed.mjs — L0, a groove with no clock. Pure: the caller supplies the time.
 *
 * Every other rung asks two questions at once — which drums, and when — and a
 * groove that is new to the hands fails the second while the first is still
 * being worked out. L0 asks only the first. The bar stands still, a cursor
 * sits on the next stack, and it moves on when that stack is struck. There is
 * as long as you like to look ahead and plan the next one; the tempo is
 * whatever the hands can manage, and the PACE is measured so that the hands
 * can watch themselves get faster.
 *
 * THE RUN IS THE SCORING RUN. scoring.mjs's createRun gives the entries, the
 * notes with their states, the player's touch for judging dynamics, the
 * sticking rule — and the renderers already draw all of it. This module only
 * decides what a press does to it when no clock is involved, so the page shows
 * a ring where a drum was struck and a cross where a stack went wrong in
 * exactly the vocabulary the scroll uses.
 *
 * A STACK IS STRUCK TOGETHER. Kick and hi-hat written on one beat are one
 * event, and stepping them one after the other would teach a flam where a
 * unison is written. So the strokes of a stack must land within `togetherMs`
 * of the first — the Strict setting's good window, 60ms on normal — or the
 * partial stack lapses and is asked for again.
 *
 * AND ONLY THAT STACK. It is judged when its window CLOSES (settle), not on
 * the stroke that completes it: judged on that stroke, every pad pressed at
 * once moved the cursor on — the right drum completed the stack and the rest
 * fell on the next one (the owner's second report from the Move). Now a pad
 * too many inside the window spoils the stack and it is asked for again, so
 * only the drums written there, and nothing else, move the cursor.
 *
 * FIRST TIME RIGHT is the score: a stack struck with no wrong pad, no lapsed
 * partial and no second stroke on the way, with the right hands (when the
 * sticking is strict) and the right dynamics. A wrong hand or a soft accent
 * still moves the cursor on — asking for the stack again would feed the extra
 * strokes into the touch the dynamics are judged against, and punish a mode
 * without time for touch — but the stack is not right first time.
 *
 * A pad fault marks the stack's notes MISSED once it is through, so the page
 * shows it struck out, as Study shows a note it had to wait for: what went
 * wrong is recorded and not taken back.
 */

import { HIT, MISSED, PENDING, STICK_STRICT, judgeStroke, settleEntry,
         ensureEntries } from './scoring.mjs';

/* A gap slower than this many times the take's typical gap is a stop — a
 * look at the page, a breath, a pause — and is left out of the pace. */
export const PAUSE_FACTOR = 3;
/* Gaps needed before a pace is a number rather than an accident. */
export const MIN_GAPS = 3;
/* The header's pace is over the recent stacks only, so it follows a player
 * who speeds up during the take. */
export const LIVE_GAPS = 16;
/* What a press is worth when it is no note of the stack. */
const STRAY = { result: 'stray', wantHand: null, handOk: true, wantDyn: 'normal', dynOk: true };

/*
 * `from` is the first entry to ask for: 0, or where the ready screen was
 * scrubbed to (the caller seeks the run there first, which settles the
 * entries before it as skipped).
 */
export function createUntimed(run, { togetherMs = 60, from = 0 } = {}) {
  const total = run.repeats > 0 ? run.repeats * (run.chart.events || []).length : 0;
  return {
    run,
    togetherMs,
    index: from,
    open: null,          /* { at, spoiled } while a stack's window is open   */
    fault: '',           /* the first pad fault on the current stack         */
    stacks: 0,           /* stacks completed                                  */
    firstTry: 0,         /* ...of which right first time                      */
    total: Math.max(0, total - from),
    causes: { wrong: 0, apart: 0, again: 0, hand: 0,
              accents: { n: 0, vel: 0, need: 0 }, ghosts: { n: 0, vel: 0, need: 0 } },
    gaps: [],            /* [Δbeats, Δms] between completed stacks            */
    lastAt: null,        /* when the last stack sounded; null after a pause   */
    lastBeat: 0,
    pace: 0,             /* bpm over the take, stops left out                 */
    livePace: 0,         /* the same over the last LIVE_GAPS                  */
    finished: total === 0,
  };
}

/* The stack the cursor is on, or null once the take is through. */
export function current(u) {
  return u.finished ? null : u.run.entries[u.index] || null;
}

/*
 * A pad went down. Returns a judgement in the shape led_paint.flashColor
 * reads, or null when the take is already through. It never moves the cursor
 * by itself: settle does, once the stack's window has closed.
 */
export function press(u, { voice, hand = null, velocity = null }, atMs) {
  if (u.finished) return null;
  settle(u, atMs);
  if (u.finished) return null;
  const entry = current(u);
  if (!entry) return null;

  let note = null;
  let inStack = false;
  for (let i = 0; i < entry.notes.length; i++) {
    const n = entry.notes[i];
    if (n.voice !== voice) continue;
    inStack = true;
    if (!n.played) { note = n; break; }
  }
  /* Any stroke opens the window — a wrong one too, so that the right drum a
   * moment later in the same mash is part of the same, spoiled, attempt. */
  if (!u.open) u.open = { at: atMs, spoiled: false };
  if (!note) {
    /* No drum of this stack, or one already struck: the strokes in this
     * window no longer make the stack, and when it closes it is asked for
     * again whole. */
    fault(u, inStack ? 'again' : 'wrong');
    u.open.spoiled = true;
    return { ...STRAY, voice, hand, velocity };
  }

  note.state = HIT;
  note.played = true;
  note.offsetBeats = 0;
  judgeStroke(u.run, note, hand, velocity);

  return {
    result: 'good', voice, hand, velocity,
    wantHand: note.wantHand, handOk: note.handOk,
    wantDyn: note.wantDyn, dynOk: note.dynOk, need: note.need,
  };
}

/*
 * Called every tick, and before every press. Once the window of the stack
 * being struck has closed it is judged: every drum in → the stack is done and
 * the cursor moves on, `{ complete: true }`; some missing → the struck ones
 * are taken back and asked for again, and the stack is no longer right first
 * time, `{ lapsed: [voices] }` for the red flash. Null while the window is
 * open, or nothing is being struck.
 */
export function settle(u, nowMs) {
  if (u.finished || !u.open || nowMs - u.open.at <= u.togetherMs) return null;
  const entry = current(u);
  if (!u.open.spoiled && entry && entry.notes.every((n) => n.played)) {
    complete(u, entry);
    return { complete: true };
  }
  const voices = struckVoices(u);
  if (!u.open.spoiled) fault(u, 'apart');
  resetPartial(u);
  return { lapsed: voices };
}

/*
 * The take was paused. A partial stack is dropped without blame — the pause
 * is not the player's mistake — and the next gap is not measured, so the time
 * spent paused never reaches the pace.
 */
export function pause(u) {
  resetPartial(u);
  u.lastAt = null;
}

/*
 * What the Guide pads light: the stack after this one, then what is left of
 * this one. In that order because in led_paint the last target wins, and a
 * hi-hat in both stacks must light as NOW, not as next.
 */
export function targets(u) {
  const out = [];
  if (u.finished) return out;
  const run = u.run;
  const strict = run.sticking !== 'off';
  const next = run.entries[u.index + 1];
  if (next) {
    for (const n of next.notes) out.push({ voice: n.voice, hand: strict ? n.wantHand : null, beatsAway: 1 });
  }
  const entry = run.entries[u.index];
  if (entry) {
    for (const n of entry.notes) {
      if (!n.played) out.push({ voice: n.voice, hand: strict ? n.wantHand : null, beatsAway: 0 });
    }
  }
  return out;
}

/* How far through the take, 0..1. */
export function progress(u) {
  if (u.finished) return 1;
  return u.total > 0 ? Math.min(1, u.stacks / u.total) : 0;
}

/* What the verdict is reached on (progress.mjs untimedVerdictOf). */
export function counts(u) {
  const c = u.causes;
  return {
    stacks: u.stacks,
    firstTry: u.firstTry,
    wrong: c.wrong,
    apart: c.apart,
    again: c.again,
    hand: c.hand,
    softAccents: { ...c.accents },
    loudGhosts: { ...c.ghosts },
    pace: u.pace,
  };
}

/*
 * The pace of a list of gaps, in beats per minute: how many beats of the
 * groove you get through in a minute, with the stops left out.
 *
 * Each gap is measured as time per BEAT, not per stack, so a groove's rhythm
 * cannot skew it — a sixteenth after an eighth is a short gap and is meant to
 * be. A gap slower than PAUSE_FACTOR times the median is a stop and is
 * dropped; what is left is summed rather than averaged, so long and short
 * gaps weigh what they last.
 */
export function paceOf(gaps) {
  const rates = [];
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i][0] > 0 && gaps[i][1] >= 1) rates.push(gaps[i][1] / gaps[i][0]);
  }
  if (rates.length < MIN_GAPS) return 0;
  const sorted = rates.slice().sort((a, b) => a - b);
  const m = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  let beats = 0;
  let ms = 0;
  let kept = 0;
  for (let i = 0; i < gaps.length; i++) {
    const [db, dm] = gaps[i];
    if (!(db > 0 && dm >= 1)) continue;
    if (dm / db > PAUSE_FACTOR * median) continue;
    beats += db;
    ms += dm;
    kept++;
  }
  if (kept < MIN_GAPS || ms <= 0) return 0;
  return (60000 * beats) / ms;
}

/* ---- inside ---------------------------------------------------------------- */

function fault(u, kind) {
  if (!u.fault) u.fault = kind;
}

function struckVoices(u) {
  const entry = current(u);
  const out = [];
  if (!entry) return out;
  for (const n of entry.notes) if (n.played) out.push(n.voice);
  return out;
}

/* Put a partly struck stack back as it was before its first stroke. */
function resetPartial(u) {
  u.open = null;
  const entry = current(u);
  if (!entry) return;
  for (const n of entry.notes) {
    if (!n.played) continue;
    n.state = PENDING;
    n.played = false;
    n.velocity = null;
    n.need = 0;
    n.handOk = true;
    n.dynOk = true;
  }
}

function complete(u, entry) {
  const run = u.run;
  let handOk = true;
  let soft = null;
  let loud = null;
  for (const n of entry.notes) {
    if (!n.handOk && run.sticking === STICK_STRICT) handOk = false;
    if (!n.dynOk) {
      const d = n.wantDyn === 'accent' ? (soft = soft || { n: 0, vel: 0, need: 0 })
        : (loud = loud || { n: 0, vel: 0, need: 0 });
      d.n++;
      d.vel += n.velocity || 0;
      d.need += n.need;
    }
  }

  const c = u.causes;
  if (u.fault) {
    c[u.fault]++;
    for (const n of entry.notes) n.state = MISSED;
  } else if (!handOk) {
    c.hand++;
  } else if (soft || loud) {
    for (const [d, into] of [[soft, c.accents], [loud, c.ghosts]]) {
      if (!d) continue;
      into.n += d.n;
      into.vel += d.vel;
      into.need += d.need;
    }
  } else {
    u.firstTry++;
  }
  u.stacks++;
  settleEntry(entry);

  /* The stack sounded when its first stroke landed: that is its moment. */
  const at = u.open ? u.open.at : u.lastAt;
  if (u.lastAt !== null && at !== null) {
    u.gaps.push([entry.beat - u.lastBeat, at - u.lastAt]);
    u.pace = paceOf(u.gaps);
    u.livePace = paceOf(u.gaps.slice(-LIVE_GAPS));
  }
  u.lastAt = at;
  u.lastBeat = entry.beat;
  u.open = null;
  u.fault = '';

  u.index++;
  run.cursor = u.index;
  run.waitCursor = u.index;
  ensureEntries(run, entry.beat);
  u.finished = u.index >= run.entries.length && (run.repeats === 0 || run.iters >= run.repeats);
}
