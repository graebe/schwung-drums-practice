// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * progress.mjs — how far you have got with every drill. Pure: no host calls.
 *
 * Ported from Piano Practice's progress.mjs and changed where drumming is
 * different. A pianist has learned a piece when they can read it without the
 * lights; a drummer has learned a pattern when they can play it CLEAN AT
 * TEMPO. So an item has one stage, and its number is a speed:
 *
 *   clean take    a whole take with at least CLEAN_SHARE of the notes right
 *                 (a wrong hand or a wrong dynamic is not right, and stray
 *                 hits count against you) and the timing spread inside the
 *                 Strict setting's good window — judged by verdictOf, on the
 *                 standard settings (easedBy): no Study, no Guide pads, not
 *                 Loose, Dynamics on
 *   clean speed   the tempo of a clean take over the drill's written tempo:
 *                 80% is clean at 80% of the written tempo
 *   learned (✓)   clean at LEARNED% or faster
 *
 * The row shows the best clean speed, which never drops: practising slowly
 * is how a drummer gets faster, and it must never read as going backwards.
 * A quiz has no tempo, so its number is the best round's share of right
 * answers, and it is learned at QUIZ_PASS.
 *
 * Every playable row is an ITEM, keyed by the id catalog.mjs stamps on it —
 * the same id wherever the row appears, so a take counts the same from the
 * Learning Path, the Grooves folder or a repetition.
 */

import { LEVEL_ID_RE } from './levels.mjs';

export const PROGRESS_VERSION = 1;
export const CLEAN_SHARE = 0.9;
export const LEARNED = 100;
export const QUIZ_PASS = 90;
/* Takes kept per item for its chart. `best` and `done` are kept whole, so
 * dropping old takes never loses what was reached. */
export const HISTORY_CAP = 24;

const DAY_S = 86400;
/* Days until a learned item comes up for repetition, growing with every
 * repeat at tempo and starting over after a slip. */
export const REP_INTERVALS = [1, 3, 7, 14, 30];
export const REP_SESSION = 5;

/* History flags: [t, percent, accuracy, spread ms, flags]. */
export const F_CLEAN = 1;
export const F_REPEAT = 2;
export const F_TEMPO = 4;
/* Judged by the standard a ✓ means (easedBy). Absent on takes recorded
 * before it existed, which is why it is a flag and not its absence. */
export const F_STANDARD = 8;

/* ---- The store ------------------------------------------------------------ */

export function emptyProgress() {
  /* `rev` is not saved: it moves on every change, so a cache can tell whether
   * what it holds is still true without comparing the whole store. */
  return { version: PROGRESS_VERSION, items: {}, rev: 0 };
}

function emptyItem() {
  return {
    best: 0,       /* best clean speed, or best round, in percent; 0 = none */
    bpm: 0,        /* the tempo the best was played at                      */
    plays: 0,
    t: 0,          /* last take, unix seconds                               */
    done: 0,       /* when it was first learned, or 0                       */
    skip: 0,       /* when you chose to skip it, or 0                       */
    rep: null,     /* { due, step, at, ok } once learned                    */
    h: [],
  };
}

export function item(progress, id) {
  return progress.items[id] || null;
}

function ensure(progress, id) {
  if (!progress.items[id]) progress.items[id] = emptyItem();
  return progress.items[id];
}

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/* { progress, ok }. Never throws: `ok` is false when the text would not read,
 * which the caller needs to tell apart from no progress yet — a damaged file
 * is kept aside rather than overwritten by the next save. */
