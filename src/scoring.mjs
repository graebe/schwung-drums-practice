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

import { msToBeats, beatsToMs, beatToX, expandEvents, loopBeats, repeatsOf,
         practiceBeats, visibleRange } from './chart.mjs';
import { createTiming, pushOffset, dropFrom } from './timing.mjs';

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
/*
 * Settled by a SEEK rather than by playing or failing to.
 *
 * A scrub has to leave the notes behind the playhead resolved so the cursors
 * can move past them, but they were never offered and must not be scored: a
 * skipped bar is not four misses. It is its own state rather than a reuse of
 * MISSED precisely so it can never reach the counters.
 */
export const SKIPPED = 'skipped';

export const STICK_STRICT = 'strict';
export const STICK_LOOSE = 'loose';
export const STICK_OFF = 'off';

/* See ensureEntries. */
export const MAX_ENTRIES = 4096;

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

/*
 * The dynamic for one voice of a stack.
 *
 * `dyn` may be a string (the whole stack) or a map keyed by voice. It has to
 * allow the map, because the commonest thing in drumming is an accented snare
 * under an UNaccented hi-hat — a backbeat — and a stack-wide dynamic makes
 * that impossible to write. The string form stays for the many drills where
 * every voice in the stack really does share a dynamic.
 */
export function dynFor(event, voice) {
  const d = event && event.dyn;
  if (!d) return 'normal';
  if (typeof d === 'string') return d;
  return d[voice] || 'normal';
}

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
      wantDyn: dynFor(event, voice),
      state: PENDING,
      played: false,
      offsetBeats: 0,
      handOk: true,
      dynOk: true,
    })),
  };
}

/* Undo what judging a note added to the run's counts. */
function unscore(run, note) {
  if (note.state === HIT) {
    run.hits--;
    if (Math.abs(note.offsetBeats) <= run.perfect) run.perfects--;
    if (!note.handOk && run.sticking === STICK_STRICT) run.stickErrors--;
    if (!note.dynOk) run.dynErrors--;
  } else if (note.state === MISSED) {
    run.misses--;
  }
}

/*
 * The tempo changed mid-run (the Ladder climbs). Everything the run derived
 * from the tempo is in beats, so it is worked out again: left alone, a 60ms
 * window set at 80bpm was a 30ms window at 160, and the Ladder failed early
 * on hits it should have counted.
 */
