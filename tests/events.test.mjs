import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/events.mjs';

test('merge folds simultaneous hits and keeps each voice its own dynamic', () => {
  /* Letting the loudest win would accent the hi-hat sitting over an accented
   * snare — which is every backbeat, and a thing nobody plays. */
  const m = G.merge([
    { beat: 0, voices: ['HH'] },
    { beat: 0, voices: ['SN'], dyn: 'accent' },
    { beat: 1, voices: ['HH'] },
  ]);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].voices, ['HH', 'SN']);
  assert.deepEqual(m[0].dyn, { SN: 'accent' });
  assert.equal(m[1].dyn, undefined, 'a plain hit carries no dynamic at all');
});

test('merge does not mutate what it was handed', () => {
  const src = [{ beat: 0, voices: ['KK'] }, { beat: 0, voices: ['SN'] }];
  G.merge(src);
  assert.deepEqual(src[0].voices, ['KK']);
});

test('dynOf reads both the string and the per-voice form', () => {
  assert.equal(G.dynOf({ voices: ['SN'], dyn: 'ghost' }, 'SN'), 'ghost');
  assert.equal(G.dynOf({ voices: ['HH', 'SN'], dyn: { SN: 'accent' } }, 'SN'), 'accent');
  assert.equal(G.dynOf({ voices: ['HH', 'SN'], dyn: { SN: 'accent' } }, 'HH'), 'normal');
  assert.equal(G.dynOf({ voices: ['SN'] }, 'SN'), 'normal');
  assert.equal(G.dynOf(null, 'SN'), 'normal');
});

test('expandDyn normalises either form to a per-voice map', () => {
  assert.deepEqual(G.expandDyn({ voices: ['HH', 'SN'], dyn: 'accent' }),
    { HH: 'accent', SN: 'accent' });
  assert.deepEqual(G.expandDyn({ voices: ['HH', 'SN'], dyn: { SN: 'accent' } }),
    { SN: 'accent' });
  assert.deepEqual(G.expandDyn({ voices: ['SN'] }), {});
});
