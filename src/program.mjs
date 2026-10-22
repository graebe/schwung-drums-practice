// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * program.mjs — the Learning Path: what to practise next. Pure.
 *
 * SEVEN STAGES, each one musical world — the kit, eighth notes, sixteenths and
 * dynamics, ghosts and independence, triplets and swing, clave, and the pro
 * material — and inside each FOUR TRACKS side by side, because time, hands,
 * grooves and ears are different skills and a session that mixes them beats
 * one that grinds a single list:
 *
 *   Time      the pulse, reading, the Clock
 *   Hands     hand patterns, the rudiments, dynamics
 *   Grooves   beats, fills, phrases — a groove rung by rung
 *   Ear       the kit, the subdivision, the groove, by ear
 *
 * The tracks used to run on their own, and Continue round-robined them: a
 * beginner met sixteenth-note single strokes before an eighth note, and
 * triplet rudiments long before triplets. Now Continue recommends only the
 * CURRENT STAGE, so the tracks stay in step: what the hands are asked, the
 * ears and the eyes have been given.
 *
 * A stage has a CORE — the few steps that teach its idea, one new thing each
 * — ELECTIVES, more of the same idea in other styles, never required, and a
 * CHECKPOINT: a piece of music that proves the stage. Passing the checkpoint
 * closes the stage whatever else is open, which is also how someone who can
 * already play tests out of it. So does closing every core step.
 *
 * A step is only a pointer at a row of the drill tree, by the id progress.mjs
 * files its takes under, with a TARGET: the share of the written tempo it
 * asks. The same drill comes back in a later stage at a higher target — the
 * spiral: a drill arrives slow and returns faster — and a take anywhere
 * counts: play a flam tap from Rudiments › Flams at the tempo a step asks and
 * the step is done. Nothing is ever locked; the path only recommends.
 *
 * The stages name material that is not written yet (new generators, new
 * files). A step whose drill is not installed is left out when the path is
 * built, so the table can be the whole curriculum while it ships.
 */

import { availableLevels, isUntimedId, LEVEL_ID_RE } from './levels.mjs';
import { item, isDone, isParked, LEARNED } from './progress.mjs';
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

export const TRACKS = [
  { key: 'time', name: 'Time' },
  { key: 'hands', name: 'Hands' },
  { key: 'grooves', name: 'Grooves' },
  { key: 'ear', name: 'Ear' },
];

/* The Speed setting's reach: a step asks no more than a take can be set to. */
export const MAX_TARGET = 120;

/* ---- The table ------------------------------------------------------------ */

/*
 * Step specs. `t` is the target in percent of the written tempo; `alt` the
 * drills that stand in when the first is not installed or its style is
 * switched off; `card` the lesson card, or cards, that introduce it
 * (lessons.mjs).
 */
const time = (id, t = 100, o = {}) => ({ track: 'time', id, t, ...o });
const hands = (id, t = 100, o = {}) => ({ track: 'hands', id, t, ...o });
const groove = (id, t = 100, o = {}) => ({ track: 'grooves', groove: id, t, ...o });
const quiz = (mode, kind, variant = '', o = {}) => ({ track: 'ear', quiz: { mode, kind, variant }, ...o });

/*
 * A quiz with a smaller pool is a different exercise — three drums are not
 * nine — so it is its own item, `quiz:guess:voice:kit3`, and learning it
 * does not tick the whole kit.
 */
export const QUIZ_POOLS = {
  kit3: { voices: ['KK', 'SN', 'HH'] },
  qe: { subdivs: ['quarters', 'eighths'] },
  qes: { subdivs: ['quarters', 'eighths', 'sixteenths'] },
};

