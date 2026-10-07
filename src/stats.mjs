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
/* ~200 records is about 14KB. The file cannot be allowed to grow without
 * bound on a device whose storage nobody is watching. */
export const MAX_RECORDS = 200;

export function drillId(kind, id, opts = {}) {
  const parts = [kind, id];
  if (opts.strictness) parts.push(opts.strictness);
  if (opts.sticking && opts.sticking !== 'off') parts.push(opts.sticking);
  return parts.join(':');
}

const STRICTNESS = ['loose', 'normal', 'tight'];
const KIND_PREFIX = { ladder: 'Ladder: ', clock: 'Clock: ' };

/*
 * What the Progress screen calls a drill: "Rock backbeat L2",
 * "Ladder: Single paradiddle tight", "Guess: drum".
 *
 * It used to be the id's second segment and nothing else, so a groove's levels,
 * its strictness variants and every quiz of one kind collapsed onto the same
 * words — three different histories, one label, no way to tell which plot was
 * which. `names` maps a chart id, or a quiz id, to what the list calls it.
 *
 * The chart id itself may hold a colon (a level projection is "<id>:l2"), so
 * the strictness — always recorded — marks where it ends.
 */
export function drillLabel(id, names = {}) {
  const str = String(id);
  if (names[str]) return names[str];
  const parts = str.split(':');
  const kind = parts[0];
  if (!(kind in KIND_PREFIX) && kind !== 'drill') return parts.length > 1 ? parts.slice(1).join(' ') : str;
  const rest = parts.slice(1);
  let end = rest.findIndex((p) => STRICTNESS.includes(p));
  if (end < 0) end = rest.length;
  const chartId = rest.slice(0, end).join(':');
  const level = /:l(\d)$/.exec(chartId);
  const base = level ? chartId.slice(0, -level[0].length) : chartId;
  let label = (KIND_PREFIX[kind] || '') + (names[base] || base) + (level ? ` L${level[1]}` : '');
  const strict = rest[end];
  if (strict && strict !== 'normal') label += ` ${strict}`;
  return label;
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
 */
export function makeRecord({ drill, bpm, sd = 0, mean = 0, n = 0, err = 0, at = 0 }) {
  return {
    t: Math.round(at),
    d: drill,
    bpm: Math.round(bpm),
    sd: Math.round(sd * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    n: Math.round(n),
    err: Math.round(err),
  };
}

export function emptyStats() {
  return { version: STATS_VERSION, records: [] };
}

export function addRecord(stats, rec, cap = MAX_RECORDS) {
  stats.records.push(rec);
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
    records.push({
      t: Number.isFinite(r.t) ? r.t : 0,
      d: r.d,
      bpm: r.bpm,
      sd: Number.isFinite(r.sd) ? r.sd : 0,
      mean: Number.isFinite(r.mean) ? r.mean : 0,
      n: Number.isFinite(r.n) ? r.n : 0,
      err: Number.isFinite(r.err) ? r.err : 0,
    });
  }
  return { version: STATS_VERSION, records };
}

export function serialiseStats(stats) {
  return JSON.stringify({ version: STATS_VERSION, records: stats.records });
}

export function forDrill(stats, id) {
  const out = [];
  for (const r of stats.records) if (r.d === id) out.push(r);
  return out;
}

export function drillsWithHistory(stats) {
  const seen = [];
  for (const r of stats.records) if (!seen.includes(r.d)) seen.push(r.d);
  return seen;
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
export function isPersonalBest(stats, rec) {
  const prev = forDrill(stats, rec.d);
  const kind = String(rec.d).split(':')[0];
  const bySpread = kind === 'drill' || kind === 'clock';
  for (const r of prev) {
    if (r === rec) continue;
    if (bySpread ? (r.bpm >= rec.bpm && r.sd <= rec.sd) : r.bpm >= rec.bpm) return false;
  }
  return true;
}

/*
 * A sparkline of recent tempos, as [x, y] pairs inside a w x h box.
 *
 * The y scale spans the series' own min and max rather than starting at zero:
 * every tempo in a drill's history sits in a narrow band near the top, and a
 * zero-based axis would flatten a month of progress into one straight line.
 */
export function sparkline(records, w, h, limit = 40) {
  const recs = records.slice(-limit);
  if (recs.length === 0) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of recs) {
    if (r.bpm < lo) lo = r.bpm;
    if (r.bpm > hi) hi = r.bpm;
  }
  const span = hi - lo || 1;
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const x = recs.length === 1 ? 0 : Math.round((i / (recs.length - 1)) * (w - 1));
    const y = h - 1 - Math.round(((recs[i].bpm - lo) / span) * (h - 1));
    out.push([x, y]);
  }
  return out;
}