export function readProgress(text) {
  if (!text) return { progress: emptyProgress(), ok: false };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { progress: emptyProgress(), ok: false };
  }
  if (!obj || typeof obj !== 'object' || !obj.items || typeof obj.items !== 'object') {
    return { progress: emptyProgress(), ok: false };
  }
  const out = emptyProgress();
  for (const id in obj.items) {
    const src = obj.items[id];
    if (!src || typeof src !== 'object') continue;
    const it = emptyItem();
    it.best = num(src.best);
    it.bpm = num(src.bpm);
    it.plays = num(src.plays);
    it.t = num(src.t);
    it.done = num(src.done);
    it.skip = num(src.skip);
    if (src.rep && typeof src.rep === 'object') {
      it.rep = { due: num(src.rep.due), step: num(src.rep.step), at: num(src.rep.at), ok: Boolean(src.rep.ok) };
    }
    if (Array.isArray(src.h)) {
      it.h = src.h.filter((r) => Array.isArray(r) && r.length >= 5
        && typeof r[0] === 'number' && typeof r[1] === 'number').slice(-HISTORY_CAP);
    }
    out.items[id] = it;
  }
  return { progress: out, ok: true };
}

export function serialiseProgress(progress) {
  return JSON.stringify({ version: PROGRESS_VERSION, items: progress.items });
}

/* ---- Judging a take ------------------------------------------------------- */

/*
 * ONE VERDICT. Whether a take, a Ladder rung or an imported record was clean
 * is decided here and nowhere else. It used to be decided in three places with
 * three rules — and a fourth, the stats log's "best", that did not ask at all
 * — and every way the result screen misled sat in a seam between them.
 */

/*
 * The share of a take that was right: notes hit with the right hand and the
 * right dynamic, over the notes asked PLUS stray hits. Without the strays a
 * player could sweep the pads under every note and score full marks.
 *   st = scoring.mjs runStats: { asked, hits, strays, stickErrors, dynErrors }
 */