export const STAGES = [
  {
    key: 's0', name: 'Hello, kit', card: 'stage-0',
    core: [
      quiz('guess', 'voice', 'kit3', { card: ['kit-on-paper', 'your-pads'] }),
      quiz('hear', 'voice', 'kit3'),
      time('subdiv:quarters', 60, { card: ['pulse', 'result'] }),
      time('read:1', 100, { card: 'rests' }),
      groove('first-beat', 100, { card: 'backbeat' }),
    ],
    electives: [groove('motown', 60), groove('two-beat', 50), quiz('pick', 'voice', 'kit3')],
    checkpoint: groove('first-beat', 100, { top: true, card: 'checkpoints' }),
  },
  {
    key: 's1', name: 'Eighth notes', card: 'stage-1',
    core: [
      time('subdiv:eighths', 80, { card: 'eighths' }),
      time('read:2a', 100),
      time('offbeat:a', 100, { card: 'offbeats' }),
      hands('hands:RRLL:8', 100, { card: 'hands' }),
      groove('eighth-beat', 100),
      groove('rock-backbeat', 90, { card: 'syncopation' }),
      groove('kickvar:8', 100, { card: 'kick-patterns' }),
      groove('pop-four-floor', 80, { card: 'open-hat' }),
      time('read:2b', 100, { alt: ['reading:2'] }),
      groove('phrase:4:fill8-2', 100, { card: 'fills' }),
      time('clock:gap1', 100, { alt: ['clock'], wrap: 'subdiv:quarters', card: 'keep-time' }),
      quiz('pick', 'subdiv', 'qe'),
      quiz('pick', 'voice'),
    ],
    electives: [
      groove('straight-eights', 100), groove('halftime-ballad', 100), groove('rock-fill', 100),
      groove('disco', 80), groove('cha-cha', 80), groove('reggae-one-drop', 100),
      hands('hands:RLRRLRLL:8', 100),
    ],
    checkpoint: groove('phrase:4:fill8-2', 100, { top: true, alt: ['rock-backbeat'] }),
  },
  {
    key: 's2', name: 'Sixteenths', card: 'stage-2',
    core: [
      time('subdiv:sixteenths', 85, { card: 'sixteenths' }),
      time('partials:&', 100, { card: 'four-spots' }),
      time('partials:a', 100),
      time('partials:e', 100),
      time('partials:mix', 100),
      time('read:3a', 100, { card: 'cells' }),
      time('read:3b', 100, { alt: ['reading:4'] }),
      hands('single-stroke-roll', 75, { card: 'rudiments' }),
      hands('double-stroke-roll', 70),
      hands('single-paradiddle', 75),
      hands('five-stroke-roll', 70),
      hands('accent:8', 100, { dyn: 70, card: 'accents' }),
      hands('accent:16', 100, { dyn: 70 }),
      hands('ghost:1', 100, { dyn: 70, card: 'ghost-notes' }),
      groove('house', 80, { card: 'dyn-score' }),
      groove('boom-bap', 90),
      groove('electro', 75, { card: 'between-hats' }),
      groove('kickvar:16', 100),
      groove('sixteenth-funk', 85),
      groove('phrase:4:fill16-1', 100),
      groove('phrase:4:fill16-2', 100),
      time('clock:gap2', 100),
      quiz('pick', 'subdiv', 'qes'),
      quiz('pick', 'groove'),
    ],
    electives: [
      groove('disco', 100), groove('minimal', 100), groove('dubstep', 70), groove('punk', 70),
      hands('single-paradiddle', 100), hands('sticking', 100), hands('multiple-bounce-roll', 80),
      time('reading:4', 100),
    ],
    checkpoint: groove('sixteenth-funk', 100, { top: true, alt: ['house'] }),
  },
  {
    key: 's3', name: 'Ghosts & flams', card: 'stage-3',
    core: [
      time('switch:8-16', 100, { card: 'changing-grids' }),
      time('kickread:8', 100, { card: 'independence' }),
      time('kickread:16', 100),
      time('groove', 100),
      groove('ghost-note-funk', 90),
      groove('linear-funk', 90, { card: 'linear' }),
      hands('flam', 80, { card: 'flams' }),
      hands('flam-tap', 80),
      hands('drag', 80),
      hands('drag-tap', 80),
      hands('single-stroke-roll', 100),
      hands('double-stroke-roll', 100),
      hands('single-paradiddle', 100),
      groove('techno-four', 80),
      groove('breakbeat', 80),
      groove('funk-toms', 85),
      groove('phrase:8', 100, { card: 'form' }),
      quiz('echo', '8'),
    ],
    electives: [
      groove('punk', 100), groove('reggae-one-drop', 100), groove('minimal', 100),
      groove('dub-techno', 100), groove('detroit', 80), groove('drum-and-bass', 65),
      hands('seven-stroke-roll', 80), hands('nine-stroke-roll', 80), hands('lesson-25', 80),
    ],
    checkpoint: groove('ghost-note-funk', 100, { top: true, dyn: 80, alt: ['linear-funk'] }),
  },
  {
    key: 's4', name: 'Triplets/swing', card: 'stage-4',
    core: [
      time('subdiv:triplets', 80, { card: 'triplets' }),
      time('switch:8-t', 100, { alt: ['subdiv:mixed'] }),
      time('read:t', 100),
      time('swing:58', 100, { card: 'swing' }),
      time('swing:66', 100),
      groove('shuffle', 90, { card: 'shuffle' }),
      groove('half-time-shuffle', 90),
      groove('blues-12-8', 100, { card: 'compound' }),
      groove('ballad-6-8', 100),
      hands('single-stroke-four', 80),
      hands('single-stroke-seven', 80),
      hands('triple-stroke-roll', 80),
      hands('flam-accent', 80),
      hands('swiss-army-triplet', 80),
      hands('paradiddle-diddle', 80),
      hands('double-paradiddle', 80),
      groove('jazz-ride', 70, { card: 'jazz-ride' }),
      time('clock:24', 100, { card: 'click-24' }),
      groove('two-beat', 80),
      groove('jazz-waltz', 80),
      time('subdiv:sextuplets', 80),
      groove('trap-hats', 75),
      quiz('pick', 'swing'),
      quiz('pick', 'meter'),
      quiz('pick', 'subdiv'),
    ],
    electives: [
      groove('uk-garage', 100), groove('afro-cuban-68', 75), groove('uptempo-swing', 50),
      hands('triple-paradiddle', 80),
    ],
    checkpoint: groove('jazz-ride', 100, { top: true, alt: ['half-time-shuffle'] }),
  },
  {
    key: 's5', name: 'Clave & world', card: 'stage-5',
    core: [
      groove('son-clave-3-2', 100, { card: 'clave' }),
      groove('son-clave-2-3', 100),
      groove('rumba-clave-3-2', 100),
      quiz('pick', 'clave'),
      time('poly:hemiola', 100, { card: 'polyrhythm' }),
      time('poly:3:2', 100),
      groove('bossa-nova', 75, { card: 'latin' }),
      groove('samba', 75),
      groove('songo', 75),
      groove('mozambique', 70),
      hands('flamacue', 80),
      hands('flam-paradiddle', 80),
      hands('single-ratamacue', 80),
      hands('double-drag-tap', 80),
      hands('six-stroke-roll', 80),
      hands('ten-stroke-roll', 80),
      hands('orchestrate:paradiddle', 100, { card: 'round-the-kit' }),
      hands('single-stroke-roll', 120),
      time('clock:gap4', 100),
    ],
    electives: [
      groove('cha-cha', 100), groove('afrobeat', 100), groove('second-line', 100),
      groove('mambo', 80), groove('tribal-techno', 100), groove('detroit', 100),
      groove('afro-cuban-68', 100),
      hands('eleven-stroke-roll', 80), hands('thirteen-stroke-roll', 80),
      hands('fifteen-stroke-roll', 80), hands('seventeen-stroke-roll', 80),
    ],
    checkpoint: groove('songo', 90, { top: true, alt: ['afrobeat', 'tribal-techno'] }),
  },
  {
    key: 's6', name: 'Pro', card: 'stage-6',
    core: [
      time('odd:5-4', 100, { card: 'odd-meters' }),
      time('odd:7-8a', 100),
      time('odd:7-8b', 100),
      groove('groove-5-4', 100),
      groove('groove-7-8', 100),
      hands('group:3', 100, { dyn: 80, card: 'groupings' }),
      hands('group:5', 100, { dyn: 80 }),
      groove('displace:rock-backbeat:1', 100, { card: 'displacement' }),
      groove('displace:rock-backbeat:2', 100),
      time('poly:4:3', 100),
      time('clock:off', 100, { card: 'offbeat-click' }),
      time('clock:bar', 100),
      groove('feel:behind', 100, { card: 'feel' }),
      groove('feel:ahead', 100),
      groove('drum-and-bass', 100),
      groove('hard-techno', 100),
      groove('dubstep', 100),
      groove('uptempo-swing', 100),
      hands('pataflafla', 100), hands('inverted-flam-tap', 100), hands('flam-drag', 100),
      hands('flam-paradiddle-diddle', 100), hands('single-flammed-mill', 100),
      hands('single-dragadiddle', 100), hands('drag-paradiddle-1', 100),
      hands('drag-paradiddle-2', 100), hands('double-ratamacue', 100),
      hands('triple-ratamacue', 100),
      quiz('echo', 'mixed'),
      quiz('pick', 'drift'),
    ],
    electives: [hands('single-stroke-roll', 120), hands('double-stroke-roll', 120)],
    checkpoint: groove('drum-and-bass', 100, { top: true, alt: ['hard-techno', 'uptempo-swing'] }),
  },
];

