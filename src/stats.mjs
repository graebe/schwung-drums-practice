// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * stats.mjs — the recorded history, and the plots made from it. Pure.
 *
 * A drummer's progress is not "accuracy went up". It is "I can hold this
 * clean twenty beats per minute faster than last month", so a record is a TOP
 * CLEAN TEMPO for one drill, with the timing spread that earned it.
 *
 * Rates only ever compare WITHIN a drill: holding a paradiddle at 120 is not
 * the same task as holding a samba at 120, so every record carries a drill id
 * and the plot never mixes them.
 */

export const STATS_VERSION = 1;
/*
 * Capped PER DRILL, and in all. The file cannot be allowed to grow without
 * bound on a device whose storage nobody is watching — but a single cap of
 * 200 shared by every drill meant a week on one groove pushed out the history
 * of all the others. 40 takes a drill is a long chart; 2000 records is about
 * 150KB, which is the most there can ever be.
 */
export const PER_DRILL = 40;
export const MAX_RECORDS = 2000;

export function drillId(kind, id, opts = {}) {
  const parts = [kind, id];
  if (opts.strictness) parts.push(opts.strictness);
  if (opts.sticking && opts.sticking !== 'off') parts.push(opts.sticking);
  return parts.join(':');
}

/*
 * A record's drill id read back: { kind, id, strictness, sticking }. The id
 * itself may hold colons (`rock-backbeat:l3`, `subdiv:quarters`), so it is
 * everything between the kind and the first strictness; a quiz round's id
 * (`pick:subdiv:qe`) has no strictness and is the kind and the rest. The
 * one reader of what drillId writes — it used to be parsed in two places,
 * each scanning for a strictness of its own.
 */
export const STRICTNESS = ['loose', 'normal', 'tight'];
export const QUIZ_KINDS = ['guess', 'hear', 'pick'];

export function parseDrillId(d) {
  const parts = String(d).split(':');
  const kind = parts[0];
  if (QUIZ_KINDS.indexOf(kind) >= 0) {
    return { kind, id: parts.slice(1).join(':'), strictness: '', sticking: '' };
  }
  let end = parts.length;
  for (let i = 1; i < parts.length; i++) {
    if (STRICTNESS.indexOf(parts[i]) >= 0) { end = i; break; }
  }
  return {
    kind,
    id: parts.slice(1, end).join(':'),
    strictness: parts[end] || '',
    sticking: parts[end + 1] || '',
  };
}

/*
 * One finished attempt.
 *   t     unix seconds
 *   d     drill id
 *   bpm   the tempo it was held at — the score
 *   sd    timing spread, ms
 *   mean  timing bias, ms
 *   n     hits
 *   err   misses + wrong hands, together — what cost right notes
 *   tot   notes asked, when known, so a take's accuracy can be worked out
 *   cl    1 when the take was clean (progress.mjs)
 *   st    stray hits        } what `err` and the strays were made of, when
 *   sk    wrong hands       } known: a take that failed can be explained
 *   dy    wrong dynamics    } from the record, not only counted
 *   av    soft accents' mean velocity, and `an` the mean they needed
 *   gv    loud ghosts' mean velocity, and `gn` the mean they had to stay under
 *   dp    the dynamics score (progress.mjs dynamicsScore), when judged
 */
