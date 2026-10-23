// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * guess.mjs — the quiz engine: rounds, prompts, hints and scoring. Pure.
 *
 * Three shapes, the same three the pitched module settled on, because they
 * isolate three different skills:
 *
 *   guess  notation -> pad.  Reading the legend. Which line is the tom?
 *   hear   sound    -> pad.  Telling the kit apart by ear.
 *   pick   sound    -> name. Naming what you heard, with no pad to grope at.
 *
 * `pick` runs the other way round from the other two and is the only drill
 * you can do without playing anything, which is why it is the one that
 * survives a room where you cannot make noise.
 *
 * A prompt WAITS until you get it right, so a round is always exactly N
 * correct answers and a wrong answer costs you time rather than needing a
 * penalty of its own — the way a typing test treats a typo.
 */

import { rng } from './rng.mjs';
import { CORE_VOICES, voiceById } from './kit.mjs';
import { voiceChoices, subdivChoices, grooveChoices,
         voiceLabel, subdivLabel, SUBDIV_ORDER } from './choices.mjs';
import { MAX_ANSWERS } from './answer_pads.mjs';

export const MAX_HINTS = 2;

/*
 * Which combinations exist, and why the others do not.
 *
 * A subdivision has no notation you could be asked to read that would not
 * give the answer away — the notation IS the subdivision — so `guess:subdiv`
 * cannot exist. Same for a groove. Both are therefore ear-only.
 */
export const DRILLS = [
  { kind: 'voice',  mode: 'guess', name: 'Guess: drum' },
  { kind: 'voice',  mode: 'hear',  name: 'Hear: drum' },
  { kind: 'voice',  mode: 'pick',  name: 'Pick: drum' },
  { kind: 'subdiv', mode: 'pick',  name: 'Hear: subdivision' },
  { kind: 'groove', mode: 'pick',  name: 'Pick: groove' },
];

export function createQuiz(opts = {}) {
  const quiz = {
    kind: opts.kind || 'voice',
    mode: opts.mode || 'guess',
    /* The kit a beat is made of, not all twenty-one sounds: the drums a
     * beginner meets first, and the ones every drill is written in. */
    pool: opts.pool || CORE_VOICES.filter((v) => v !== 'HF'),
    /* The subdivisions asked about: all of them, or the ones a stage of the
     * Path has taught so far. */
    subdivs: opts.subdivs || SUBDIV_ORDER,
    /* A pooled quiz is its own exercise, filed under its own id. */
    variant: opts.variant || '',
    charts: opts.charts || [],
    roundSize: opts.roundSize === undefined ? 20 : opts.roundSize,
    rand: rng(opts.seed || 1),
    prompt: null,
    options: [],
    choice: 0,
    eliminated: [],
    hints: 0,
    hintsTaken: 0,
    /* Questions answered right only after a hint: right, but not known. */
    hinted: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    startedMs: 0,
    finishedMs: 0,
    revealed: false,
  };
  nextPrompt(quiz);
  return quiz;
}

function poolFor(quiz) {
  if (quiz.kind === 'subdiv') return quiz.subdivs;
  if (quiz.kind === 'groove') return quiz.charts.map((c) => c.id);
  return quiz.pool;
}

/*
 * THE ANSWERS STAY WHERE THEY ARE. Once you know which pad means "triplets",
 * you can answer without looking, so a drill never moves an answer while it
 * runs (Piano Practice's ear drills work the same way). When the drill's
 * whole set fits the answer bar, every question offers all of it, in the
 * set's own order. Only a set too big for the bar falls back to the near
 * misses, and even those keep the set's order rather than a shuffled one.
 */
function optionsFor(quiz, pool, answer) {
  if (pool.length <= MAX_ANSWERS) return pool.slice();
  let near;
  if (quiz.kind === 'subdiv') near = subdivChoices(answer, 2, quiz.subdivs);
  else if (quiz.kind === 'groove') near = grooveChoices(answer, quiz.charts);
  else near = voiceChoices(answer, quiz.pool);
  return pool.filter((id) => near.includes(id));
}

export function nextPrompt(quiz) {
  const pool = poolFor(quiz);
  if (!pool.length) return quiz;
  const answer = pool[Math.floor(quiz.rand() * pool.length)];
  quiz.prompt = answer;
  quiz.hints = 0;
  quiz.eliminated = [];
  quiz.revealed = false;
  quiz.choice = 0;
  if (quiz.mode === 'pick') quiz.options = optionsFor(quiz, pool, answer);
  else {
    quiz.options = [];
  }
  return quiz;
}

function score(quiz, right, nowMs) {
  if (quiz.startedMs === 0) quiz.startedMs = nowMs;
  if (right) {
    quiz.correct++;
    quiz.streak++;
    if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
    quiz.hintsTaken += quiz.hints;
    if (quiz.hints > 0) quiz.hinted++;
    if (roundComplete(quiz)) quiz.finishedMs = nowMs;
  } else {
    quiz.wrong++;
    quiz.streak = 0;
  }
}

/*
 * A pad went down, in `guess` and `hear`. Returns 'right' | 'wrong'.
 *
 * A wrong answer is counted once and the question STAYS until you get it —
 * so mashing pads costs time, not accuracy, and cannot be used to skip a
 * prompt you have not learned.
 */