export function setTempo(run, bpm) {
  run.bpm = bpm;
  run.good = msToBeats(run.windows.goodMs, bpm);
  run.perfect = msToBeats(run.windows.perfectMs, bpm);
  run.late = msToBeats(run.windows.lateMs, bpm);
  run.latencyBeats = msToBeats(run.latencyMs, bpm);
  return run;
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
    latencyMs: opts.latencyMs || 0,
    latencyBeats: msToBeats(opts.latencyMs || 0, bpm),
    sticking: opts.sticking || (chart.sticking === undefined ? STICK_OFF : chart.sticking),
    dynamics: opts.dynamics !== false,
    accentVel: opts.accentVel === undefined ? 90 : opts.accentVel,
    ghostVel: opts.ghostVel === undefined ? 45 : opts.ghostVel,
    /*
     * How many times the pattern runs, and therefore where the practice ends.
     * 0 is endless and is only ever set deliberately — by the Ladder and the
     * Clock, which impose their own ending, and by open practice.
     */
    repeats: opts.repeats === undefined ? repeatsOf(chart) : opts.repeats,
    loopBeats: loopBeats(chart),
    endBeat: opts.repeats === 0 ? Infinity
      : (opts.repeats > 0 ? opts.repeats * loopBeats(chart) : practiceBeats(chart)),
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
  if (run.repeats === 1) {
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
  /*
   * MAX_ENTRIES is a backstop, not a limit anyone should reach: pruning keeps
   * a real session far below it. It is here because this is the only loop in
   * the module whose bound comes from the CLOCK rather than from the data,
   * and a clock that went wrong would otherwise allocate until the device
   * died rather than until the module misbehaved.
   */
  /* Never past the end of the practice: `repeats` is what makes a drill
   * finish, and materialising one iteration beyond it would put notes on
   * screen after the summary was due. */
  const cap = run.repeats === 0 ? Infinity : run.repeats;
  while (run.iters < cap && run.iters * run.loopBeats < horizon
         && run.entries.length < MAX_ENTRIES) {
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
 * `hit` is { voice, hand, velocity }. `rawBeats` is the judge's clock, which
 * keeps real time; `displayRaw` is the scroll's, which Study freezes on a
 * note. They are the same number whenever nothing is frozen.
 *
 * WHILE FROZEN, THE FROZEN NOTE OWNS THE PRESS (Piano Practice's rule). The
 * judge's clock runs on past the scroll, so on it a later note of the same
 * voice — one the scroll has not reached, and on a drum kit the next snare is
 * rarely far — drifts into the window. Scored as a hit on that unseen note, it
 * left the frozen one unplayed and the scroll stuck: two presses to move on.
 * So the note on the hit line answers its own voice first, and a note past the
 * wait pointer is measured on the clock the player can see: a note the scroll
 * never reached can be neither missed (expireMissed) nor hit.
 */
export function judgeHit(run, hit, rawBeats, displayRaw = rawBeats) {
  const songBeats = rawBeats - run.latencyBeats;
  const displayBeats = displayRaw - run.latencyBeats;
  const { voice, hand } = hit;
  const velocity = hit.velocity;
  if (displayBeats < songBeats - 1e-9) {
    const frozen = judgeFrozen(run, hit, songBeats);
    if (frozen) return frozen;
  }
  let bestEntry = -1;
  let bestNote = -1;
  let bestDist = Infinity;

  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    const dist = entry.beat - (i > run.waitCursor ? displayBeats : songBeats);
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
    const late = releaseLate(run, hit, songBeats);
    if (late) return late;
    run.strays++;
    run.combo = 0;
    run.lastJudgement = {
      result: 'stray', voice, hand, velocity,
      wantHand: null, handOk: true, wantDyn: 'normal', dynOk: true,
      offsetBeats: 0, offsetMs: 0,
    };
    return run.lastJudgement;
  }

  return hitNote(run, hit, bestEntry, bestNote, songBeats);
}

/*
 * The frozen note, if this press is it. Inside the good window it is an
 * ordinary hit, on the honest clock. Past it the note is a miss — exactly what
 * it would have become a moment later when its late window closed — and the
 * press releases it. Null when the press is some other voice, which then goes
 * through the ordinary search like any other.
 */
function judgeFrozen(run, hit, songBeats) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  const entry = run.entries[i];
  for (let n = 0; n < entry.notes.length; n++) {
    const note = entry.notes[n];
    if (note.played || !voiceMatches(note, hit.voice)) continue;
    if (note.state === PENDING) {
      if (Math.abs(songBeats - entry.beat) <= run.good) return hitNote(run, hit, i, n, songBeats);
      note.state = MISSED;
      run.misses++;
      run.combo = 0;
      settleEntry(entry);
      advanceCursor(run);
    }
    return releaseLate(run, hit, songBeats);
  }
  return null;
}

/* Release the frozen note if this press is it: a 'late' judgement, or null. */
function releaseLate(run, hit, songBeats) {
  const released = releaseBlocked(run, hit.voice);
  if (!released) return null;
  run.lastJudgement = {
    result: 'late', voice: hit.voice, hand: hit.hand, velocity: hit.velocity,
    wantHand: null, handOk: true, wantDyn: 'normal', dynOk: true,
    offsetBeats: songBeats - released.beat,
    offsetMs: beatsToMs(songBeats - released.beat, run.bpm),
    entryIndex: released.entryIndex, noteIndex: released.noteIndex,
  };
  return run.lastJudgement;
}

/* Score one note a hit, with its hand and dynamic, and move both cursors on. */
function hitNote(run, hit, entryIndex, noteIndex, songBeats) {
  const { voice, hand, velocity } = hit;
  const entry = run.entries[entryIndex];
  const note = entry.notes[noteIndex];
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
    entryIndex,
    noteIndex,
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
    /*
     * A NOTE THE SCROLL NEVER REACHED CANNOT BE MISSED. This clock is the
     * judge's, which keeps real time while Study holds the scroll on one note
     * — so without this bound the windows of every note BEHIND the freeze
     * close too, and one stall would cross out the next bar before it was
     * ever shown.
     */
    if (waiting && i > run.waitCursor) break;
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
 * The beat the scroll must freeze at in Study mode, or null: the note's OWN
 * beat, so it stops on the hit line where you can see it.
 *
 * It used to be the note plus a grace of at least a beat — the late window had
 * to close before the scroll stopped, because there was one clock and a
 * frozen clock could never reach it. At that offset the note sat left of the
 * despawn edge, so the one note Study was waiting for was the one not drawn.
 * The judge runs on its own clock now (applyWait's scoreBeats), so the freeze
 * can be exactly where the note is.
 */
export function blockingBeat(run) {
  const i = blockingEntry(run);
  if (i < 0) return null;
  return run.entries[i].beat;
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

/*
 * The first materialised entry at or after `beat`, or -1: what plays next from
 * a parked playhead. A scrub lights its pads, so you can see on the grid where
 * you have landed and not only on the chart.
 */
export function nextEntryIndex(run, beat) {
  for (let i = 0; i < run.entries.length; i++) {
    if (run.entries[i].beat >= beat - 1e-9) return i;
  }
  return -1;
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
 * Move the playhead to `beat`, which is NOT the same as moving the clock.
 *
 * Each of these is its own way to look right and behave wrongly, and all five
 * have to happen together:
 *
 *   behind   settles, so both cursors can walk past it — but as SKIPPED, so
 *            a bar you scrubbed over is not counted as a bar you missed
 *   ahead    RE-ARMS, so the bar can be taken again. This is the half that
 *            `resyncWait` does not do: both cursors only ever walk forward
 *            and have to be rewound by hand
 *   markers  from the previous attempt drop, or they would hang in the air
 *            over notes that have not been played yet
 *   cursors  rewind to zero and re-advance, because they cannot go backwards
 *   caller   silences the engine and clears any freeze
 */
export function seekTo(run, beat) {
  for (let i = 0; i < run.entries.length; i++) {
    const entry = run.entries[i];
    const behind = entry.beat < beat;
    /* Re-armed notes are sounded again: Listen skipped any entry it had
     * already played, so its cursor stopped at the first one for good. */
    if (!behind) entry.sounded = false;
    for (let n = 0; n < entry.notes.length; n++) {
      const note = entry.notes[n];
      if (behind) {
        if (note.state === PENDING) note.state = SKIPPED;
        note.played = true;
      } else {
        /* What this note was counted as is taken back before it is played
         * again — otherwise scrubbing back over a bar counted it twice. */
        unscore(run, note);
        note.state = PENDING;
        note.played = false;
        note.offsetBeats = 0;
        note.handOk = true;
        note.dynOk = true;
      }
    }
    settleEntry(entry);
  }
  dropFrom(run.timing, beat);
  run.markers.length = 0;
  run.cursor = 0;
  run.waitCursor = 0;
  advanceCursor(run);
  advanceWaitCursor(run);
  return run;
}

/*
 * Listen mode: the drill plays ITSELF. Returns the entries that have just
 * come due, having settled them so both cursors move past.
 *
 * This has to go through here rather than the caller setting `note.state` by
 * hand, which is what it used to do. `settleEntry` and the cursor walk are
 * private, so without them `entry.state` stayed PENDING for ever: the cursor
 * never left zero, nothing could be pruned — the entry list grew without
 * bound — and `runFinished` could never fire, because it waits for the cursor
 * to reach the end. Listening ran until you stopped it, past the end of the
 * practice, with the header counting bar 11 of 8.
 *
 * Nothing is SCORED here. The notes are marked hit so they open on screen as
 * the drill plays them, but no counter moves: listening is not an attempt.
 */
/* One buffer, reused: this runs on every tick in Listen, at 500Hz, and the
 * caller only walks the result before the next call. */
const due = [];

export function takeDue(run, songBeats) {
  const out = due;
  out.length = 0;
  for (let i = run.cursor; i < run.entries.length; i++) {
    const entry = run.entries[i];
    if (entry.beat > songBeats) break;
    if (entry.sounded) continue;
    entry.sounded = true;
    for (let n = 0; n < entry.notes.length; n++) {
      entry.notes[n].state = HIT;
      entry.notes[n].played = true;
    }
    settleEntry(entry);
    out.push(entry);
  }
  advanceCursor(run);
  advanceWaitCursor(run);
  return out;
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
  let skipped = 0;
  for (let i = 0; i < entry.notes.length; i++) {
    const st = entry.notes[i].state;
    if (st === PENDING) pending++;
    else if (st === MISSED) missed++;
    else if (st === SKIPPED) skipped++;
  }
  if (pending > 0) entry.state = PENDING;
  else if (skipped === entry.notes.length) entry.state = SKIPPED;
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
 * A practice is over once its last repeat has scrolled past and nothing is
 * still pending.
 *
 * This used to begin `if (run.looping) return false`, which meant a drill
 * never finished, never showed a summary and never recorded a score unless
 * the player thought to interrupt it. The file now says how long the practice
 * is, and this is where that length takes effect.
 *
 * `blocked` is true while the scroll is frozen waiting for a note. The freeze
 * holds the drawn clock on the note's own beat while the judging clock runs
 * on past its late window, so without this the summary could pop up over a
 * note you are still being asked to play.
 */
export function runFinished(run, songBeats, blocked = false) {
  if (run.repeats === 0) return false;   /* endless, by request */
  if (blocked) return false;
  /* Every repeat must be materialised before the end can be judged, or a
   * practice would finish as soon as the first pass was scored. */
  if (run.iters < run.repeats) return false;
  if (run.cursor < run.entries.length) return false;
  const last = run.entries[run.entries.length - 1];
  if (!last) return songBeats >= run.endBeat;
  /*
   * The practice runs its DECLARED LENGTH, not merely until the last note.
   * A drill whose figure sits at the top of the bar would otherwise finish
   * three beats early and cut the rests — and the rests are part of the
   * exercise; counting through them is most of what keeping time is.
   */
  return songBeats > Math.max(run.endBeat, last.beat + run.late);
}

/* How far through the practice, 0..1 — for the progress rule. 0 if endless. */
export function runProgress(run, songBeats) {
  if (!Number.isFinite(run.endBeat) || run.endBeat <= 0) return 0;
  return Math.max(0, Math.min(1, songBeats / run.endBeat));
}