/* ---- Building it ---------------------------------------------------------- */

/* A quiz step's id is the id its rounds are recorded under. */
export function quizItemId(drill, variant = '') {
  return `quiz:${drill.mode}:${drill.kind}${variant ? `:${variant}` : ''}`;
}

const POOL_NAMES = { kit3: 'kick, snare, hat', qe: '4ths, 8ths', qes: '4ths-16ths' };

function quizStep(spec) {
  const drill = DRILLS.find((d) => d.mode === spec.quiz.mode && d.kind === spec.quiz.kind);
  if (!drill) return null;
  const v = spec.quiz.variant;
  const label = v ? `${drill.name} (${POOL_NAMES[v] || v})` : drill.name;
  return { id: quizItemId(drill, v), label, quiz: drill, variant: v, pool: QUIZ_POOLS[v] || null };
}

/* The rungs of a groove as steps, or the drill itself when it has none. */
function grooveRungs(chart, spec) {
  const levels = availableLevels(chart);
  if (levels.length <= 1) return [{ id: chart.id, label: chart.name }];
  const out = levels.map((lv, i) => ({
    id: `${chart.id}:${lv.id}`,
    label: `${lv.step} ${lv.label}`,
    title: `${chart.name} ${lv.step}`,
    rung: i,
    top: i === levels.length - 1,
  }));
  return spec.top ? [out[out.length - 1]] : out;
}

