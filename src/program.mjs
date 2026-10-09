// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * program.mjs — the Learning Path: what to practise next. Pure.
 *
 * Ported from Piano Practice's Learning Program. Four tracks run side by
 * side, because time, hands, grooves and ears are different skills and a
 * session that mixes them beats one that grinds a single list:
 *
 *   Time        subdivisions, switching between them, reading, the Clock
 *   Rudiments   the forty PAS rudiments in teaching order, not by family
 *   Grooves     every groove rung by rung, family by family, easy to hard
 *   Ear         name the drum, the subdivision, the groove
 *
 * A track is units of steps, and a step is only a pointer at a row of the
 * drill tree, by the same id progress.mjs files its takes under. That is what
 * keeps the path from being a second, parallel record: play a flam tap from
 * Rudiments › Flams and its step on the path is done too.
 *
 * Nothing is ever locked. The path only recommends: a track's next step is
 * its first one neither learned nor skipped, and Continue picks the track
 * you have left longest.
 */

import { availableLevels } from './levels.mjs';
import { item, isDone } from './progress.mjs';
import { DRILLS } from './guess.mjs';

/*
 * The written tempo of a generated drill. A file says how fast it goes; a
 * generated drill follows the Tempo setting, so without a number of its own
 * there would be nothing to measure a clean speed against. Opening one from
 * the path sets Tempo to it, so 100% Speed is the target.
 */
export const BASIC_TARGETS = {
  'subdiv:quarters': 100,
  'subdiv:eighths': 100,
  'subdiv:triplets': 90,
  'subdiv:sixteenths': 80,
  'subdiv:sextuplets': 70,
  'subdiv:mixed': 80,
  'reading:2': 90,
  'reading:4': 80,
  sticking: 80,
  groove: 90,
};

export function targetBpm(id) {
  return BASIC_TARGETS[id] || 0;
}

const basic = (id, label) => ({ id, label });

const TIME = [
  { name: 'Pulse', steps: [
    basic('subdiv:quarters', 'Quarters'),
    basic('subdiv:eighths', 'Eighths'),
  ] },
  { name: 'Triplets & 16ths', steps: [
    basic('subdiv:triplets', 'Triplets'),
    basic('subdiv:sixteenths', 'Sixteenths'),
    basic('subdiv:sextuplets', 'Sextuplets'),
    basic('subdiv:mixed', 'Switching'),
  ] },
  { name: 'Reading', steps: [
    basic('reading:2', 'Reading 8ths'),
    basic('reading:4', 'Reading 16ths'),
    basic('sticking', 'Random sticking'),
  ] },
  /* The Clock wraps a drill; on the path it wraps the plainest one, so what
   * is being learned is the time and nothing else. */
  { name: 'Keep time', steps: [
    { id: 'clock', label: 'Clock: quarters', wrap: 'subdiv:quarters' },
  ] },
];

/*
 * The rudiments in the order a teacher brings them in: the strokes every
 * other rudiment is built from, then the first rolls, flams and drags, then
 * the longer and the compound ones. The families in the drill tree are the
 * PAS families, which is a filing system, not a curriculum.
 */
const RUDIMENT_ORDER = [
  { name: 'Singles, doubles', ids: ['single-stroke-roll', 'double-stroke-roll', 'single-paradiddle',
    'single-stroke-four', 'single-stroke-seven'] },
  { name: 'Short rolls', ids: ['five-stroke-roll', 'nine-stroke-roll', 'seven-stroke-roll',
    'multiple-bounce-roll', 'triple-stroke-roll'] },
  { name: 'Flams', ids: ['flam', 'flam-tap', 'flam-accent', 'flamacue', 'flam-paradiddle'] },
  { name: 'Drags', ids: ['drag', 'drag-tap', 'single-ratamacue', 'double-drag-tap', 'lesson-25'] },
  { name: 'Paradiddles', ids: ['double-paradiddle', 'triple-paradiddle', 'paradiddle-diddle'] },
  { name: 'Long rolls', ids: ['six-stroke-roll', 'ten-stroke-roll', 'eleven-stroke-roll',
    'thirteen-stroke-roll', 'fifteen-stroke-roll', 'seventeen-stroke-roll'] },
  { name: 'Advanced flams', ids: ['single-flammed-mill', 'flam-paradiddle-diddle', 'pataflafla',
    'swiss-army-triplet', 'inverted-flam-tap', 'flam-drag'] },
  { name: 'Advanced drags', ids: ['single-dragadiddle', 'drag-paradiddle-1', 'drag-paradiddle-2',
    'double-ratamacue', 'triple-ratamacue'] },
];

