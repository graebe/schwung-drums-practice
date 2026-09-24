/*
 * scoring.mjs — hit windows, sticking, dynamics and run state. Pure: the
 * caller supplies the time.
 *
 * Windows are specified in milliseconds (that is how playing feels) and
 * converted to beats once, at run creation, because everything else in the
 * module thinks in beats.
 *
 * A HIT IS NOT A BOOLEAN. On a drum you can be right about the voice and
 * wrong about everything else, and each of those is fixed by different
 * practice, so each is counted on its own:
 *
 *   timing    how far from the beat        -> the mean and sigma
 *   voice     which drum                   -> hit or miss
 *   hand      which stick                  -> a sticking error
 *   dynamic   accent or ghost              -> a dynamic error
 *
 * Collapsing those into one percentage is what makes most rhythm trainers
 * useless past the first week: "72%" does not tell you what to go and
 * practise. A wrong hand played dead on the beat is a good sign, not a bad
 * one, and it is counted as its own thing so it can be read that way.
 *
 * Simultaneous voices are judged PER VOICE, exactly as a chord was in the
 * pitched module: nail the kick and miss the hat and you get one of each in
 * the same stack, which is far more use than a pass/fail on the pair.
 */

import { msToBeats, beatsToMs, beatToX, expandEvents, loopBeats, visibleRange } from './chart.mjs';
import { createTiming, pushOffset } from './timing.mjs';

/*
 * `normal` is the default and is roughly a semiquaver's worth of slack at a
 * medium tempo. `tight` is a real standard — around where a listener stops
 * hearing two strokes as one — and is punishing until sigma at `normal` is
 * already small. `loose` exists so that a beginner sees rings rather than a
 * screen of crosses; a trainer nobody can play is a trainer nobody uses.
 */
export const WINDOWS = {
  loose:  { perfectMs: 50, goodMs: 100, lateMs: 160 },
  normal: { perfectMs: 30, goodMs: 60,  lateMs: 120 },
  tight:  { perfectMs: 15, goodMs: 35,  lateMs: 80  },
};
export const DEFAULT_STRICTNESS = 'normal';

export const PENDING = 'pending';
export const HIT = 'hit';
export const MISSED = 'missed';

export const STICK_STRICT = 'strict';
export const STICK_LOOSE = 'loose';
export const STICK_OFF = 'off';

/*
 * A note carries two independent facts, and conflating them is the trap here.
 *
 *   state   the scoring outcome: pending -> hit | missed
 *   played  whether the pad ever went down
 *
 * They have to be separate because a note that ran past its window is scored
 * a miss AND the scroll still has to wait for it in Study mode. If waiting
 * keyed off `state`, marking the miss would advance the cursor and there
 * would be nothing left to wait for; if scoring keyed off `played`, a note
 * you eventually fumbled out would count as a clean hit.
 */

function makeEntry(event, iter) {
  const voices = (event.voices || []).slice();
  return {
    beat: event.beat,
    iter,
    event,
    state: PENDING,
    notes: voices.map((voice) => ({
      voice,
      wantHand: event.hand || null,
      wantDyn: event.dyn || 'normal',
      state: PENDING,
      played: false,
      offsetBeats: 0,
      handOk: true,
      dynOk: true,
    })),
  };
}

export function createRun(chart, opts = {}) {
  const windows = { ...(WINDOWS[opts.strictness] || WINDOWS[DEFAULT_STRICTNESS]),
                    ...(opts.windows || {}) };
  const bpm = opts.bpm || chart.bpm || 90;
  const run = {
    chart,
    bpm,
    windows,
    strictness: opts.strictness || DEFAULT_STRICTNESS,
    good: msToBeats(windows.goodMs, bpm),
    perfect: msToBeats(windows.perfectMs, bpm),
    late: msToBeats(windows.lateMs, bpm),
    /*
     * Latency is subtracted from the moment a press is judged at, not added
     * to the note. If a setup is 15ms late everywhere, every offset is 15ms
     * late and the mean is a lie that no amount of practice can fix — so it
     * is corrected once, at the door, and never thought about again.
     */
    latencyBeats: msToBeats(opts.latencyMs || 0, bpm),
    sticking: opts.sticking || (chart.sticking === undefined ? STICK_OFF : chart.sticking),
    dynamics: opts.dynamics !== false,
    accentVel: opts.accentVel === undefined ? 90 : opts.accentVel,
    ghostVel: opts.ghostVel === undefined ? 45 : opts.ghostVel,
    looping: Boolean(opts.looping),
    loopBeats: loopBeats(chart),
    entries: [],
    dropped: 0,      /* entries pruned off the front, for stable numbering   */
    iters: 0,        /* loop iterations materialised so far                  */
    cursor: 0,       /* first entry with a note still unscored               */
    waitCursor: 0,   /* first entry with a note still unplayed               */
    markers: [],     /* { beat, voice, hand } for every press, at its moment */
    timing: createTiming(),
    totalNotes: 0,
    hits: 0,
    perfects: 0,
    misses: 0,
    strays: 0,
    stickErrors: 0,
    dynErrors: 0,
    combo: 0,
    bestCombo: 0,
    lastJudgement: null,
  };
  ensureEntries(run, 0);
  return run;
}