/*
 * One spec as the steps it stands for, or null when nothing it names is
 * installed: a groove becomes its rungs, a quiz its pooled item. `has` says
 * whether a plain drill id is in the tree.
 */
function resolve(spec, ctx) {
  const ids = [spec.groove || spec.id].concat(spec.alt || []);
  const options = [];
  for (const id of ids) {
    let steps = null;
    let style = '';
    if (spec.quiz) {
      const q = quizStep(spec);
      steps = q ? [q] : null;
    } else if (ctx.charts[id]) {
      steps = spec.groove ? grooveRungs(ctx.charts[id], spec) : [{ id, label: ctx.charts[id].name }];
      style = ctx.styles[id] || '';
    } else if (ctx.has(id)) {
      steps = [{ id, label: ctx.label(id) }];
      if (spec.wrap && id === 'clock') steps[0].wrap = spec.wrap;
    }
    if (steps) options.push({ id, style, steps });
    if (spec.quiz) break;
  }
  return options.length ? options : null;
}

let keySeq = 0;
function makeSteps(spec, option, stage, part) {
  const target = Math.min(MAX_TARGET, spec.t || LEARNED);
  return option.steps.map((st) => ({
    ...st,
    key: `${stage.key}:${part}:${st.id}@${target}#${keySeq++}`,
    track: spec.track,
    target,
    dyn: spec.dyn || 0,
    style: option.style,
    cards: [].concat(spec.card || []),
    stage: stage.key,
    part,
    title: st.title || st.label,
  }));
}