/*
 * Grooves family by family, and within a family the slowest and plainest
 * first. A groove the order does not name — one added in user.json — joins
 * the end of its family in manifest order.
 */
export const GROOVE_FAMILIES = ['rock', 'funk', 'latin', 'jazz', 'electronic', 'techno'];
const GROOVE_ORDER = {
  rock: ['rock-backbeat', 'straight-eights', 'halftime-ballad', 'pop-four-floor', 'motown',
    'disco', 'rock-fill', 'punk'],
  funk: ['sixteenth-funk', 'ghost-note-funk', 'funk-toms', 'linear-funk', 'half-time-shuffle'],
  latin: ['reggae-one-drop', 'bossa-nova', 'cha-cha', 'afrobeat', 'second-line', 'samba',
    'afro-cuban-68', 'songo', 'mambo', 'mozambique'],
  jazz: ['shuffle', 'two-beat', 'jazz-ride', 'jazz-waltz', 'uptempo-swing'],
  electronic: ['house', 'boom-bap', 'dubstep', 'trap-hats', 'uk-garage', 'breakbeat', 'drum-and-bass'],
  techno: ['techno-four', 'minimal', 'dub-techno', 'detroit', 'electro', 'tribal-techno', 'hard-techno'],
};

/* A quiz step's id is the id its rounds are recorded under. */
export function quizItemId(drill) {
  return `quiz:${drill.mode}:${drill.kind}`;
}

const quizStep = (mode, kind) => {
  const drill = DRILLS.find((d) => d.mode === mode && d.kind === kind);
  return { id: quizItemId(drill), label: drill.name, quiz: drill };
};

const EAR = [
  { name: 'Know the kit', steps: [
    quizStep('guess', 'voice'), quizStep('hear', 'voice'), quizStep('pick', 'voice'),
  ] },
  { name: 'Hear the time', steps: [quizStep('pick', 'subdiv')] },
  { name: 'Name the groove', steps: [quizStep('pick', 'groove')] },
];

function rudimentUnits(byId) {
  const units = [];
  for (let u = 0; u < RUDIMENT_ORDER.length; u++) {
    const steps = [];
    for (const id of RUDIMENT_ORDER[u].ids) {
      if (byId[id]) steps.push({ id, label: byId[id].name });
    }
    if (steps.length) units.push({ name: RUDIMENT_ORDER[u].name, steps });
  }
  return units;
}

/* A groove's steps: one per rung it actually has, or itself when it has one. */
function grooveSteps(chart) {
  const levels = availableLevels(chart);
  if (levels.length <= 1) return [{ id: chart.id, label: chart.name }];
  return levels.map((lv) => ({
    id: `${chart.id}:${lv.id}`,
    label: `${lv.step} ${lv.label}`,
    title: `${chart.name} ${lv.step}`,
  }));
}

function grooveUnits(entries, categories) {
  const units = [];
  for (const fam of GROOVE_FAMILIES) {
    const cat = categories.find((c) => c.id === fam);
    const inFam = entries.filter((e) => e.category === fam).map((e) => e.chart);
    const order = GROOVE_ORDER[fam] || [];
    const rank = (c) => {
      const i = order.indexOf(c.id);
      return i < 0 ? order.length : i;
    };
    inFam.sort((a, b) => rank(a) - rank(b));
    for (const chart of inFam) {
      units.push({ name: chart.name, group: cat ? cat.name : fam, steps: grooveSteps(chart) });
    }
  }
  return units;
}

/* The whole path. `entries` is [{ chart, category }], as catalog.mjs takes it. */
export function buildProgram({ entries = [], categories = [] } = {}) {
  const byId = {};
  for (const e of entries) byId[e.chart.id] = e.chart;
  return [
    { key: 'time', name: 'Time', units: TIME },
    { key: 'rudiments', name: 'Rudiments', units: rudimentUnits(byId) },
    { key: 'grooves', name: 'Grooves', units: grooveUnits(entries, categories) },
    { key: 'ear', name: 'Ear', units: EAR },
  ];
}