export function makeRecord({ drill, bpm, sd = 0, mean = 0, n = 0, err = 0, at = 0, context = null,
  total = 0, clean = false, breakdown = null, dyn = -1 }) {
  const rec = {
    t: Math.round(at),
    d: drill,
    bpm: Math.round(bpm),
    sd: Math.round(sd * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    n: Math.round(n),
    err: Math.round(err),
  };
  if (total > 0) rec.tot = Math.round(total);
  if (clean) rec.cl = 1;
  if (breakdown) {
    rec.st = breakdown.strays;
    rec.sk = breakdown.stickErrors;
    rec.dy = breakdown.dynErrors;
    const a = breakdown.softAccents;
    if (a && a.n > 0) {
      rec.av = Math.round(a.vel / a.n);
      rec.an = Math.round(a.need / a.n);
    }
    const g = breakdown.loudGhosts;
    if (g && g.n > 0) {
      rec.gv = Math.round(g.vel / g.n);
      rec.gn = Math.round(g.need / g.n);
    }
  }
  if (dyn >= 0) rec.dp = Math.round(dyn);
  /*
   * What the take was played WITH: Speed, and whether Guide pads or Study
   * helped. Kept on the record rather than in the drill's id, so one drill
   * keeps one history — but a slow, guided take can still be told apart from
   * an unaided one at full speed.
   */
  if (context) {
    rec.sp = Math.round(context.speed || 100);
    if (context.guide) rec.g = 1;
    if (context.study) rec.s = 1;
  }
  return rec;
}

export function emptyStats() {
  return { version: STATS_VERSION, records: [] };
}

export function addRecord(stats, rec, cap = MAX_RECORDS, perDrill = PER_DRILL) {
  stats.records.push(rec);
  let mine = 0;
  for (let i = 0; i < stats.records.length; i++) if (stats.records[i].d === rec.d) mine++;
  /* The drill's own oldest take goes first, so no other drill pays for it. */
  for (let i = 0; mine > perDrill && i < stats.records.length; i++) {
    if (stats.records[i].d !== rec.d) continue;
    stats.records.splice(i, 1);
    mine--;
    i--;
  }
  if (stats.records.length > cap) stats.records.splice(0, stats.records.length - cap);
  return stats;
}

/*
 * Never throws. A corrupt or truncated file reads as no history, because
 * losing the plot is a great deal better than failing to open the module —
 * and a file written while the power went is exactly the case where you most
 * want to be able to get back in.
 */
export function parseStats(text) {
  if (!text) return emptyStats();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return emptyStats();
  }
  if (!obj || !Array.isArray(obj.records)) return emptyStats();
  const records = [];
  for (const r of obj.records) {
    if (!r || typeof r.d !== 'string') continue;
    if (!Number.isFinite(r.bpm)) continue;
    const rec = {
      t: Number.isFinite(r.t) ? r.t : 0,
      d: r.d,
      bpm: r.bpm,
      sd: Number.isFinite(r.sd) ? r.sd : 0,
      mean: Number.isFinite(r.mean) ? r.mean : 0,
      n: Number.isFinite(r.n) ? r.n : 0,
      err: Number.isFinite(r.err) ? r.err : 0,
    };
    if (Number.isFinite(r.sp)) rec.sp = r.sp;
    if (r.g === 1) rec.g = 1;
    if (r.s === 1) rec.s = 1;
    if (Number.isFinite(r.tot)) rec.tot = r.tot;
    if (r.cl === 1) rec.cl = 1;
    for (const k of ['st', 'sk', 'dy', 'av', 'an']) if (Number.isFinite(r[k])) rec[k] = r[k];
    records.push(rec);
  }
  return { version: STATS_VERSION, records };
}

/* { stats, ok }: `ok` is false when there was nothing to read or it would not
 * parse — which the caller needs to tell apart from an empty history. */
export function readStats(text) {
  if (!text) return { stats: emptyStats(), ok: false };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { stats: emptyStats(), ok: false };
  }
  if (!obj || !Array.isArray(obj.records)) return { stats: emptyStats(), ok: false };
  return { stats: parseStats(text), ok: true };
}

export function serialiseStats(stats) {
  return JSON.stringify({ version: STATS_VERSION, records: stats.records });
}

export function forDrill(stats, id) {
  const out = [];
  for (const r of stats.records) if (r.d === id) out.push(r);
  return out;
}

export function summarise(records) {
  if (!records.length) return { n: 0, best: 0, last: 0, bestSd: 0, lastSd: 0 };
  let best = -Infinity;
  let bestSd = 0;
  for (const r of records) {
    if (r.bpm > best) {
      best = r.bpm;
      bestSd = r.sd;
    }
  }
  const last = records[records.length - 1];
  return { n: records.length, best, last: last.bpm, bestSd, lastSd: last.sd };
}

/*
 * Whether `rec` beats everything before it on the same drill.
 *
 * For a quiz the number is answers per minute and for the Ladder the top clean
 * tempo, so higher is better. A drill or a Clock run is played at the tempo it
 * is written at — the same number every time — so there the score is how TIGHT
 * it was: a best is the smallest spread at that tempo or faster. Judged by
 * tempo alone, the first attempt would have been the only best there could
 * ever be.
 */
/* A spread-judged take needs this many hits to count as a best at all: two
 * tight hits and thirty misses have a spread of almost nothing. */
export const BEST_MIN_HITS = 8;

/*
 * And it has to have COUNTED. A take that was not clean is never a best, and
 * only clean takes are measured against: the tightest spread ever played is
 * no achievement if a sixth of the notes were wrong. It was judged on spread
 * alone, and a failed take read "BEST YET".
 */
export function isPersonalBest(stats, rec) {
  const prev = forDrill(stats, rec.d);
  const kind = String(rec.d).split(':')[0];
  const bySpread = kind === 'drill' || kind === 'clock';
  /* L0 has no spread: its best is the fastest pace, but only of a take that
   * was clean — a fast take full of wrong pads is not a best of anything. */
  const cleanOnly = bySpread || kind === 'untimed';
  if (cleanOnly && rec.cl !== 1) return false;
  if (bySpread && rec.n < BEST_MIN_HITS) return false;
  for (const r of prev) {
    if (r === rec) continue;
    if (cleanOnly && r.cl !== 1) continue;
    /* Tighter only counts when it was not bought with more mistakes. */
    if (bySpread ? (r.bpm >= rec.bpm && r.sd <= rec.sd) || (r.bpm >= rec.bpm && r.err < rec.err)
      : r.bpm >= rec.bpm) return false;
  }
  return true;
}
