import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/guess.mjs';
import { voiceChoices, subdivChoices, grooveChoices, shuffle } from '../src/choices.mjs';
import { rng } from '../src/rng.mjs';
import { VOICE_IDS } from '../src/kit.mjs';

test('distractors are the things you would actually confuse', () => {
  /* Three options where two are absurd is a quiz you pass by elimination
   * without ever hearing the answer. */
  const v = voiceChoices('SN');
  assert.equal(v[0], 'SN');
  assert.equal(v.length, 3);
  assert.ok(v.includes('HT') && v.includes('LT'), 'the drums either side of it');
  assert.ok(!v.includes('CR'), 'a crash is not a near miss for a snare');

  const s = subdivChoices('triplets');
  assert.deepEqual(s.sort(), ['eighths', 'sixteenths', 'triplets']);
});

test('groove distractors have a similar feel, not a random one', () => {
  const charts = [
    { id: 'a', name: 'A', events: new Array(4) },
    { id: 'b', name: 'B', events: new Array(5) },
    { id: 'c', name: 'C', events: new Array(40) },
  ];
  const g = grooveChoices('a', charts);
  assert.equal(g[0], 'a');
  assert.ok(g.includes('b'), 'the closest in density must be offered');
});

test('the shuffle is deterministic for a seed', () => {
  const a = shuffle([1, 2, 3, 4, 5], rng(9));
  const b = shuffle([1, 2, 3, 4, 5], rng(9));
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice().sort(), [1, 2, 3, 4, 5], 'nothing lost or duplicated');
});

test('a wrong answer costs time, not accuracy, and the prompt stays', () => {
  /* The way a typing test treats a typo: a round is always exactly N correct
   * answers, so mashing pads cannot skip a prompt you have not learned. */
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 3, seed: 4 });
  const answer = q.prompt;
  const wrong = VOICE_IDS.find((v) => v !== answer && v !== 'HF');
  assert.equal(Q.pressVoice(q, wrong, 100), 'wrong');
  assert.equal(q.prompt, answer, 'the question must stay until you get it');
  assert.equal(q.correct, 0);
  assert.equal(q.wrong, 1);
  assert.equal(Q.pressVoice(q, answer, 200), 'right');
  assert.equal(q.correct, 1);
});

test('the clock starts on the first press, not when the screen appears', () => {
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 2, seed: 4 });
  assert.equal(Q.roundElapsed(q, 5000), 0, 'orientation is not part of the score');
  Q.pressVoice(q, q.prompt, 1000);
  assert.equal(Q.roundElapsed(q, 2000), 1000);
});

test('a round ends at exactly N correct and freezes the clock', () => {
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 2, seed: 4 });
  Q.pressVoice(q, q.prompt, 1000);
  Q.advance(q);
  assert.equal(Q.roundComplete(q), false);
  Q.pressVoice(q, q.prompt, 3000);
  assert.equal(Q.roundComplete(q), true);
  assert.equal(Q.roundElapsed(q, 99999), 2000, 'the clock stopped when the round did');
  assert.ok(Math.abs(Q.ratePerMinute(q, 99999) - 60) < 1e-6);
});

test('an endless round records nothing and never completes', () => {
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 0, seed: 4 });
  for (let i = 0; i < 30; i++) { Q.pressVoice(q, q.prompt, i * 100); Q.advance(q); }
  assert.equal(Q.roundComplete(q), false);
});

test('picking eliminates a wrong option rather than moving on', () => {
  const q = Q.createQuiz({ kind: 'subdiv', mode: 'pick', roundSize: 3, seed: 2 });
  const wrongIdx = q.options.findIndex((o) => o !== q.prompt);
  q.choice = wrongIdx;
  assert.equal(Q.pickChoice(q, 100), 'wrong');
  assert.equal(Q.isEliminated(q, wrongIdx), true);
  assert.notEqual(q.choice, wrongIdx, 'the highlight must leave a dead option');
});

test('the jog skips over eliminated options', () => {
  const q = Q.createQuiz({ kind: 'subdiv', mode: 'pick', roundSize: 3, seed: 2 });
  q.eliminated = [1];
  q.choice = 0;
  Q.moveChoice(q, 1);
  assert.notEqual(q.choice, 1);
});