export function pressVoice(quiz, voice, nowMs = 0) {
  if (quiz.mode === 'pick') return 'ignored';
  /*
   * Once it is answered, further presses do nothing until the next prompt
   * arrives. A voice sits on several pads, so a flurry across the grid would
   * otherwise score the same answer two or three times — and the round would
   * finish having asked a third of the questions it claimed to.
   */
  if (quiz.revealed) return 'ignored';
  const right = voice === quiz.prompt;
  score(quiz, right, nowMs);
  if (right) {
    quiz.revealed = true;
    return 'right';
  }
  return 'wrong';
}

export function moveChoice(quiz, delta) {
  if (quiz.mode !== 'pick' || !quiz.options.length) return quiz;
  const n = quiz.options.length;
  let i = quiz.choice;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    if (!quiz.eliminated.includes(i)) break;
  }
  quiz.choice = i;
  return quiz;
}

export function pickChoice(quiz, nowMs = 0) {
  if (quiz.mode !== 'pick' || !quiz.options.length) return 'ignored';
  if (quiz.revealed) return 'ignored';
  const right = quiz.options[quiz.choice] === quiz.prompt;
  score(quiz, right, nowMs);
  if (right) {
    quiz.revealed = true;
    return 'right';
  }
  if (!quiz.eliminated.includes(quiz.choice)) quiz.eliminated.push(quiz.choice);
  moveChoice(quiz, 1);
  return 'wrong';
}

/*
 * An answer chosen by its pad (answer_pads.mjs) rather than by the jog. The
 * same as turning to it and clicking, so a pad and the jog can never judge
 * differently; a struck-out answer cannot be chosen at all.
 */
export function pickAt(quiz, index, nowMs = 0) {
  if (quiz.mode !== 'pick' || index < 0 || index >= quiz.options.length) return 'ignored';
  if (quiz.revealed || quiz.eliminated.includes(index)) return 'ignored';
  quiz.choice = index;
  return pickChoice(quiz, nowMs);
}

/*
 * Help, two presses deep, and what each press does depends on what the drill
 * is withholding.
 *
 *   hear   1: name it, pads still dark   2: light the pad
 *   guess  1: sound it                   2: light the pad
 *   pick   1: strike out one wrong option 2: strike out the other
 *
 * A hinted answer still counts and keeps the streak — a hint you are afraid
 * to use is a hint that does not help you learn — but the round records how
 * many were taken and the result screen shows it.
 */
export function takeHint(quiz) {
  if (quiz.hints >= MAX_HINTS) return null;
  quiz.hints++;
  if (quiz.mode === 'pick') {
    for (let i = 0; i < quiz.options.length; i++) {
      if (quiz.options[i] !== quiz.prompt && !quiz.eliminated.includes(i)) {
        quiz.eliminated.push(i);
        if (quiz.choice === i) moveChoice(quiz, 1);
        break;
      }
    }
    return 'eliminate';
  }
  if (quiz.hints === 1) return quiz.mode === 'hear' ? 'name' : 'sound';
  return 'light';
}

export function hintsLeft(quiz) {
  return MAX_HINTS - quiz.hints;
}

export function advance(quiz) {
  if (roundComplete(quiz)) return quiz;
  return nextPrompt(quiz);
}

export function roundComplete(quiz) {
  return quiz.roundSize > 0 && quiz.correct >= quiz.roundSize;
}

export function roundProgress(quiz) {
  return quiz.roundSize > 0 ? `${quiz.correct}/${quiz.roundSize}` : `${quiz.correct}`;
}

export function roundElapsed(quiz, nowMs = 0) {
  if (quiz.startedMs === 0) return 0;
  return (quiz.finishedMs || nowMs) - quiz.startedMs;
}

/* Correct answers per minute — the score, as in the pitched module. */
export function ratePerMinute(quiz, nowMs = 0) {
  const ms = roundElapsed(quiz, nowMs);
  if (ms <= 0) return 0;
  return (quiz.correct / ms) * 60000;
}

export function errorFraction(quiz) {
  const attempts = quiz.correct + quiz.wrong;
  return attempts === 0 ? 0 : quiz.wrong / attempts;
}

export function labelFor(quiz, id) {
  if (quiz.kind === 'subdiv') return subdivLabel(id);
  if (quiz.kind === 'groove') {
    const c = quiz.charts.find((x) => x.id === id);
    return c ? c.name : id;
  }
  return voiceLabel(id);
}

/*
 * A name of two characters for an answer cell, when the answers are drawn as
 * the pads they sit on rather than as a list: KK and SN for drums, the note
 * value for a subdivision, the first two letters of a groove.
 */
const SUBDIV_SHORT = { quarters: '4', eighths: '8', triplets: '3', sixteenths: '16', sextuplets: '6' };

export function shortFor(quiz, id) {
  if (quiz.kind === 'subdiv') return SUBDIV_SHORT[id] || subdivLabel(id).slice(0, 2);
  if (quiz.kind === 'groove') return labelFor(quiz, id).replace(/\s+/g, '').slice(0, 2);
  const v = voiceById(id);
  return v ? v.short : String(id).slice(0, 2);
}

export function isEliminated(quiz, i) {
  return quiz.eliminated.includes(i);
}

/* The drill id a round is recorded against. */
export function quizDrillId(quiz) {
  return `${quiz.mode}:${quiz.kind}${quiz.variant ? `:${quiz.variant}` : ''}`;
}
