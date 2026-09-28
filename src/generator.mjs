/*
 * generator.mjs — procedural drills. Pure and seeded, so the same seed always
 * yields the same drill.
 *
 * That property is load-bearing twice over: it is what makes the generator
 * testable at all, and it is what lets you re-attempt the exact bar you just
 * fluffed instead of a different one — which is the whole difference between
 * practising and being tested.
 *
 * Every builder returns the chart shape exercise_io.mjs validates, so
 * generated and hand-written material are interchangeable downstream.
 */

import { VOICE_IDS } from './kit.mjs';
import { merge } from './events.mjs';
import { rng } from './rng.mjs';

export const SUBDIVISIONS = {
  quarters:   { per: 1, name: 'Quarters' },
  eighths:    { per: 2, name: 'Eighths' },
  triplets:   { per: 3, name: 'Triplets' },
  sixteenths: { per: 4, name: 'Sixteenths' },
  sextuplets: { per: 6, name: 'Sextuplets' },
};

const alt = (i) => (i % 2 === 0 ? 'R' : 'L');

/*
 * Roughly eight bars of playing however long the pattern is, so a one-bar
 * rudiment and a four-bar switching drill take about the same time. A
 * practice that runs for wildly different lengths depending on which drill
 * you picked is hard to build a session out of.
 */
function defaultRepeatsFor(bars) {
  return Math.max(2, Math.round(8 / Math.max(1, bars)));
}

function chart(id, name, events, opts = {}) {
  return {
    id,
    name,
    bpm: opts.bpm || 90,
    timeSig: opts.timeSig || [4, 4],
    loopBars: opts.bars || 1,
    /* Generated drills state a length too. Anything that did not would be
     * endless by omission, which is the shape of the bug this replaced. */
    repeats: opts.repeats === undefined ? defaultRepeatsFor(opts.bars || 1) : opts.repeats,
    sticking: opts.sticking || 'off',
    generated: true,
    events,
  };
}

/*
 * A steady subdivision, alternating hands, with the first of each beat
 * accented. The accent is not decoration: it is what makes the subdivision
 * audible as a group rather than as an undifferentiated stream, and it is the
 * thing that falls apart first when the tempo goes up.
 */
export function subdivisionDrill(kind, opts = {}) {
  const spec = SUBDIVISIONS[kind] || SUBDIVISIONS.eighths;
  const bars = opts.bars || 1;
  const beats = bars * 4;
  const voice = opts.voice || 'SN';
  const events = [];
  let i = 0;
  for (let b = 0; b < beats; b++) {
    for (let k = 0; k < spec.per; k++) {
      events.push({
        beat: b + k / spec.per,
        voices: [voice],
        hand: alt(i),
        dyn: k === 0 ? 'accent' : 'normal',
      });
      i++;
    }
  }
  return chart(`subdiv:${kind}`, spec.name, events, { ...opts, bars, sticking: 'strict' });
}

/*
 * One bar of each subdivision in turn. Switching is the actual skill — a
 * player who has only ever practised one subdivision at a time can play all
 * of them and none of the changes, and the change is where the music is.
 */
export function subdivisionLadder(opts = {}) {
  const order = opts.order || ['quarters', 'eighths', 'triplets', 'sixteenths'];
  const voice = opts.voice || 'SN';
  const events = [];
  let i = 0;
  for (let bar = 0; bar < order.length; bar++) {
    const per = (SUBDIVISIONS[order[bar]] || SUBDIVISIONS.eighths).per;
    for (let b = 0; b < 4; b++) {
      for (let k = 0; k < per; k++) {
        events.push({
          beat: bar * 4 + b + k / per,
          voices: [voice],
          hand: alt(i),
          dyn: k === 0 ? 'accent' : 'normal',
        });
        i++;
      }
    }
  }
  return chart('subdiv:mixed', 'Switching', events, {
    ...opts, bars: order.length, sticking: 'strict',
  });
}

