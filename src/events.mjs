/*
 * events.mjs — operations on a list of events. Pure, and a LEAF: it imports
 * nothing.
 *
 * This exists to break a backwards dependency. `merge` was in generator.mjs,
 * which meant exercise_io.mjs — a LOADER — imported a GENERATOR to read a file
 * off disk. Nothing about folding two hits onto one beat belongs to either of
 * them; it belongs to the event list itself, which is the one thing they share.
 */

/*
 * Fold hits that land on the same beat into one stack.
 *
 * Downstream everything assumes entries have distinct beats — the scroll draws
 * one column per entry, and the beam engine reads the gap between neighbours —
 * so two events on beat 0 would draw twice and be read as a zero-length note.
 */
export function merge(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - e.beat) < 1e-6) {
      for (const v of e.voices) if (!last.voices.includes(v)) last.voices.push(v);
      /*
       * Dynamics are folded PER VOICE. Letting the loudest win would accent
       * the hi-hat sitting over an accented snare — which is every backbeat
       * in the bundle, and would ask the player for something nobody plays.
       */
      const merged = expandDyn(last);
      for (const v of e.voices) {
        const d = dynOf(e, v);
        if (d !== 'normal') merged[v] = d;
      }
      if (Object.keys(merged).length) last.dyn = merged;
      else delete last.dyn;
      if (e.hand && !last.hand) last.hand = e.hand;
      continue;
    }
    out.push({ ...e, voices: e.voices.slice() });
  }
  return out;
}

/*
 * The dynamic for one voice of a stack.
 *
 * `dyn` may be a string (the whole stack) or a map keyed by voice. The map
 * form exists because the commonest thing in drumming is an accented snare
 * under an UNaccented hi-hat — a backbeat — which a stack-wide dynamic cannot
 * express.
 */
export function dynOf(e, voice) {
  if (!e || !e.dyn) return 'normal';
  if (typeof e.dyn === 'string') return e.dyn;
  return e.dyn[voice] || 'normal';
}

/* A stack's dynamics as a per-voice map, whichever form it was written in. */
export function expandDyn(e) {
  const out = {};
  if (!e || !e.dyn) return out;
  if (typeof e.dyn === 'string') {
    if (e.dyn !== 'normal') for (const v of e.voices) out[v] = e.dyn;
    return out;
  }
  for (const v of Object.keys(e.dyn)) if (e.dyn[v] !== 'normal') out[v] = e.dyn[v];
  return out;
}