/*
 * The whole path, from what is installed.
 *   entries   [{ chart, category }] as catalog.mjs takes them
 *   has(id)   whether a generated drill, the Clock or another leaf exists
 *   label(id) what that leaf is called
 * A groove the table does not name — one from user.json — joins the last
 * stage's electives, so it is on the path without pretending to a place.
 */
export function buildProgram({ entries = [], categories = [], has = () => false, label = (id) => id } = {}) {
  keySeq = 0;
  const charts = {};
  const styles = {};
  for (const e of entries) {
    charts[e.chart.id] = e.chart;
    styles[e.chart.id] = e.category;
  }
  const ctx = { charts, styles, has, label };
  const named = new Set();
  const stages = STAGES.map((spec, index) => {
    const stage = { key: spec.key, name: spec.name, card: spec.card, index };
    const build = (list, part) => {
      const out = [];
      for (const s of list) {
        const options = resolve(s, ctx);
        if (!options) continue;
        named.add(s.groove || s.id);
        /* The first option is the step; the rest stand in for it (pick). */
        out.push({ spec: s, options: options.map((o) => ({ ...o, steps: makeSteps(s, o, stage, part) })) });
      }
      return out;
    };
    stage.core = build(spec.core, 'core');
    stage.electives = build(spec.electives, 'elective');
    stage.checkpoint = build([spec.checkpoint], 'checkpoint')[0] || null;
    return stage;
  });
  const last = stages[stages.length - 1];
  const grooveCats = new Set(categories.filter((c) => c.folder === 'Grooves').map((c) => c.id));
  for (const e of entries) {
    if (named.has(e.chart.id) || !grooveCats.has(e.category)) continue;
    const s = groove(e.chart.id, 100);
    const options = resolve(s, ctx);
    if (options) {
      last.electives.push({ spec: s, options: options.map((o) => ({ ...o, steps: makeSteps(s, o, last, 'elective') })) });
    }
  }
  return { stages, tracks: TRACKS };
}

/* ---- Reading it ----------------------------------------------------------- */

const prefsOf = (progress) => progress.path || {};
const styleOn = (prefs, style) => !style || !prefs.styles || prefs.styles[style] !== false;
const trackOn = (prefs, track) => !prefs.tracks || prefs.tracks[track] !== false;

/* The option a slot stands for under the learner's styles: the first whose
 * style is on, or the first at all when none is. */
function pick(slot, prefs) {
  for (const o of slot.options) if (styleOn(prefs, o.style)) return o;
  return slot.options[0];
}

/* Every step a list of slots holds, as the learner's choices resolve them. */
function stepsOf(slots, prefs) {
  const out = [];
  for (const slot of slots) for (const st of pick(slot, prefs).steps) out.push(st);
  return out;
}

/*
 * Whether a step is done: its drill clean at the step's target, or better.
 * A groove's higher rung carries the lower ones — if you can play everything
 * at that speed you can play the cymbals alone at it — and a ✓ (clean at
 * 100%) covers every target up to it. L0 and a quiz have their own ✓.
 */