export function takeAccuracy(st) {
  const asked = (st.asked || 0) + (st.strays || 0);
  const right = Math.max(0, (st.hits || 0) - (st.stickErrors || 0) - (st.dynErrors || 0));
  return asked > 0 ? Math.min(1, right / asked) : 0;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const avg = (d, key) => Math.round(d[key] / d.n);
/* A reason is one result line: 21 characters of the 6px font across 128. */
export const REASON_MAX = 21;
/* The velocities played against needed, when they fit beside the count. */
const withVel = (text, d, sign) => {
  const long = `${text} ${avg(d, 'vel')}${sign}${avg(d, 'need')}`;
  return long.length <= REASON_MAX ? long : text;
};

/*
 * What cost the most right notes, as a cause and a line that says it with
 * its count: "16 soft accents 74<83" says what to practise, "83% right" does
 * not. Ties go to the order below — a missed note before a stray, and so on.
 */
function costliest(st) {
  const acc = st.softAccents || { n: 0 };
  const gho = st.loudGhosts || { n: 0 };
  const causes = [
    ['missed', st.misses || 0, (n) => `${n} missed`],
    ['strays', st.strays || 0, (n) => plural(n, 'stray hit', 'stray hits')],
    ['accents', acc.n, (n) => withVel(plural(n, 'soft accent', 'soft accents'), acc, '<')],
    ['ghosts', gho.n, (n) => withVel(plural(n, 'loud ghost', 'loud ghosts'), gho, '>')],
    ['sticking', st.stickErrors || 0, (n) => plural(n, 'wrong hand', 'wrong hands')],
  ];
  let best = null;
  for (const c of causes) if (c[1] > 0 && (!best || c[1] > best[1])) best = c;
  return best ? { cause: best[0], reason: best[2](best[1]) } : { cause: '', reason: '' };
}

/*
 *   st      runStats, or since() for a window of a run
 *   sdMs    the timing spread over the same notes
 *   rule    { spreadMs, share = CLEAN_SHARE, minHits = 1 }
 *           A take allows CLEAN_SHARE right and the good window's spread. A
 *           Ladder rung is the same verdict, stricter: share 1, perfect window.
 * Returns { accuracy, clean, cause, reason }: `cause` is a key the screen can
 * act on, `reason` the line it shows, both '' when clean.
 */
export function verdictOf(st, sdMs, { spreadMs, share = CLEAN_SHARE, minHits = 1 }) {
  const accuracy = takeAccuracy(st);
  let v = { cause: '', reason: '' };
  if (!st.hits) v = { cause: 'nothing', reason: 'nothing played' };
  else if (st.hits < minHits) v = { cause: 'few', reason: plural(st.hits, 'hit', 'hits') };
  else if (accuracy < share) v = costliest(st);
  else if (sdMs > spreadMs) {
    v = { cause: 'spread', reason: `spread ${Math.round(sdMs)}, max ${Math.round(spreadMs)}ms` };
  }
  return { accuracy, clean: v.cause === '', cause: v.cause, reason: v.reason };
}

/*
 * L0's verdict. A take with no clock has no spread to judge, so it is judged
 * on what it does have: the stacks right FIRST TIME — no wrong pad, no lapsed
 * partial, no second stroke, the right hands and the right dynamics — over
 * every stack, against the same CLEAN_SHARE as a timed take. The pace is
 * measured, not judged: getting faster is what L0 is FOR, and a ✓ that
 * waited on a tempo would be L1's ✓.
 *   c = untimed.mjs counts: { stacks, firstTry, wrong, apart, again, hand,
 *                             softAccents, loudGhosts }
 */
export function untimedVerdictOf(c, { share = CLEAN_SHARE } = {}) {
  const accuracy = c.stacks > 0 ? c.firstTry / c.stacks : 0;
  if (!c.stacks) return { accuracy, clean: false, cause: 'nothing', reason: 'nothing played' };
  if (accuracy >= share) return { accuracy, clean: true, cause: '', reason: '' };
  const acc = c.softAccents || { n: 0 };
  const gho = c.loudGhosts || { n: 0 };
  const causes = [
    ['wrong', c.wrong || 0, (n) => plural(n, 'wrong pad', 'wrong pads')],
    ['apart', c.apart || 0, (n) => `${n} not together`],
    ['again', c.again || 0, (n) => `${n} struck twice`],
    ['accents', acc.n, (n) => withVel(plural(n, 'soft accent', 'soft accents'), acc, '<')],
    ['ghosts', gho.n, (n) => withVel(plural(n, 'loud ghost', 'loud ghosts'), gho, '>')],
    ['sticking', c.hand || 0, (n) => plural(n, 'wrong hand', 'wrong hands')],
  ];
  let best = null;
  for (const k of causes) if (k[1] > 0 && (!best || k[1] > best[1])) best = k;
  return best ? { accuracy, clean: false, cause: best[0], reason: best[2](best[1]) }
    : { accuracy, clean: false, cause: '', reason: '' };
}

/*
 * Whether a take was judged by the standard that a ✓ means: Strict at Normal
 * or Tight, Dynamics on, and no help — Guide pads light the answer and Study
 * waits for you. Easier settings are for getting there; a take on them is
 * kept, but it cannot learn a drill, or a ✓ would mean whatever the settings
 * were that day.
 *   ctx = { strictness, dynamics, guide, study }
 * Returns '' when standard, else the first setting that is not, for the screen.
 */
export function easedBy(ctx) {
  if (ctx.study) return 'Study';
  if (ctx.guide) return 'Guide';
  if (ctx.strictness === 'loose') return 'Loose';
  if (!ctx.dynamics) return 'Dyn off';
  return '';
}

/*
 * The result screen's status line, from the verdict alone. A take that did
 * not count is NOT CLEAN whatever else is true of it: a best spread used to
 * outrank the verdict, and a failed take read "BEST YET" under a big 100. A
 * clean take on eased settings is PRACTICE: it moved nothing (recordTake).
 *   { whole, study, learned, clean, best, eased }
 */
export function takeStatus({ whole, study, learned, clean, best, eased = '' }) {
  if (!whole) return 'not kept';
  if (study) return 'STUDY';
  if (learned) return 'LEARNED';
  if (!clean) return 'NOT CLEAN';
  if (eased) return 'PRACTICE';
  return best ? 'BEST YET' : 'CLEAN';
}

/* The tempo played as a share of the tempo written, in whole percent. */
export function speedOf(playedBpm, writtenBpm) {
  if (!(writtenBpm > 0)) return 100;
  return Math.round((playedBpm * 100) / writtenBpm);
}

/* A quiz round: answers right first time without help, over all attempts. A
 * hinted answer is right but not known, so it counts as wrong here. */
export function roundScore(correct, wrong, hinted = 0) {
  const attempts = correct + wrong;
  if (attempts <= 0) return 0;
  return Math.max(0, Math.round(((correct - hinted) * 100) / attempts));
}

/* ---- Recording ------------------------------------------------------------ */

/*
 * One whole take of a drill.
 *   take = { speed, accuracy, sd, clean, eased, bpm, at (ms) }
 *   eased  '' for standard judging, else what eased it (easedBy)
 * Returns what it changed, for the result screen:
 *   { learned  first time at LEARNED% clean,
 *     best     the item's best after this take,
 *     before   its best before,
 *     repeat   it was already learned }
 *
 * For an item already learned, only a take AT TEMPO counts as a repetition:
 * playing a learned rudiment slowly is practice, not a slip, and must not
 * pull it back into the queue. A take on eased settings is kept for its chart
 * and moves nothing else — not the best, not the ✓, not a repetition, where
 * it would otherwise count as a slip for being "not clean".
 */
export function recordTake(progress, id, take) {
  const atTempo = take.speed >= LEARNED;
  const standard = !take.eased;
  const counted = take.clean && standard;
  return apply(progress, id, {
    value: counted ? take.speed : null,
    learned: counted && atTempo,
    counts: atTempo && standard,
    bpm: take.bpm,
    entry: [Math.round(take.speed), Math.round((take.accuracy || 0) * 100),
      Math.round(take.sd || 0),
      (counted ? F_CLEAN : 0) | (atTempo ? F_TEMPO : 0) | (standard ? F_STANDARD : 0)],
    at: take.at,
  });
}

/*
 * One whole L0 take.
 *   take = { pace, accuracy, clean, eased, bpm, at (ms) }
 *   pace   the pace as a share of the written tempo, in percent
 *
 * It is learned the first time it is clean on the standard settings, at ANY
 * pace — L0 asks whether you know the notes. Its best is the fastest pace of
 * such a take, so the list keeps reading as a speed against the written
 * tempo, like every other row: a share right first time would sit at 100 in
 * a week and could not show anyone getting faster. It never schedules a
 * repetition — repetition asks whether a drill is still clean AT TEMPO, which
 * a take with no clock cannot answer, and the timed rungs carry the groove
 * there.
 */
export function recordUntimed(progress, id, take) {
  const standard = !take.eased;
  const counted = take.clean && standard;
  return apply(progress, id, {
    value: counted ? Math.round(take.pace) : null,
    learned: counted,
    counts: false,
    schedule: false,
    bpm: take.bpm,
    entry: [Math.round(take.pace), Math.round((take.accuracy || 0) * 100), 0,
      (counted ? F_CLEAN : 0) | (standard ? F_STANDARD : 0)],
    at: take.at,
  });
}

/* One finished quiz round. Every round counts: a quiz has no slow version. */
export function recordRound(progress, id, { correct, wrong, hinted = 0, at = 0 }) {
  const score = roundScore(correct, wrong, hinted);
  const pass = score >= QUIZ_PASS;
  return apply(progress, id, {
    value: score,
    learned: pass,
    counts: true,
    bpm: 0,
    entry: [score, score, 0, (pass ? F_CLEAN : 0) | F_TEMPO],
    at,
  });
}

function apply(progress, id, r) {
  const it = ensure(progress, id);
  const t = Math.round((r.at || 0) / 1000);
  const repeat = Boolean(it.done);
  const before = it.best;
  if (r.value !== null && r.value > it.best) {
    it.best = r.value;
    it.bpm = Math.round(r.bpm) || 0;
  }
  let learned = false;
  if (r.learned && !it.done) {
    it.done = t || 1;
    learned = true;
  }
  it.plays++;
  it.t = t;
  /* Playing something you skipped means you are working on it after all. */
  it.skip = 0;
  if (repeat && r.counts) scheduleRepeat(it, r.learned, t);
  else if (learned && r.schedule !== false) startRepeats(it, t);

  const entry = [t].concat(r.entry);
  if (repeat && r.counts) entry[4] |= F_REPEAT;
  it.h.push(entry);
  if (it.h.length > HISTORY_CAP) it.h.splice(0, it.h.length - HISTORY_CAP);
  progress.rev++;
  return { learned, best: it.best, before, repeat };
}

export function skipItem(progress, id, at = 0) {
  const it = ensure(progress, id);
  it.skip = Math.round(at / 1000) || 1;
  progress.rev++;
}

/* ---- Reading an item ------------------------------------------------------ */

/*
 * A groove's levels are projections of one file, each adding voices to the
 * one below, so playing a higher level clean at tempo proves the lower ones:
 * if you can play everything, you can play the cymbals alone — and you know
 * its notes, which is all L0 asks. This is what keeps five rungs a groove
 * from being a chore for someone who can already play it — and it is only a
 * reading, never written into the lower items.
 */
export function higherLevels(id) {
  const m = LEVEL_ID_RE.exec(id);
  if (!m) return [];
  const base = id.slice(0, -m[0].length);
  const out = [];
  for (let n = Number(m[1]) + 1; n <= 4; n++) out.push(`${base}:l${n}`);
  return out;
}

export function isDone(progress, id) {
  const it = progress.items[id];
  if (it && it.done) return true;
  const up = higherLevels(id);
  for (let i = 0; i < up.length; i++) {
    const h = progress.items[up[i]];
    if (h && h.done) return true;
  }
  return false;
}

export const MARK_DONE = 'done';
export const MARK_SKIP = 'skip';
export const MARK_TRIED = 'tried';
export const MARK_NEXT = 'next';

/*
 * What a row shows: a mark and a value.
 *   ✓ 115%   learned, and the best clean speed
 *   ✓        learned through a higher level, never played itself
 *   80%      the best clean speed so far
 *   ○        played, never clean
 *   »        skipped
 */
export function itemMark(progress, id) {
  const it = progress.items[id];
  if (isDone(progress, id)) return MARK_DONE;
  if (!it) return null;
  if (it.skip) return MARK_SKIP;
  if (it.plays && !it.best) return MARK_TRIED;
  return null;
}

export function itemValue(progress, id) {
  const it = progress.items[id];
  return it && it.best ? `${it.best}%` : '';
}

/* ---- Repetition ----------------------------------------------------------- */

function startRepeats(it, t) {
  it.rep = { due: t + REP_INTERVALS[0] * DAY_S, step: 0, at: 0, ok: false };
}

function scheduleRepeat(it, ok, t) {
  if (!it.rep) startRepeats(it, t);
  const step = ok ? Math.min(it.rep.step + 1, REP_INTERVALS.length - 1) : 0;
  it.rep = { due: t + REP_INTERVALS[step] * DAY_S, step, at: t, ok };
}

/* The last repetition of a learned item did not hold up at tempo. */
function slipped(it) {
  return Boolean(it.rep && it.rep.at && !it.rep.ok);
}

function sameDay(a, b) {
  return Math.floor(a / DAY_S) === Math.floor(b / DAY_S);
}

/*
 * Today's routine: learned items that slipped first, oldest slip first, then
 * the ones whose interval has run out, most overdue first — at most `limit`
 * of them. Items repeated at tempo today come back marked `done`, so the
 * list shows what the session has already covered.
 */
export function repetitionSession(progress, atMs, limit = REP_SESSION) {
  const now = Math.round(atMs / 1000);
  const slips = [];
  const due = [];
  const done = [];
  for (const id in progress.items) {
    const it = progress.items[id];
    if (!it.done || !it.rep) continue;
    if (it.rep.at && it.rep.ok && sameDay(it.rep.at, now)) {
      done.push({ id, done: true, at: it.rep.at });
    } else if (slipped(it)) {
      slips.push({ id, done: false, at: it.rep.at });
    } else if (it.rep.due <= now) {
      due.push({ id, done: false, at: it.rep.due });
    }
  }
  slips.sort((a, b) => a.at - b.at);
  due.sort((a, b) => a.at - b.at);
  done.sort((a, b) => a.at - b.at);
  return slips.concat(due).slice(0, limit).concat(done);
}

export function dueCount(session) {
  let n = 0;
  for (let i = 0; i < session.length; i++) if (!session[i].done) n++;
  return n;
}

/* ---- Folders -------------------------------------------------------------- */

/*
 * A folder's progress is how many of its leaves are learned, and finding the
 * leaves is the expensive half: the groove folders are made when first opened
 * and every groove projects its levels. So the leaf ids of a folder are
 * cached by the folder NODE — the tree is built once — and the sums against
 * the store's rev.
 */
export function createAggregator() {
  return { leaves: new Map(), sums: new Map() };
}

export function resetShape(agg) {
  agg.leaves.clear();
  agg.sums.clear();
}

/* A node that holds progress of its own: it has an item id and is no folder. */
export function isTracked(node) {
  return Boolean(node && node.id && !('children' in node));
}

function collectLeaves(node, out, seen) {
  if (!node) return;
  if ('children' in node) {
    if (node.untracked) return;
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) collectLeaves(kids[i], out, seen);
    return;
  }
  if (isTracked(node) && !seen.has(node.id)) {
    seen.add(node.id);
    out.push(node.id);
  }
}

