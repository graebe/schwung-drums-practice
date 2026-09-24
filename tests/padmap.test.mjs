import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/padmap.mjs';
import { VOICE_IDS } from '../src/kit.mjs';

test('the grid covers 32 pads, four rows of eight', () => {
  assert.equal(P.PAD_LAST - P.PAD_FIRST + 1, P.PAD_COUNT);
  for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
    const { row, col } = P.padRowCol(pad);
    assert.ok(row >= 0 && row < P.ROWS);
    assert.ok(col >= 0 && col < P.COLS);
    assert.equal(P.padAt(row, col), pad);
  }
  assert.equal(P.isPad(67), false);
  assert.equal(P.isPad(100), false);
});

test('the hand split is the left half of the grid', () => {
  for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
    const { col } = P.padRowCol(pad);
    assert.equal(P.padHand(pad), col < 4 ? P.LEFT : P.RIGHT);
  }
  assert.equal(P.mirrorCol(0), 7);
  assert.equal(P.mirrorCol(3), 4);
});

test('every layout assigns every pad a known voice', () => {
  for (const layout of P.LAYOUT_IDS) {
    for (let pad = P.PAD_FIRST; pad <= P.PAD_LAST; pad++) {
      const v = P.padVoice(pad, layout);
      assert.ok(v !== null, `${layout} pad ${pad} is unassigned`);
      assert.ok(VOICE_IDS.includes(v), `${layout} pad ${pad} -> unknown voice ${v}`);
    }
  }
});

test('the halves mirror exactly — the layout is learned once, not twice', () => {
  for (const layout of P.LAYOUT_IDS) {
    for (let row = 0; row < P.ROWS; row++) {
      for (let col = 0; col < P.COLS; col++) {
        assert.equal(
          P.padVoice(P.padAt(row, col), layout),
          P.padVoice(P.padAt(row, P.mirrorCol(col)), layout),
          `${layout} row ${row} col ${col} does not mirror`,
        );
      }
    }
  }
});

test('every voice a layout reaches is reachable with BOTH hands', () => {
  /* Sticking is only scoreable if each voice exists under each hand. A voice
   * on one side only would make half its written stickings impossible. */
  for (const layout of P.LAYOUT_IDS) {
    for (const voice of P.layoutVoices(layout)) {
      assert.ok(P.padsForVoice(voice, layout, P.LEFT).length > 0, `${layout}/${voice} left`);
      assert.ok(P.padsForVoice(voice, layout, P.RIGHT).length > 0, `${layout}/${voice} right`);
    }
  }
});

test('padsForVoice round-trips against padVoice', () => {
  for (const layout of P.LAYOUT_IDS) {
    for (const voice of P.layoutVoices(layout)) {
      const pads = P.padsForVoice(voice, layout);
      assert.ok(pads.length > 0);
      for (const pad of pads) assert.equal(P.padVoice(pad, layout), voice);
      const both = P.padsForVoice(voice, layout, P.LEFT).length
                 + P.padsForVoice(voice, layout, P.RIGHT).length;
      assert.equal(both, pads.length, 'every pad belongs to exactly one hand');
    }
  }
});

test('the layouts are a ladder — each reaches at least as much as the last', () => {
  assert.deepEqual(P.layoutVoices('sticking'), ['SN']);
  const four = P.layoutVoices('kit4');
  const eight = P.layoutVoices('kit8');
  assert.equal(four.length, 4);
  assert.equal(eight.length, 8);
  for (const v of four) assert.ok(eight.includes(v), `kit8 must still reach ${v}`);
});

test('the hi-hat pedal is engraved but has no pad, in any layout', () => {
  for (const layout of P.LAYOUT_IDS) {
    assert.equal(P.padsForVoice('HF', layout).length, 0);
  }
});

test('layoutForChart picks the narrowest layout that can play it', () => {
  assert.equal(P.layoutForChart({ events: [{ voices: ['SN'] }] }), 'sticking');
  assert.equal(P.layoutForChart({ events: [{ voices: ['KK', 'SN', 'HH'] }] }), 'kit4');
  assert.equal(P.layoutForChart({ events: [{ voices: ['CR', 'KK'] }] }), 'kit8');
  assert.equal(P.layoutForChart({ events: [{ voices: ['HF'] }] }), null);
});

test('unknown layouts and pads are refused rather than guessed at', () => {
  assert.equal(P.padVoice(68, 'nope'), null);
  assert.equal(P.padVoice(5, 'kit4'), null);
  assert.deepEqual(P.padsForVoice('SN', 'nope'), []);
  assert.deepEqual(P.layoutVoices('nope'), []);
  assert.equal(P.layoutExists('kit4'), true);
  assert.equal(P.layoutExists('nope'), false);
});

test('a judgement colour is never one of the music colours', () => {
  const music = [P.LED_OFF, P.LED_VOICE, P.LED_TARGET_FAR, P.LED_TARGET_NEAR, P.LED_PROMPT];
  const judge = [P.LED_HIT, P.LED_STICK, P.LED_MISS, P.LED_PRESSED];
  for (const j of judge) assert.ok(!music.includes(j), `${j} is in both families`);
  assert.equal(new Set(judge).size, judge.length, 'judgements must be told apart');
});