export function stepDone(progress, step) {
  if (step.quiz) return isDone(progress, step.id);
  const ids = [step.id];
  const m = LEVEL_ID_RE.exec(step.id);
  if (m) {
    const base = step.id.slice(0, -m[0].length);
    for (let n = Number(m[1]) + 1; n <= 4; n++) ids.push(`${base}:l${n}`);
  }
  /* L0 asks whether you know the notes: its own ✓, or any rung above it
   * played clean, at any speed. */
  if (isUntimedId(step.id)) {
    return isDone(progress, step.id) || ids.slice(1).some((id) => (item(progress, id) || {}).best > 0);
  }
  for (const id of ids) {
    const it = item(progress, id);
    if (!it) continue;
    const fast = it.best >= step.target || (step.target <= LEARNED && it.done);
    if (fast && dynOk(progress, step, id)) return true;
  }
  return false;
}

function dynOk(progress, step, id) {
  if (!step.dyn) return true;
  const it = item(progress, id);
  return Boolean(it && it.dyn >= step.dyn);
}

export function stepSkipped(progress, step) {
  const it = item(progress, step.id);
  return Boolean(it && it.skip);
}

function open(progress, step, atMs) {
  return !stepDone(progress, step) && !stepSkipped(progress, step) && !isParked(progress, step.id, atMs);
}

/* What a step needs to be counted as part of its stage under the prefs: a
 * track that is on, a style that is on (after its alternatives were tried),
 * and with the short ladder only a groove's first and last rungs. A stage's
 * idea is in several of its grooves, so dropping a style never empties it. */
function required(prefs, step) {
  if (!trackOn(prefs, step.track)) return false;
  if (!styleOn(prefs, step.style)) return false;
  if (prefs.rungs === 'short' && step.rung > 0 && !step.top) return false;
  return true;
}

/* A stage's required core steps, in table order. */
export function coreSteps(stage, prefs = {}) {
  return stepsOf(stage.core, prefs).filter((st) => required(prefs, st));
}

export function checkpointSteps(stage, prefs = {}) {
  return stage.checkpoint ? stepsOf([stage.checkpoint], prefs) : [];
}

export function electiveSteps(stage, prefs = {}) {
  return stepsOf(stage.electives, prefs);
}

/*
 * A stage is through when its checkpoint is passed — the music proves it,
 * and that is how someone who can already play tests out — or when every
 * core step the learner asked for is done or skipped.
 */
export function stageComplete(progress, stage) {
  const prefs = prefsOf(progress);
  const cp = checkpointSteps(stage, prefs);
  if (cp.length && cp.every((st) => stepDone(progress, st))) return true;
  return coreSteps(stage, prefs).every((st) => stepDone(progress, st) || stepSkipped(progress, st));
}

/* The stage the learner is in: the first not through, from where they chose
 * to start. Null when every stage from there is through. */
export function currentStage(progress, program) {
  const start = Math.min(prefsOf(progress).start || 0, program.stages.length - 1);
  for (let i = start; i < program.stages.length; i++) {
    if (!stageComplete(progress, program.stages[i])) return program.stages[i];
  }
  return null;
}

/* When a track was last practised, by any of its steps, in unix seconds. */
function trackActivity(progress, program, track) {
  let latest = 0;
  for (const stage of program.stages) {
    for (const st of coreSteps(stage, {}).concat(electiveSteps(stage, {}))) {
      if (st.track !== track) continue;
      const it = item(progress, st.id);
      if (it && it.t > latest) latest = it.t;
    }
  }
  return latest;
}

/*
 * Continue: in the current stage, the next open core step of the track left
 * longest (ties to the earlier track, so a first session walks Time, Hands,
 * Grooves and Ear in turn); the checkpoint once the core is through. `except`
 * leaves one step out — the one just played, when Click moves on.
 * Returns { stage, step } or null when the whole path is through.
 */
