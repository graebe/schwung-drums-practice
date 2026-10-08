/*
 * timing.mjs — mean, sigma, and the per-voice breakdown. Pure.
 *
 * Accuracy is the least interesting thing a rhythm trainer can report. Two
 * players at 96% can be nothing alike: one is scattered either side of the
 * beat, the other is tight and eight milliseconds late. The first needs a
 * metronome and the second needs to nudge, and "96%" cannot tell them apart.
 *
 * So every hit's SIGNED error is kept and reduced to two numbers:
 *
 *   mean   where you sit against the beat. NEGATIVE IS EARLY, because the
 *          chart scrolls right-to-left and early is already the left-hand
 *          side of the hit line. One sign convention, used everywhere.
 *   sigma  how consistent you are. This is the number that improves with
 *          practice, and the one worth watching.
 *
 * Population sigma, not sample: these are all the hits there were, not a
 * sample drawn from a larger set, and dividing by n-1 to estimate a
 * population that does not exist would be borrowed rigour.
 *
 * Two horizons are kept at once, because they answer different questions. The
 * RING is the last few hundred hits, which is what the header and the timing
 * bar read — under a loop you want to know how you are playing now, not how
 * you played four minutes ago when you were still finding it. The RUNNING
 * TOTALS are the whole session, which is what the summary reports. Keeping
 * sums rather than every offset means the session figures cost no memory
 * however long you play.
 */

export const DEFAULT_CAP = 256;

export function createTiming(cap = DEFAULT_CAP) {
  return {
    cap,
    ring: [],     /* { voice, offsetMs, beat }, oldest first */
    n: 0,
    sum: 0,
    sumSq: 0,
    min: Infinity,
    max: -Infinity,
    byVoice: {},  /* voice -> { n, sum, sumSq, min, max } */
  };
}

function blank() {
  return { n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity };
}

function accumulate(slot, offsetMs) {
  slot.n++;
  slot.sum += offsetMs;
  slot.sumSq += offsetMs * offsetMs;
  if (offsetMs < slot.min) slot.min = offsetMs;
  if (offsetMs > slot.max) slot.max = offsetMs;
}

/* Record one hit. `beat` is the song position, so a rolling window can be
 * asked for in bars rather than in hits — a dense bar and a sparse one are
 * not the same amount of playing. */
export function pushOffset(acc, voice, offsetMs, beat = 0) {
  if (!Number.isFinite(offsetMs)) return acc;
  accumulate(acc, offsetMs);
  if (!acc.byVoice[voice]) acc.byVoice[voice] = blank();
  accumulate(acc.byVoice[voice], offsetMs);
  acc.ring.push({ voice, offsetMs, beat });
  if (acc.ring.length > acc.cap) acc.ring.splice(0, acc.ring.length - acc.cap);
  return acc;
}

/*
 * Take back every sample from `beat` on: the playhead was scrubbed back over
 * them and the notes they judged are being played again, so counting both
 * takes would weigh that passage twice. The sums are exact; min and max are
 * left as they were (they cannot be un-taken without the samples the ring has
 * already let go of) and only colour the result screen's range.
 */
export function dropFrom(acc, beat) {
  let keep = acc.ring.length;
  while (keep > 0 && acc.ring[keep - 1].beat >= beat) keep--;
  for (let i = keep; i < acc.ring.length; i++) {
    const { voice, offsetMs } = acc.ring[i];
    acc.n--;
    acc.sum -= offsetMs;
    acc.sumSq -= offsetMs * offsetMs;
    const slot = acc.byVoice[voice];
    if (slot) {
      slot.n--;
      slot.sum -= offsetMs;
      slot.sumSq -= offsetMs * offsetMs;
    }
  }
  acc.ring.length = keep;
  return acc;
}

function reduce(n, sum, sumSq, min = Infinity, max = -Infinity) {
  if (n <= 0) return { n: 0, meanMs: 0, sdMs: 0, minMs: 0, maxMs: 0 };
  const mean = sum / n;
  /* Clamped at zero: E[x^2] - E[x]^2 is exact in theory and can land a
   * hair below zero in floating point when every sample is identical. */
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    n,
    meanMs: mean,
    sdMs: Math.sqrt(variance),
    minMs: min === Infinity ? mean : min,
    maxMs: max === -Infinity ? mean : max,
  };
}

/* The whole session. */
export function stats(acc) {
  return reduce(acc.n, acc.sum, acc.sumSq, acc.min, acc.max);
}

function reduceList(list) {
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const v = list[i].offsetMs;
    sum += v;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return reduce(list.length, sum, sumSq, min, max);
}

/* The last `k` hits — what the header reads. */
/*
 * Remembered against the sample count, which every push and every drop
 * changes: the running header asks on every frame, and the answer only
 * changes when a hit lands.
 */
export function recentStats(acc, k = 64) {
  if (acc.recentFor === acc.n && acc.recentK === k && acc.recent) return acc.recent;
  const from = Math.max(0, acc.ring.length - k);
  acc.recentFor = acc.n;
  acc.recentK = k;
  acc.recent = reduceList(acc.ring.slice(from));
  return acc.recent;
}

/* Everything played at or after `beat` — the rolling window, in bars. */
export function statsSince(acc, beat) {
  const out = [];
  for (let i = acc.ring.length - 1; i >= 0; i--) {
    if (acc.ring[i].beat < beat) break;
    out.push(acc.ring[i]);
  }
  return reduceList(out);
}

/* Per voice, over the session. Limbs have their own habits, and a drummer
 * usually has one that drags; a single mean hides exactly that. */
export function perVoice(acc) {
  const out = {};
  for (const id of Object.keys(acc.byVoice)) {
    const s = acc.byVoice[id];
    out[id] = reduce(s.n, s.sum, s.sumSq, s.min, s.max);
  }
  return out;
}

/* The voices that played, worst sigma first — what the summary table ranks
 * by, because the loosest limb is the one to go and practise. */
export function voicesBySpread(acc) {
  const pv = perVoice(acc);
  return Object.keys(pv).sort((a, b) => pv[b].sdMs - pv[a].sdMs);
}


/* The last `k` offsets in ms, oldest first. */
export function recentOffsets(acc, k = 24) {
  const from = Math.max(0, acc.ring.length - k);
  const out = [];
  for (let i = from; i < acc.ring.length; i++) out.push(acc.ring[i].offsetMs);
  return out;
}

/* A short, honest verdict for the summary. Sigma first: a tight player who
 * sits late has one easy thing to fix, a scattered one does not. */
export function verdict(s, tightMs = 30) {
  if (s.n === 0) return 'no hits';
  if (s.sdMs > tightMs * 2) return 'scattered';
  if (s.meanMs < -tightMs / 2) return 'rushing';
  if (s.meanMs > tightMs / 2) return 'dragging';
  if (s.sdMs > tightMs) return 'loose';
  return 'tight';
}