/*
 * Materialise entries out to `uptoBeat`.
 *
 * A loop runs until you stop it, so the entry list cannot be built up front.
 * It is grown an iteration at a time as the playhead approaches, and pruned
 * from behind once resolved, which keeps memory flat however long the session
 * runs — the alternative, expanding some arbitrary number of repeats at the
 * start, is a bug with a timer on it.
 */
export function ensureEntries(run, uptoBeat) {
  if (!run.looping) {
    if (run.iters === 0) {
      appendIteration(run, 0);
      run.iters = 1;
    }
    return run;
  }
  /* run.iters * loopBeats is where the NEXT repeat would begin, i.e. the end
   * of what has been materialised. Stay two loops ahead of the playhead: one
   * is not enough, because the read-ahead can already show the next repeat
   * before the current one has finished scrolling past. */
  const horizon = uptoBeat + run.loopBeats * 2;
  while (run.iters * run.loopBeats < horizon) {
    appendIteration(run, run.iters);
    run.iters++;
  }
  return run;
}

function appendIteration(run, iter) {
  for (const ev of expandEvents(run.chart, iter)) {
    const entry = makeEntry(ev, iter);
    run.totalNotes += entry.notes.length;
    run.entries.push(entry);
  }
}

/*
 * Drop resolved entries that have scrolled off the left edge. Only ever
 * removes entries BEHIND both cursors, so no pointer can be left dangling
 * past the end of the list or pointing at a different note than it did.
 */
export function pruneEntries(run, beforeBeat) {
  let drop = 0;
  const stop = Math.min(run.cursor, run.waitCursor);
  while (drop < stop && run.entries[drop].beat < beforeBeat) drop++;
  if (drop === 0) return 0;
  run.entries.splice(0, drop);
  run.cursor -= drop;
  run.waitCursor -= drop;
  run.dropped += drop;
  return drop;
}

function voiceMatches(note, voice) {
  return note.voice === voice;
}

function handOkFor(run, note, hand) {
  if (run.sticking === STICK_OFF) return true;
  if (!note.wantHand) return true;
  return note.wantHand === hand;
}

function dynOkFor(run, note, velocity) {
  if (!run.dynamics) return true;
  if (velocity === undefined || velocity === null) return true;
  if (note.wantDyn === 'accent') return velocity >= run.accentVel;
  if (note.wantDyn === 'ghost') return velocity <= run.ghostVel;
  return true;
}

/*
 * A pad went down. Finds the nearest unresolved entry holding a matching
 * pending voice within the GOOD window and resolves that one note.
 *
 * `hit` is { voice, hand, velocity }.
 */
