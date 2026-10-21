// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * levels.mjs — the lesson ladder. Pure, and a leaf but for the kit.
 *
 * A groove is written ONCE, with every voice it uses, and the four levels are
 * PROJECTIONS of that one file rather than four files:
 *
 *   L1  cymbals only          the timekeeper alone
 *   L2  + kick                hat and kick
 *   L3  + snare               the backbeat
 *   L4  everything            as written
 *
 * and before them, L0: everything as written, with NO CLOCK. The whole bar
 * stands still on one page and a cursor waits on the next stack until you
 * strike it — see untimed.mjs. It is the same projection as L4 played in a
 * different mode, which is exactly why it goes first: the notes are learned
 * at whatever pace the hands can manage, and only then does a tempo arrive.
 *
 * Deriving rather than duplicating buys three things. The four levels are
 * provably the same groove — a wrong note is fixed once. The bundle stays
 * fourteen files instead of fifty-six. And, most of all, derivation never
 * MOVES A VOICE: the kick is the same pad at L2 as it is at L4, so what you
 * learn at the bottom of the ladder transfers literally instead of by
 * analogy.
 *
 * This replaces three hand-written "basics" files that were exactly this
 * duplication — one groove, copied three times with voices removed. The
 * payoff is not three fewer files; it is that every groove in the bundle now
 * has a ladder instead of one of them having an approximation of one.
 */

import { VOICE_IDS } from './kit.mjs';

const CYMBALS = ['CR', 'HH', 'HO', 'RD'];
const FEET = ['KK', 'HF'];

/*
 * `step` is what the list prints in its value column, `label` what the row
 * says. Order is the ladder — the menu shows them top to bottom.
 *
 * `voices: null` means everything, which is not the same as listing all nine:
 * a groove using a voice this file has never heard of still plays at L4.
 */
export const LEVELS = [
  { id: 'l0', step: 'L0', label: 'Own pace', voices: null, untimed: true },
  { id: 'l1', step: 'L1', label: 'Time only', voices: CYMBALS },
  { id: 'l2', step: 'L2', label: '+ kick', voices: [...CYMBALS, ...FEET] },
  { id: 'l3', step: 'L3', label: '+ snare', voices: [...CYMBALS, ...FEET, 'SN'] },
  { id: 'l4', step: 'L4', label: 'Everything', voices: null },
];

/*
 * How many times an L0 take walks the pattern. Not the file's `repeats`: that
 * says how long a TIMED practice is, and eight passes of a samba stepped
 * stack by stack is minutes per take — while the take count is what makes a
 * rising pace visible. One pass is too few the other way: a one-bar groove is
 * eight stacks, and a single slip would sink it below 90%. Two practise the
 * seam where the pattern comes round again, which is where grooves fall apart.
 * `Reps` still overrides it, because asking for more is explicit.
 */
export const UNTIMED_PASSES = 2;

/* A rung's item id, `rock-backbeat:l3` -> 3. One pattern for every reader of
 * ids — progress, the list, the stats — so a new rung is added here once. */
export const LEVEL_ID_RE = /:l([0-4])$/;

export function isUntimedId(id) {
  const m = LEVEL_ID_RE.exec(id || '');
  return Boolean(m && m[1] === '0');
}

export function levelById(id) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].id === id) return LEVELS[i];
  }
  return null;
}

function keeps(lv, voice) {
  return lv.voices === null || lv.voices.indexOf(voice) >= 0;
}

/*
 * The dynamics of a stack, with the removed voices taken out.
 *
 * A stack-wide string becomes a map here rather than staying a string: after
 * a projection it no longer describes every voice in the stack, and leaving
 * it as a string would apply a snare's accent to the hi-hat that survived
 * alongside it.
 */
function projectDyn(event, kept) {
  if (!event.dyn) return undefined;
  const out = {};
  for (const v of kept) {
    const d = typeof event.dyn === 'string' ? event.dyn : (event.dyn[v] || 'normal');
    if (d !== 'normal') out[v] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

/*
 * A chart for one rung of the ladder. Returns null for an unknown level, and
 * for a level a groove has no material for — a hi-hat drill has no L2.
 */
export function projectLevel(chart, levelId) {
  const lv = levelById(levelId);
  if (!lv || !chart || !Array.isArray(chart.events)) return null;

  const events = [];
  for (const e of chart.events) {
    const kept = (e.voices || []).filter((v) => keeps(lv, v));
    if (!kept.length) continue;
    const out = { beat: e.beat, voices: kept };
    if (e.hand) out.hand = e.hand;
    const dyn = projectDyn(e, kept);
    if (dyn) out.dyn = dyn;
    events.push(out);
  }
  if (!events.length) return null;

  const out = {
    ...chart,
    id: `${chart.id}:${lv.id}`,
    name: chart.name,
    level: lv.id,
    events,
  };
  if (lv.untimed) {
    out.untimed = true;
    out.repeats = UNTIMED_PASSES;
  }
  return out;
}

/*
 * The rungs this groove actually has, collapsing any that would play the same
 * notes as the one below. A hi-hat drill has one level; a kick-and-hat groove
 * has two, not four with duplicates.
 */
/*
 * Remembered per chart object: the drill tree, the Learning Path and the
 * folder sums all ask for every groove's rungs, and projecting four levels of
 * forty grooves is most of what opening the module costs. A loaded chart is
 * never changed afterwards — arming one makes a copy — so the answer holds.
 */
const levelCache = new WeakMap();

export function availableLevels(chart) {
  if (chart && typeof chart === 'object') {
    const hit = levelCache.get(chart);
    if (hit) return hit;
    const out = computeLevels(chart);
    levelCache.set(chart, out);
    return out;
  }
  return computeLevels(chart);
}

/*
 * L0 is outside the collapse on purpose. It plays the same notes as the top
 * rung, so a signature cannot tell them apart — they differ in MODE, not in
 * notes. It is offered exactly when there is a ladder to climb: a groove has
 * one, a rudiment (all snare) or a hat-only drill does not, and those keep
 * opening straight away rather than turning into a folder of one.
 */
function computeLevels(chart) {
  const out = [];
  let lastSig = null;
  for (const lv of LEVELS) {
    if (lv.untimed) continue;
    const projected = projectLevel(chart, lv.id);
    if (!projected) continue;
    const sig = signature(projected);
    if (sig === lastSig) continue;
    lastSig = sig;
    out.push(lv);
  }
  if (out.length > 1) out.unshift(LEVELS[0]);
  return out;
}

/* Enough of a chart to tell two projections apart: what is played, and when. */
function signature(chart) {
  let s = '';
  for (const e of chart.events) s += `${e.beat}:${e.voices.join('+')};`;
  return s;
}

export { VOICE_IDS };
