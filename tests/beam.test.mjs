import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/beam.mjs';

const mk = (beats) => beats.map((b) => ({ beat: b }));
const all = (beats, gb = 1) => {
  const e = mk(beats);
  return e.map((_, i) => B.beamsAt(e, i, gb));
};

test('note values come out of the gap to the next hit', () => {
  assert.deepEqual(all([0, 1, 2, 3]), [0, 0, 0, 0], 'quarters carry no beam');
  assert.deepEqual(all([0, 0.5, 1, 1.5]), [1, 1, 1, 1], 'eighths carry one');
  assert.deepEqual(all([0, 0.25, 0.5, 0.75]), [2, 2, 2, 2], 'sixteenths carry two');
});

test('a dotted eighth keeps its beam', () => {
  /* 0.75 of a beat is not a power of two; rounding would throw the beam away
   * and the pair would read as two quarters. */
  assert.deepEqual(all([0, 0.75]), [1, 2]);
});

test('triplets are read as triplets, not as bad sixteenths', () => {
  const e = mk([0, 1 / 3, 2 / 3]);
  assert.equal(B.tupletAt(e, 0, 1), 3);
  assert.deepEqual(all([0, 1 / 3, 2 / 3]), [1, 1, 1]);
});

test('sextuplets take two beams', () => {
  const beats = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
  assert.equal(B.tupletAt(mk(beats), 0, 1), 6);
  assert.deepEqual(all(beats), [2, 2, 2, 2, 2, 2]);
});

test('four evenly-spaced hits are sixteenths, not a tuplet', () => {
  assert.equal(B.tupletAt(mk([0, 0.25, 0.5, 0.75]), 0, 1), 0);
});

test('a syncopated run of three is not a triplet', () => {
  /* It has to start on the beat. Three hits beginning off it are three
   * ordinary notes that happen to number three. */
  assert.equal(B.tupletAt(mk([0.25, 0.5, 0.75]), 0, 1), 0);
});

test('the last note of a beat is clipped by its group, not by the next hit', () => {
  /* Without clipping, the last sixteenth of a beat followed by an empty beat
   * would measure a whole beat long and lose both its beams. */
  const e = mk([0, 0.25, 0.5, 0.75, 4]);
  assert.equal(B.beamsAt(e, 3, 1), 2);
  assert.ok(Math.abs(B.durationAt(e, 3, 1) - 0.25) < 1e-9);
});

test('beams join only within a group, and only as far as both notes carry', () => {
  const e = mk([0, 0.25, 0.5, 1]);
  assert.equal(B.beamsBetween(e, 0, 1), 2, 'two sixteenths join on two');
  assert.equal(B.beamsBetween(e, 1, 1), 1, 'a sixteenth and an eighth join on one');
  assert.equal(B.beamsBetween(e, 2, 1), 0, 'nothing crosses the beat');
});

test('compound metres group in dotted quarters', () => {
  assert.equal(B.groupBeats({ timeSig: [6, 8] }), 1.5);
  assert.equal(B.groupBeats({ timeSig: [9, 8] }), 1.5);
  assert.equal(B.groupBeats({ timeSig: [4, 4] }), 1);
  assert.equal(B.groupBeats({ timeSig: [7, 8] }), 1, 'seven is not divisible by three');
  assert.equal(B.groupBeats({}), 1);
});

test('6/8 reads as two groups of three', () => {
  const gb = 1.5;
  const e = mk([0, 0.5, 1, 1.5, 2, 2.5]);
  assert.equal(B.sameGroup(e, 0, 2, gb), true);
  assert.equal(B.sameGroup(e, 2, 3, gb), false, 'the group breaks at the dotted quarter');
  assert.equal(B.beamsBetween(e, 2, gb), 0);
});

test('beams never exceed what the screen can draw', () => {
  /* Two is the cap: a third would strike through the crash. */
  const e = mk([0, 1 / 32, 2 / 32]);
  for (let i = 0; i < e.length; i++) assert.ok(B.beamsAt(e, i, 1) <= 2);
});

test('a lone beamed note has nothing to join', () => {
  const e = mk([0, 1]);
  assert.equal(B.isLoneBeam(e, 0, 1), false, 'a quarter is not beamed at all');
  const f = mk([0, 0.5, 2]);
  assert.equal(B.isLoneBeam(f, 2, 1), false);
});

test('a pathological group is bounded rather than scanned forever', () => {
  const e = mk(new Array(500).fill(0).map((_, i) => i * 1e-6));
  assert.ok(B.groupEnd(e, 0, 1) - B.groupStart(e, 0, 1) <= 32);
});