export function judgeHit(run, hit, rawBeats) {
  const songBeats = rawBeats - run.latencyBeats;
  const { voice, hand } = hit;
  const velocity = hit.velocity;
  let bestEntry = -1;
  let bestNote = -1;
  let bestDist = Infinity;

  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    const dist = entry.beat - songBeats;
    if (dist > run.good) break; /* everything further out is further out */
    if (Math.abs(dist) > run.good) continue;
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      if (note.state !== PENDING) continue;
      if (!voiceMatches(note, voice)) continue;
      if (Math.abs(dist) < bestDist) {
        bestDist = Math.abs(dist);
        bestEntry = i;
        bestNote = n;
      }
    }
  }

  if (bestEntry < 0) {
    /* Nothing pending matches. Before calling it a stray, check whether this
     * is the note the scroll is frozen on — already scored a miss, but still
     * unplayed. Playing it releases the freeze and scores nothing: the miss
     * was recorded when its window closed and is not taken back. */
    const released = releaseBlocked(run, voice);
    if (released) {
      run.lastJudgement = {
        result: 'late', voice, hand, velocity,
        wantHand: null, handOk: true, wantDyn: 'normal', dynOk: true,
        offsetBeats: songBeats - released.beat,
        offsetMs: beatsToMs(songBeats - released.beat, run.bpm),
        entryIndex: released.entryIndex, noteIndex: released.noteIndex,
      };
      return run.lastJudgement;
    }
    run.strays++;
    run.combo = 0;
    run.lastJudgement = {
      result: 'stray', voice, hand, velocity,
      wantHand: null, handOk: true, wantDyn: 'normal', dynOk: true,
      offsetBeats: 0, offsetMs: 0,
    };
    return run.lastJudgement;
  }

  const entry = run.entries[bestEntry];
  const note = entry.notes[bestNote];
  const offsetBeats = songBeats - entry.beat;
  const offsetMs = beatsToMs(offsetBeats, run.bpm);

  note.state = HIT;
  note.played = true;
  note.offsetBeats = offsetBeats;
  note.handOk = handOkFor(run, note, hand);
  note.dynOk = dynOkFor(run, note, velocity);

  run.hits++;
  run.combo++;
  if (run.combo > run.bestCombo) run.bestCombo = run.combo;
  const perfect = Math.abs(offsetBeats) <= run.perfect;
  if (perfect) run.perfects++;

  /*
   * A sticking error in `loose` is shown and not counted. That is the whole
   * difference between the two modes: the amber still appears, so you learn
   * the stroke you actually played, but the run is not marked down for it
   * while you are still working out the pattern.
   */
  if (!note.handOk && run.sticking === STICK_STRICT) run.stickErrors++;
  if (!note.dynOk) run.dynErrors++;

  pushOffset(run.timing, voice, offsetMs, songBeats);

  settleEntry(entry);
  advanceCursor(run);
  advanceWaitCursor(run);

  run.lastJudgement = {
    result: perfect ? 'perfect' : 'good',
    voice, hand, velocity,
    wantHand: note.wantHand,
    handOk: note.handOk,
    wantDyn: note.wantDyn,
    dynOk: note.dynOk,
    offsetBeats,
    offsetMs,
    entryIndex: bestEntry,
    noteIndex: bestNote,
  };
  return run.lastJudgement;
}

/*
 * Resolve everything whose late window has closed. Call once per frame.
 *
 * `waiting` is the Study setting. When it is off an expired note is also
 * marked played — it is gone for good — so that switching the setting on
 * later cannot find a backlog of ancient unplayed notes to freeze on.
 */
export function expireMissed(run, songBeats, waiting = false) {
  let expired = 0;
  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat + run.late >= songBeats) break;
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      if (note.state !== PENDING) continue;
      note.state = MISSED;
      if (!waiting) note.played = true;
      run.misses++;
      run.combo = 0;
      expired++;
    }
    settleEntry(entry);
  }
  advanceCursor(run);
  advanceWaitCursor(run);
  return expired;
}

/* The first entry still holding an unplayed note, or -1. */
function blockingEntry(run) {
  advanceWaitCursor(run);
  return run.waitCursor < run.entries.length ? run.waitCursor : -1;
}

export function blockingEntryIndex(run) {
  return blockingEntry(run);
}

/*
 * The grace can never be shorter than the late window, or the clock would
 * freeze while the note is still PENDING — and since expireMissed is driven
 * by the clock, the note could never reach its late window and be marked
 * missed, so the only thing that releases the freeze could never happen. A
 * deadlock. Clamping means the note is always already scored by the time the
 * scroll stops for it.
 */
export function effectiveGrace(run, graceBeats) {
  return Math.max(graceBeats, run.late);
}

/* The beat the scroll must freeze at in Study mode, or null. */
export function blockingBeat(run, graceBeats) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  return run.entries[i].beat + effectiveGrace(run, graceBeats);
}

/*
 * The notes the scroll is currently stuck on. One definition, used by both
 * the pad that lights up and the name shown on screen — if those two ever
 * disagreed about which note you are stuck on, the rescue would be worse
 * than no rescue.
 */
export function blockingNotes(run) {
  const i = blockingEntry(run);
  if (i < 0) return [];
  const entry = run.entries[i];
  const out = [];
  for (let n = 0; n < entry.notes.length; n++) {
    if (!entry.notes[n].played) out.push(entry.notes[n]);
  }
  return out;
}

function releaseBlocked(run, voice) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  const entry = run.entries[i];
  for (let n = 0; n < entry.notes.length; n++) {
    const note = entry.notes[n];
    if (note.played) continue;
    /* Only a note already scored a miss may be released this way. A PENDING
     * note outside the good window is an ordinary stray — releasing it would
     * silently swallow the note and rob it of its own judgement. */
    if (note.state !== MISSED) continue;
    if (!voiceMatches(note, voice)) continue;
    note.played = true;
    advanceWaitCursor(run);
    return { beat: entry.beat, entryIndex: i, noteIndex: n };
  }
  return null;
}