/* ---- Following it --------------------------------------------------------- */

export function trackSteps(track) {
  if (track.steps) return track.steps;
  const out = [];
  for (let u = 0; u < track.units.length; u++) {
    for (let s = 0; s < track.units[u].steps.length; s++) out.push(track.units[u].steps[s]);
  }
  /* Cached on the track: the units never change once built, and Continue
   * walks every track each time the list is redrawn after a take. */
  track.steps = out;
  return out;
}

/* What a step is called on its own, outside its unit's folder. */
export function stepTitle(step) {
  return step.title || step.label;
}

function open(progress, step) {
  if (isDone(progress, step.id)) return false;
  const it = item(progress, step.id);
  return !(it && it.skip);
}

/* The first step neither learned nor skipped, or null when the track is done. */
export function nextStep(progress, track) {
  const steps = trackSteps(track);
  for (let i = 0; i < steps.length; i++) if (open(progress, steps[i])) return steps[i];
  return null;
}

/*
 * On from a step: the next open one AFTER it, wrapping round — so Click on a
 * result moves along the track even when the take was not yet good enough,
 * rather than opening the same drill again.
 */
export function stepAfter(progress, track, id) {
  const steps = trackSteps(track);
  const at = steps.findIndex((s) => s.id === id);
  for (let k = 1; k <= steps.length; k++) {
    const s = steps[(at + k) % steps.length];
    if (s.id !== id && open(progress, s)) return s;
  }
  return null;
}

/* When the track was last practised, by any of its steps, in unix seconds. */
export function trackActivity(progress, track) {
  const steps = trackSteps(track);
  let latest = 0;
  for (let i = 0; i < steps.length; i++) {
    const it = item(progress, steps[i].id);
    if (it && it.t > latest) latest = it.t;
  }
  return latest;
}

/*
 * Continue: the next step of the track left longest. Ties go to the earlier
 * track, so a first session walks Time, Rudiments, Grooves and Ear in turn.
 */
export function continueStep(progress, tracks) {
  let best = null;
  let bestAt = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const step = nextStep(progress, tracks[i]);
    if (!step) continue;
    const at = trackActivity(progress, tracks[i]);
    if (at < bestAt) {
      best = { track: tracks[i], step };
      bestAt = at;
    }
  }
  return best;
}

export function trackOf(tracks, id) {
  for (let i = 0; i < tracks.length; i++) {
    if (trackSteps(tracks[i]).some((s) => s.id === id)) return tracks[i];
  }
  return null;
}

export function findStep(tracks, id) {
  for (let i = 0; i < tracks.length; i++) {
    const s = trackSteps(tracks[i]).find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

/* ---- As rows of the drill list -------------------------------------------- */

/* A step as a row: a leaf under its own id, so it is summed and marked
 * wherever it appears. */
export function stepRow(step) {
  return { label: step.label, value: '', id: step.id, step };
}

function unitFolder(u) {
  return { label: u.name, value: '>', children: u.steps.map(stepRow) };
}

/* A track's rows: its units, or for Grooves its units under their family. */
function trackChildren(t) {
  if (!t.units.some((u) => u.group)) return t.units.map(unitFolder);
  const groups = [];
  for (const u of t.units) {
    let g = groups.find((x) => x.label === u.group);
    if (!g) {
      g = { label: u.group, value: '>', children: [] };
      groups.push(g);
    }
    g.children.push(unitFolder(u));
  }
  return groups;
}

/*
 * The Learning Path folder. Continue, Skip and Repetition are rows ui.js
 * gives meaning to; Repetition's rows depend on the day, so the caller
 * supplies them as a function and the folder sums leave them out.
 */
export function programFolder(tracks, repetitionRows = () => []) {
  return {
    label: 'Learning Path',
    value: '>',
    /* Its rows point back into the tree rather than holding drills. */
    pointers: true,
    children: [
      { label: 'Continue', value: '', continueRow: true },
      { label: 'Skip next', value: '', skipRow: true },
      ...tracks.map((t) => ({ label: t.name, value: '>', track: t, children: trackChildren(t) })),
      {
        label: 'Repetition',
        value: '>',
        repetition: true,
        untracked: true,
        /* Asked for each time: what is due changes with the day. */
        get children() { return repetitionRows(); },
      },
    ],
  };
}
