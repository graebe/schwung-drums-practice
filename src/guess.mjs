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
import { VOICE_IDS } from './kit.mjs';
import { voiceChoices, subdivChoices, grooveChoices, shuffle,
         voiceLabel, subdivLabel, SUBDIV_ORDER } from './choices.mjs';

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
    pool: opts.pool || VOICE_IDS.filter((v) => v !== 'HF'),
    charts: opts.charts || [],
    roundSize: opts.roundSize === undefined ? 20 : opts.roundSize,
    rand: rng(opts.seed || 1),
    prompt: null,
    options: [],
    choice: 0,
    eliminated: [],
    hints: 0,
    hintsTaken: 0,
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
  if (quiz.kind === 'subdiv') return SUBDIV_ORDER;
  if (quiz.kind === 'groove') return quiz.charts.map((c) => c.id);
  return quiz.pool;
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
  if (quiz.mode === 'pick') {
    let opts;
    if (quiz.kind === 'subdiv') opts = subdivChoices(answer);
    else if (quiz.kind === 'groove') opts = grooveChoices(answer, quiz.charts);
    else opts = voiceChoices(answer, quiz.pool);
    quiz.options = shuffle(opts, quiz.rand);
  } else {
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

export function isEliminated(quiz, i) {
  return quiz.eliminated.includes(i);
}

/* The drill id a round is recorded against. */
export function quizDrillId(quiz) {
  return `${quiz.mode}:${quiz.kind}`;
}