/*
 * Bring the wait pointer up to the playhead, marking anything behind it as
 * played. Called when Study is switched on mid-run: without it the pointer
 * would still be parked on a note from minutes ago and the clock would be
 * pinned to a beat in the past, i.e. jump backwards.
 */
export function resyncWait(run, songBeats) {
  for (let i = 0; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat >= songBeats) break;
    for (let n = 0; n < entry.notes.length; n++) entry.notes[n].played = true;
  }
  advanceWaitCursor(run);
}

/* Record a press at the exact moment it happened, for the played markers. */
export function addMarker(run, voice, songBeats, hand = null, limit = 64) {
  run.markers.push({ beat: songBeats, voice, hand });
  if (run.markers.length > limit) run.markers.splice(0, run.markers.length - limit);
}

export function pruneMarkers(run, beforeBeat) {
  let drop = 0;
  while (drop < run.markers.length && run.markers[drop].beat < beforeBeat) drop++;
  if (drop > 0) run.markers.splice(0, drop);
}

/*
 * The entries on screen right now, left to right, each with its x.
 *
 * The RUN is walked, not the chart. Under a loop the chart has no notion of
 * which repeat is on screen, and the renderer needs each note's scoring state
 * anyway — so there is one list, carrying both, and no index to correlate
 * between two of them.
 */
export function visibleEntries(run, songBeats, pxPerBeat) {
  const { fromBeat, toBeat } = visibleRange(songBeats, pxPerBeat);
  const out = [];
  for (let i = 0; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat < fromBeat) continue;
    if (entry.beat > toBeat) break; /* entries are beat-ordered */
    out.push({
      index: i,
      entry,
      beat: entry.beat,
      x: beatToX(entry.beat, songBeats, pxPerBeat),
    });
  }
  return out;
}

function settleEntry(entry) {
  let pending = 0;
  let missed = 0;
  for (let i = 0; i < entry.notes.length; i++) {
    if (entry.notes[i].state === PENDING) pending++;
    else if (entry.notes[i].state === MISSED) missed++;
  }
  if (pending > 0) entry.state = PENDING;
  else if (missed === entry.notes.length) entry.state = MISSED;
  else if (missed > 0) entry.state = 'partial';
  else entry.state = HIT;
}

function advanceCursor(run) {
  while (run.cursor < run.entries.length && run.entries[run.cursor].state !== PENDING) {
    run.cursor++;
  }
}

function entryFullyPlayed(entry) {
  for (let i = 0; i < entry.notes.length; i++) {
    if (!entry.notes[i].played) return false;
  }
  return true;
}

function advanceWaitCursor(run) {
  while (run.waitCursor < run.entries.length && entryFullyPlayed(run.entries[run.waitCursor])) {
    run.waitCursor++;
  }
}

export function runStats(run) {
  const judged = run.hits + run.misses;
  return {
    hits: run.hits,
    perfects: run.perfects,
    misses: run.misses,
    strays: run.strays,
    stickErrors: run.stickErrors,
    dynErrors: run.dynErrors,
    combo: run.combo,
    bestCombo: run.bestCombo,
    total: run.totalNotes,
    accuracy: judged === 0 ? 0 : run.hits / judged,
  };
}

/* A snapshot of the error counters, so a window between two snapshots can be
 * judged clean or not. The Ladder is built on exactly this. */
export function snapshot(run, beat = 0) {
  return {
    beat,
    hits: run.hits,
    misses: run.misses,
    strays: run.strays,
    stickErrors: run.stickErrors,
    dynErrors: run.dynErrors,
  };
}

export function since(run, snap) {
  return {
    bars: 0,
    hits: run.hits - snap.hits,
    misses: run.misses - snap.misses,
    strays: run.strays - snap.strays,
    stickErrors: run.stickErrors - snap.stickErrors,
    dynErrors: run.dynErrors - snap.dynErrors,
  };
}

/*
 * A one-pass run is over once the chart has scrolled past and nothing is
 * pending. A LOOP is never over — it ends when the player stops it, which is
 * the point of a loop.
 *
 * `blocked` is true while the scroll is frozen waiting for a note. Without it
 * the run would report finished mid-freeze: the clock is pinned at
 * beat + grace, which already exceeds beat + late, so the summary would pop
 * up over a note you are still being asked to play.
 */
export function runFinished(run, songBeats, blocked = false) {
  if (run.looping) return false;
  if (blocked) return false;
  if (run.cursor < run.entries.length) return false;
  const last = run.entries[run.entries.length - 1];
  return !last || songBeats > last.beat + run.late;
}
