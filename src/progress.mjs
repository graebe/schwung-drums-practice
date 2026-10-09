/*
 * progress.mjs — how far you have got with every drill. Pure: no host calls.
 *
 * Ported from Piano Practice's progress.mjs and changed where drumming is
 * different. A pianist has learned a piece when they can read it without the
 * lights; a drummer has learned a pattern when they can play it CLEAN AT
 * TEMPO. So an item has one stage, and its number is a speed:
 *
 *   clean take    a whole take, Study off, with at least CLEAN_SHARE of the
 *                 notes right (a wrong hand or a wrong dynamic is not right,
 *                 and stray hits count against you) and the timing spread
 *                 inside the Strict setting's good window
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
 * The share of a take that was right: notes hit with the right hand and the
 * right dynamic, over the notes asked PLUS stray hits. Without the strays a
 * player could sweep the pads under every note and score full marks.
 *   st = scoring.mjs runStats: { total, hits, strays, stickErrors, dynErrors }
 */
export function takeAccuracy(st) {
  const asked = (st.total || 0) + (st.strays || 0);
  const right = Math.max(0, (st.hits || 0) - (st.stickErrors || 0) - (st.dynErrors || 0));
  return asked > 0 ? Math.min(1, right / asked) : 0;
}

/*
 * Whether a take was clean, and if not, the first reason why — so the result
 * screen can say what to fix rather than only that it did not count.
 *   { accuracy, clean, reason }
 */
export function judgeTake(st, sdMs, goodMs) {
  const accuracy = takeAccuracy(st);
  let reason = '';
  if (!st.hits) reason = 'nothing played';
  else if (accuracy < CLEAN_SHARE) {
    reason = `${Math.floor(accuracy * 100)}% right, need ${Math.round(CLEAN_SHARE * 100)}`;
  } else if (sdMs > goodMs) reason = `spread ${Math.round(sdMs)}, max ${Math.round(goodMs)}ms`;
  return { accuracy, clean: reason === '', reason };
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
 *   take = { speed, accuracy, sd, clean, bpm, at (ms) }
 * Returns what it changed, for the result screen:
 *   { learned  first time at LEARNED% clean,
 *     best     the item's best after this take,
 *     before   its best before,
 *     repeat   it was already learned }
 *
 * For an item already learned, only a take AT TEMPO counts as a repetition:
 * playing a learned rudiment slowly is practice, not a slip, and must not
 * pull it back into the queue.
 */
export function recordTake(progress, id, take) {
  const atTempo = take.speed >= LEARNED;
  return apply(progress, id, {
    value: take.clean ? take.speed : null,
    learned: take.clean && atTempo,
    counts: atTempo,
    bpm: take.bpm,
    entry: [Math.round(take.speed), Math.round((take.accuracy || 0) * 100),
      Math.round(take.sd || 0), (take.clean ? F_CLEAN : 0) | (atTempo ? F_TEMPO : 0)],
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
  else if (learned) startRepeats(it, t);

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
 * if you can play everything, you can play the cymbals alone. This is what
 * keeps four rungs a groove from being a chore for someone who can already
 * play it — and it is only a reading, never written into the lower items.
 */
const LEVEL_RE = /:l([1-4])$/;

export function higherLevels(id) {
  const m = LEVEL_RE.exec(id);
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
    const ladder = kind === 'ladder';
    const clean = ladder || (r.err === 0 && r.n >= IMPORT_MIN_HITS && r.sd <= IMPORT_GOOD_MS);
    recordTake(progress, id, {
      speed: speedOf(r.bpm, writtenOf(id, r)),
      accuracy: r.n + r.err > 0 ? r.n / (r.n + r.err) : 0,
      sd: r.sd,
      clean,
      bpm: r.bpm,
      at: r.t * 1000,
    });
  }
  return progress;
}