export function leafIds(agg, node) {
  let ids = agg.leaves.get(node);
  if (!ids) {
    ids = [];
    collectLeaves(node, ids, new Set());
    agg.leaves.set(node, ids);
  }
  return ids;
}

/* { count, done, played } over a list of item ids. */
export function summariseIds(progress, ids) {
  let done = 0;
  let played = 0;
  for (let i = 0; i < ids.length; i++) {
    if (isDone(progress, ids[i])) done++;
    const it = progress.items[ids[i]];
    if (it && it.plays) played++;
  }
  return { count: ids.length, done, played };
}

export function folderSummary(agg, progress, node) {
  const hit = agg.sums.get(node);
  if (hit && hit.rev === progress.rev) return hit.summary;
  const summary = summariseIds(progress, leafIds(agg, node));
  agg.sums.set(node, { rev: progress.rev, summary });
  return summary;
}

/* Everything played, most recent first — the Progress screen's list. */
export function recentIds(progress) {
  const ids = Object.keys(progress.items).filter((id) => progress.items[id].plays > 0);
  ids.sort((a, b) => progress.items[b].t - progress.items[a].t);
  return ids;
}

/* ---- Charts --------------------------------------------------------------- */

/*
 * One point per take inside a w x h box, oldest left, on a FIXED scale from
 * `lo` to `hi` percent: an autoscaled axis turns 96 -> 98 into a cliff, and
 * two visits to the same item would draw the same history differently. The
 * line to beat — 100% speed, or the quiz pass mark — comes back as `lineY`.
 */