export function continueStep(progress, program, atMs = Date.now(), except = '') {
  const prefs = prefsOf(progress);
  const stage = currentStage(progress, program);
  if (!stage) return null;
  const core = coreSteps(stage, prefs).filter((st) => st.key !== except && open(progress, st, atMs));
  let best = null;
  let bestAt = Infinity;
  for (const t of TRACKS) {
    const step = core.find((st) => st.track === t.key);
    if (!step) continue;
    const at = trackActivity(progress, program, t.key);
    if (at < bestAt) {
      best = step;
      bestAt = at;
    }
  }
  if (best) return { stage, step: best };
  const cp = checkpointSteps(stage, prefs).find((st) => st.key !== except && !stepDone(progress, st));
  if (cp) return { stage, step: cp };
  /* Everything open is parked: offer the parked step rather than nothing. */
  const parked = coreSteps(stage, prefs).find((st) => st.key !== except
    && !stepDone(progress, st) && !stepSkipped(progress, st));
  return parked ? { stage, step: parked } : null;
}

/*
 * On from a step, for Click on a result: the next open step of the same
 * track in the same stage — so a result never opens the drill just played —
 * else whatever Continue would offer next.
 */
export function stepAfter(progress, program, step, atMs = Date.now()) {
  if (!step) return null;
  const prefs = prefsOf(progress);
  const stage = program.stages.find((s) => s.key === step.stage);
  if (stage && step.part !== 'checkpoint') {
    const list = step.part === 'elective' ? electiveSteps(stage, prefs) : coreSteps(stage, prefs);
    const at = list.findIndex((st) => st.key === step.key);
    for (let k = 1; k < list.length; k++) {
      const st = list[(at + k) % list.length];
      if (st.track === step.track && open(progress, st, atMs)) return st;
    }
  }
  const next = continueStep(progress, program, atMs, step.key);
  return next ? next.step : null;
}

/* The first open step of a list, for a scoped "Skip:" row. */
export function nextOpen(progress, steps, atMs = Date.now()) {
  return steps.find((st) => open(progress, st, atMs)) || null;
}

export function findStep(program, key) {
  for (const stage of program.stages) {
    const all = allSteps(stage);
    const st = all.find((x) => x.key === key);
    if (st) return st;
  }
  return null;
}

/* Every step of a stage, every option — the folder shows them all. */
function allSteps(stage) {
  const out = [];
  for (const slot of stage.core.concat(stage.electives, stage.checkpoint ? [stage.checkpoint] : [])) {
    for (const o of slot.options) for (const st of o.steps) out.push(st);
  }
  return out;
}

/* The ids a track counts in the Progress overview: every step of it, once. */
export function trackIds(program, track) {
  const ids = new Set();
  for (const stage of program.stages) {
    for (const st of coreSteps(stage, {})) if (!track || st.track === track) ids.add(st.id);
  }
  return [...ids];
}

/* What a step is called on its own, outside its folder. */
export function stepTitle(step) {
  return step.title || step.label;
}

/*
 * How long the learner has been stuck on a step, from its takes: 0, 1 after
 * SUGGEST_AFTER failed takes in a row (the result suggests the easier way
 * in), 2 after PARK_AFTER (the path parks it for a day).
 */
export const SUGGEST_AFTER = 3;
export const PARK_AFTER = 6;
export function stuckLevel(failStreak) {
  if (failStreak >= PARK_AFTER) return 2;
  if (failStreak >= SUGGEST_AFTER) return 1;
  return 0;
}

/* Done and total over a list of steps, for a folder's value. */
export function stepsSummary(progress, steps) {
  let done = 0;
  let played = 0;
  for (const st of steps) {
    if (stepDone(progress, st)) done++;
    const it = item(progress, st.id);
    if (it && it.plays) played++;
  }
  return { count: steps.length, done, played };
}

/* ---- As rows of the drill list -------------------------------------------- */