test('help is two deep and depends on what the drill withholds', () => {
  const hear = Q.createQuiz({ kind: 'voice', mode: 'hear', seed: 1 });
  assert.equal(Q.takeHint(hear), 'name');
  assert.equal(Q.takeHint(hear), 'light');
  assert.equal(Q.takeHint(hear), null, 'and no deeper');
  assert.equal(Q.hintsLeft(hear), 0);

  const guess = Q.createQuiz({ kind: 'voice', mode: 'guess', seed: 1 });
  assert.equal(Q.takeHint(guess), 'sound');

  const pick = Q.createQuiz({ kind: 'subdiv', mode: 'pick', seed: 1 });
  assert.equal(Q.takeHint(pick), 'eliminate');
  assert.equal(pick.eliminated.length, 1);
});

test('a hint never eliminates the right answer', () => {
  for (let seed = 1; seed < 20; seed++) {
    const q = Q.createQuiz({ kind: 'subdiv', mode: 'pick', seed });
    Q.takeHint(q);
    Q.takeHint(q);
    for (const i of q.eliminated) assert.notEqual(q.options[i], q.prompt, `seed ${seed}`);
  }
});

test('a hinted answer still counts and keeps the streak', () => {
  /* A hint you are afraid to use is a hint that does not help you learn. */
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 3, seed: 5 });
  Q.pressVoice(q, q.prompt, 100);
  Q.advance(q);
  Q.takeHint(q);
  Q.pressVoice(q, q.prompt, 200);
  assert.equal(q.streak, 2, 'the streak survives a hint');
  assert.equal(q.hintsTaken, 1, 'but the round remembers it');
});

test('every declared drill builds and prompts', () => {
  for (const d of Q.DRILLS) {
    const q = Q.createQuiz({
      kind: d.kind, mode: d.mode, seed: 3,
      charts: [{ id: 'g1', name: 'G1', events: [1] }, { id: 'g2', name: 'G2', events: [1, 2] },
               { id: 'g3', name: 'G3', events: [1, 2, 3] }],
    });
    assert.ok(q.prompt, `${d.name} has no prompt`);
    assert.ok(Q.labelFor(q, q.prompt), `${d.name} cannot name its prompt`);
    if (d.mode === 'pick') {
      assert.ok(q.options.includes(q.prompt), `${d.name} omitted the right answer`);
      assert.equal(new Set(q.options).size, q.options.length, `${d.name} repeated an option`);
    }
    assert.ok(Q.quizDrillId(q).includes(d.kind));
  }
});

test('error rate is wrong over attempts, so round sizes compare', () => {
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 10, seed: 6 });
  const wrong = VOICE_IDS.find((v) => v !== q.prompt && v !== 'HF');
  Q.pressVoice(q, wrong, 10);
  Q.pressVoice(q, q.prompt, 20);
  assert.equal(Q.errorFraction(q), 0.5);
});

test('an answered prompt stops scoring until the next one arrives', () => {
  /*
   * A voice sits on several pads, so a flurry across the grid would otherwise
   * score the same answer two or three times — and a round of twenty would
   * finish having asked seven questions.
   */
  const q = Q.createQuiz({ kind: 'voice', mode: 'guess', roundSize: 20, seed: 11 });
  assert.equal(Q.pressVoice(q, q.prompt, 100), 'right');
  assert.equal(q.correct, 1);
  assert.equal(Q.pressVoice(q, q.prompt, 110), 'ignored', 'the same answer scored twice');
  assert.equal(Q.pressVoice(q, 'KK', 120), 'ignored', 'a wrong press counted after the answer');
  assert.equal(q.correct, 1);
  assert.equal(q.wrong, 0);

  Q.advance(q);
  assert.equal(q.revealed, false, 'the next prompt arrived already answered');
  assert.notEqual(Q.pressVoice(q, q.prompt, 130), 'ignored');
});

test('the same is true of picking', () => {
  const q = Q.createQuiz({ kind: 'subdiv', mode: 'pick', roundSize: 20, seed: 3 });
  q.choice = q.options.indexOf(q.prompt);
  assert.equal(Q.pickChoice(q, 100), 'right');
  assert.equal(Q.pickChoice(q, 110), 'ignored');
  assert.equal(q.correct, 1);
});
