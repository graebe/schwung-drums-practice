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
 * One finished attempt.
 *   t     unix seconds
 *   d     drill id
 *   bpm   the tempo it was held at — the score
 *   sd    timing spread, ms
 *   mean  timing bias, ms
 *   n     hits
 *   err   misses + sticking + dynamic errors, together
 *   tot   notes asked, when known, so a take's accuracy can be worked out
 *   cl    1 when the take was clean (progress.mjs)
 */
export function makeRecord({ drill, bpm, sd = 0, mean = 0, n = 0, err = 0, at = 0, context = null,
  total = 0, clean = false }) {
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

export function isPersonalBest(stats, rec) {
  const prev = forDrill(stats, rec.d);
  const kind = String(rec.d).split(':')[0];
  const bySpread = kind === 'drill' || kind === 'clock';
  if (bySpread && rec.n < BEST_MIN_HITS) return false;
  for (const r of prev) {
    if (r === rec) continue;
    /* Tighter only counts when it was not bought with more mistakes. */
    if (bySpread ? (r.bpm >= rec.bpm && r.sd <= rec.sd) || (r.bpm >= rec.bpm && r.err < rec.err)
      : r.bpm >= rec.bpm) return false;
  }
  return true;
}
