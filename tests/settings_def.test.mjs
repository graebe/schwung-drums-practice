import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/settings_def.mjs';

test('every row is complete and every default is in range', () => {
  for (const row of S.ROWS) {
    assert.ok(row.key && row.label, `${row.key} needs a label`);
    assert.ok(['int', 'bool', 'list', 'wrap'].includes(row.type), `${row.key} type`);
    const v = S.DEFAULTS[row.key];
    assert.notEqual(v, undefined, `${row.key} has no default`);
    if (row.type === 'int') {
      assert.ok(v >= row.min && v <= row.max, `${row.key} default out of range`);
    } else if (row.type !== 'bool') {
      assert.ok(row.values.includes(v), `${row.key} default is not one of its values`);
    }
  }
});

test('the label fits the screen', () => {
  for (const row of S.ROWS) assert.ok(row.label.length <= 11, `${row.label} is too long`);
});

test('knobs 1-4 are the first four rows', () => {
  assert.deepEqual(S.KNOB_ROWS, [0, 1, 2, 3]);
  assert.deepEqual(S.KNOB_ROWS.map((i) => S.ROWS[i].key), ['bpm', 'pxPerBeat', 'loopBars', 'layout']);
});

test('an int clamps and never escapes its range', () => {
  const s = { ...S.DEFAULTS };
  for (let i = 0; i < 500; i++) S.applySetting(s, 'bpm', 1);
  assert.equal(s.bpm, 240);
  for (let i = 0; i < 500; i++) S.applySetting(s, 'bpm', -1);
  assert.equal(s.bpm, 40);
});

test('a bool toggles ONCE however the delta was batched', () => {
  /* The host batches encoder ticks. A flick arriving as +3 must not toggle a
   * switch three times and land back where it started. */
  const s = { ...S.DEFAULTS, dynamics: true };
  S.applySetting(s, 'dynamics', 3);
  assert.equal(s.dynamics, false);
  S.applySetting(s, 'dynamics', -7);
  assert.equal(s.dynamics, true);
});

test('a list stops at its ends rather than wrapping', () => {
  const s = { ...S.DEFAULTS, layout: 'sticking' };
  S.applySetting(s, 'layout', -5);
  assert.equal(s.layout, 'sticking');
  S.applySetting(s, 'layout', 9);
  assert.equal(s.layout, 'kit8');
});

test('an unknown key changes nothing', () => {
  const s = { ...S.DEFAULTS };
  S.applySetting(s, 'nonsense', 1);
  assert.deepEqual(s, { ...S.DEFAULTS });
});

test('a hand-edited file is coerced back to what the encoder could produce', () => {
  const { settings } = S.loadSettings(JSON.stringify({
    bpm: 99999, countIn: -40, layout: 'nope', dynamics: 'yes', roundSize: 7, latencyMs: 1e9,
  }));
  assert.equal(settings.bpm, 240);
  assert.equal(settings.countIn, 0);
  assert.equal(settings.layout, S.DEFAULTS.layout, 'an unknown value falls back');
  assert.equal(settings.dynamics, true);
  assert.equal(settings.roundSize, S.DEFAULTS.roundSize, 'not one of the allowed values');
  assert.equal(settings.latencyMs, 60);
});

test('a corrupt or missing file loads the defaults rather than failing', () => {
  for (const text of [null, '', '{trunc', 'null', '[]']) {
    const { settings } = S.loadSettings(text);
    assert.equal(settings.bpm, S.DEFAULTS.bpm, JSON.stringify(text));
  }
});

test('settings round-trip through the file unchanged', () => {
  const { settings } = S.loadSettings(null);
  settings.bpm = 123;
  settings.layout = 'kit8';
  settings.dynamics = false;
  const again = S.loadSettings(S.serialiseSettings(settings)).settings;
  for (const row of S.ROWS) assert.equal(again[row.key], settings[row.key], row.key);
});

test('only the settings that change the material force a rebuild', () => {
  assert.equal(S.affectsChart('bpm'), true);
  assert.equal(S.affectsChart('loopBars'), true);
  assert.equal(S.affectsChart('loop'), true);
  assert.equal(S.affectsChart('view'), false, 'a redraw is not a rebuild');
  assert.equal(S.affectsChart('pxPerBeat'), false);
});

test('every row formats without throwing, at both ends of its range', () => {
  const s = { ...S.DEFAULTS };
  for (const row of S.ROWS) {
    const vals = row.type === 'bool' ? [true, false]
      : row.type === 'int' ? [row.min, row.max]
      : row.values;
    for (const v of vals) {
      const out = S.formatValue(row, v);
      assert.equal(typeof out, 'string');
      assert.ok(out.length > 0 && out.length <= 9, `${row.key}=${v} -> "${out}"`);
    }
  }
  assert.equal(S.settingsRows(s).length, S.ROWS.length);
});

test('the defaults are the ones the README promises', () => {
  assert.equal(S.DEFAULTS.guide, false, 'a lit pad is an answer, not a hint');
  assert.equal(S.DEFAULTS.loop, true);
  assert.equal(S.DEFAULTS.study, false);
  assert.equal(S.DEFAULTS.strictness, 'normal');
  assert.equal(S.DEFAULTS.midiCh, 0, 'broadcast: a channel mismatch is silent');
  assert.equal(S.DEFAULTS.midiOut, 4, 'the built-in kit, so nothing has to be set up');
});