export function percentSeries(history, w, h, { lo = 40, hi = 140, line = LEARNED } = {}) {
  const use = history.length > HISTORY_CAP ? history.slice(history.length - HISTORY_CAP) : history;
  const lastX = w - 1;
  const lastY = h - 1;
  const yOf = (pct) => Math.round(lastY - ((Math.max(lo, Math.min(hi, pct)) - lo) / (hi - lo)) * lastY);
  const points = use.map((r, i) => ({
    x: use.length === 1 ? lastX : Math.round((i * lastX) / (use.length - 1)),
    y: yOf(r[1]),
    percent: r[1],
    clean: Boolean(r[4] & F_CLEAN),
  }));
  return { points, lineY: yOf(line) };
}

/*
 * When an item was learned, in unix seconds, or 0: its own first ✓, or, for a
 * groove level, the first ✓ of a level above it — the same reading isDone
 * makes, so the overview never counts something the list does not tick.
 */
export function learnedAt(progress, id) {
  let at = 0;
  const own = progress.items[id];
  if (own && own.done) at = own.done;
  const up = higherLevels(id);
  for (let i = 0; i < up.length; i++) {
    const h = progress.items[up[i]];
    if (h && h.done && (!at || h.done < at)) at = h.done;
  }
  return at;
}

/*
 * Drills learned over time, for the overview: a step line rising by one at
 * every ✓. Time runs along x from the first one to `atMs`, and y is scaled to
 * the count reached, so the shape is the story — steady, a burst, a stall.
 * Piano Practice's passTimeline, counting learned drills.
 */