/*
 * A random rhythm line. Beat one always sounds — a bar whose downbeat is a
 * rest is a reading exercise about finding the downbeat, which is a different
 * and much harder skill than the one being drilled here.
 */
export function readingLine(opts = {}) {
  const bars = opts.bars || 2;
  const per = opts.per || 2;
  const density = opts.density === undefined ? 0.55 : opts.density;
  const voice = opts.voice || 'SN';
  const next = rng(opts.seed || 1);
  const events = [];
  const slots = bars * 4 * per;
  for (let s = 0; s < slots; s++) {
    const onDownbeat = s % (4 * per) === 0;
    if (!onDownbeat && next() > density) continue;
    events.push({
      beat: s / per,
      voices: [voice],
      dyn: onDownbeat ? 'accent' : 'normal',
    });
  }
  return chart(`reading:${per}:${opts.seed || 1}`, `Reading ${per === 4 ? '16ths' : '8ths'}`,
               events, { ...opts, bars });
}

/* A random sticking pattern on a steady grid. The rhythm is given; the only
 * question is which hand, which is what isolates the skill. */
export function stickingDrill(opts = {}) {
  const bars = opts.bars || 1;
  const per = opts.per || 4;
  const voice = opts.voice || 'SN';
  const next = rng(opts.seed || 1);
  const events = [];
  const slots = bars * 4 * per;
  for (let s = 0; s < slots; s++) {
    events.push({
      beat: s / per,
      voices: [voice],
      hand: next() < 0.5 ? 'R' : 'L',
      dyn: s % per === 0 ? 'accent' : 'normal',
    });
  }
  return chart(`sticking:${opts.seed || 1}`, 'Random sticking', events, {
    ...opts, bars, sticking: 'strict',
  });
}

/*
 * A groove with the kick and hat held and the snare moved. Displacing the
 * backbeat against a steady ostinato is the standard independence drill, and
 * it stays a drill rather than becoming a puzzle because only one thing
 * changes.
 */
export function grooveVariation(opts = {}) {
  const bars = opts.bars || 1;
  const next = rng(opts.seed || 1);
  const events = [];
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * 4;
    for (let e = 0; e < 8; e++) events.push({ beat: base + e / 2, voices: ['HH'] });
    events.push({ beat: base, voices: ['KK'] });
    events.push({ beat: base + 2.5, voices: ['KK'] });
    /* Two snares a bar, on eighth-note slots, never both in the same place
     * and never on the downbeat — where it would fight the kick. */
    const slots = [1, 1.5, 2, 3, 3.5];
    const a = Math.floor(next() * slots.length);
    let b = Math.floor(next() * slots.length);
    if (b === a) b = (b + 1) % slots.length;
    events.push({ beat: base + slots[a], voices: ['SN'], dyn: 'accent' });
    events.push({ beat: base + slots[b], voices: ['SN'], dyn: 'accent' });
  }
  events.sort((x, y) => x.beat - y.beat);
  return chart(`groove:${opts.seed || 1}`, 'Groove variation', merge(events), {
    ...opts, bars,
  });
}

/*
 * Fold hits that land on the same beat into one stack. Downstream everything
 * assumes entries have distinct beats — the scroll draws one column per
 * entry, and the beam engine reads the gap between neighbours — so two events
 * on beat 0 would draw twice and be read as a zero-length note.
 */
/* The generated drills, in the order they appear in the menu. */
export function builtins(opts = {}) {
  const o = { bpm: opts.bpm || 90, seed: opts.seed || 1 };
  return [
    subdivisionDrill('quarters', o),
    subdivisionDrill('eighths', o),
    subdivisionDrill('triplets', o),
    subdivisionDrill('sixteenths', o),
    subdivisionDrill('sextuplets', o),
    subdivisionLadder(o),
    readingLine({ ...o, per: 2, bars: 2 }),
    readingLine({ ...o, per: 4, bars: 2, density: 0.4 }),
    stickingDrill(o),
    grooveVariation(o),
  ];
}

export { VOICE_IDS };