/* A step as a row: a leaf under its drill's id, so it is summed and marked
 * wherever it appears, with the step to say at what target. */
export function stepRow(step) {
  return { label: step.label, value: '', id: step.id, step };
}

/* A groove's rungs share a folder, so a stage lists grooves, not rungs; a
 * groove with a single step here (a checkpoint's top rung) is a row of its own. */
const baseOf = (id) => {
  const m = LEVEL_ID_RE.exec(id);
  return m ? id.slice(0, -m[0].length) : id;
};

function stepRows(steps) {
  const groups = new Map();
  for (const st of steps) {
    if (st.rung === undefined) continue;
    const b = baseOf(st.id);
    groups.set(b, (groups.get(b) || []).concat(st));
  }
  const rows = [];
  const placed = new Set();
  for (const st of steps) {
    if (st.rung === undefined) {
      rows.push(stepRow(st));
      continue;
    }
    const b = baseOf(st.id);
    if (placed.has(b)) continue;
    placed.add(b);
    const g = groups.get(b);
    if (g.length === 1) {
      rows.push({ ...stepRow(st), label: stepTitle(st) });
      continue;
    }
    const name = st.title.slice(0, st.title.lastIndexOf(' '));
    rows.push({ label: name, value: '>', steps: g,
      children: [{ label: 'Skip all here', value: '', skipAllRow: true, scope: g }, ...g.map(stepRow)] });
  }
  return rows;
}

function scopedRows(steps) {
  return [
    { label: 'Skip next', value: '', skipRow: true, scope: steps },
    { label: 'Skip all here', value: '', skipAllRow: true, scope: steps },
  ];
}

function stageFolder(stage) {
  const core = stepsOf(stage.core, {});
  const children = [...scopedRows(core)];
  const cp = checkpointSteps(stage, {});
  if (cp.length) children.push({ ...stepRow(cp[0]), label: `Checkpoint: ${stepTitle(cp[0])}`, checkpoint: true });
  children.push({ label: 'Lessons', value: '', lessonsRow: true, stage });
  for (const t of TRACKS) {
    const steps = core.filter((st) => st.track === t.key);
    if (!steps.length) continue;
    children.push({ label: t.name, value: '>', trackKey: t.key, steps,
      children: [...scopedRows(steps), ...stepRows(steps)] });
  }
  const el = electiveSteps(stage, {});
  if (el.length) children.push({ label: 'Electives', value: '>', steps: el, electives: true, children: stepRows(el) });
  return { label: `${stage.index} ${stage.name}`, value: '>', stage, steps: core, children };
}

const pref = (label, group, key) => ({ label, value: '', prefRow: true, group, key });

function pathFolder() {
  return {
    label: 'Your path',
    value: '>',
    untracked: true,
    children: [
      { label: 'Tracks', value: '>', untracked: true,
        children: TRACKS.map((t) => pref(t.name, 'tracks', t.key)) },
      { label: 'Styles', value: '>', untracked: true, styleRows: true, children: [] },
      pref('Rungs', 'rungs', ''),
      pref('Start at', 'start', ''),
      pref('Intros', 'intros', ''),
    ],
  };
}

/*
 * The Learning Path folder. Continue, Skip, the path's settings and
 * Repetition are rows ui.js gives meaning to; Repetition's rows depend on the
 * day, so the caller supplies them as a function and the folder sums leave
 * them out. `styles` are the groove families, for the Styles rows.
 */
export function programFolder(program, repetitionRows = () => [], styles = []) {
  const yours = pathFolder();
  yours.children[1].children = styles.map((c) => pref(c.name, 'styles', c.id));
  return {
    label: 'Learning Path',
    value: '>',
    /* Its rows point back into the tree rather than holding drills. */
    pointers: true,
    children: [
      { label: 'Continue', value: '', continueRow: true },
      { label: 'Skip next', value: '', skipRow: true },
      yours,
      ...program.stages.map(stageFolder),
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