export function learnedTimeline(progress, ids, w, h, atMs) {
  const times = [];
  for (let i = 0; i < ids.length; i++) {
    const t = learnedAt(progress, ids[i]);
    if (t) times.push(t);
  }
  times.sort((a, b) => a - b);
  if (!times.length) return { points: [], total: 0 };
  const t0 = times[0];
  const t1 = Math.max(Math.round(atMs / 1000), times[times.length - 1]);
  const span = Math.max(1, t1 - t0);
  const lastX = w - 1;
  const lastY = h - 1;
  const points = times.map((t, i) => ({
    x: Math.round(((t - t0) / span) * lastX),
    y: Math.round(lastY - ((i + 1) / times.length) * lastY),
  }));
  return { points, total: times.length };
}

/* ---- From the stats log --------------------------------------------------- */

/*
 * The first time progress is opened there is a stats.json from earlier
 * versions with takes in it, and they are worth keeping. A record has no
 * note count, so it is judged by what it does have: a Ladder record is clean
 * by construction, and a drill take is clean when it had no errors, enough
 * hits and a spread inside the normal good window.
 *   itemOf(rec)     the item id a record belongs to, or null to skip it
 *   writtenOf(id, rec)  the written tempo the record's tempo is measured on
 */
export const IMPORT_GOOD_MS = 60;
export const IMPORT_MIN_HITS = 8;

export function importStats(progress, records, itemOf, writtenOf) {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const id = itemOf(r);
    if (!id) continue;
    const kind = String(r.d).split(':')[0];
    if (kind === 'guess' || kind === 'hear' || kind === 'pick') {
      recordRound(progress, id, { correct: r.n, wrong: r.err, at: r.t * 1000 });
      continue;
    }
    if (r.s) continue;  /* a Study take never counted */
    /* The record lumps every error into `err`, so it is read as misses: a
     * take with any error is not clean, which is the most it can say. */
    const v = verdictOf({ hits: r.n, misses: r.err, asked: r.n + r.err }, r.sd,
      { spreadMs: IMPORT_GOOD_MS, share: 1, minHits: IMPORT_MIN_HITS });
    const strictness = String(r.d).split(':')[2];
    recordTake(progress, id, {
      speed: speedOf(r.bpm, writtenOf(id, r)),
      accuracy: v.accuracy,
      sd: r.sd,
      clean: kind === 'ladder' || v.clean,
      eased: easedBy({ strictness, dynamics: true, guide: r.g === 1, study: false }),
      bpm: r.bpm,
      at: r.t * 1000,
    });
  }
  return progress;
}
