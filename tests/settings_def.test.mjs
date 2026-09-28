import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/settings_def.mjs';
import * as L from '../src/layout.mjs';

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
  assert.deepEqual(S.KNOB_ROWS.map((i) => S.ROWS[i].key), ['bpm', 'pxPerBeat', 'reps', 'layout']);
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

test('Reps is an override, and defaults to what the file says', () => {
  /* How long a practice is belongs to the file that defines it. */
  assert.equal(S.DEFAULTS.reps, 0);
  assert.equal(S.formatValue(S.rowFor('reps'), 0), 'as written');
  assert.equal(S.formatValue(S.rowFor('reps'), 16), '16x');
  assert.equal(S.affectsChart('reps'), true, 'changing it rebuilds the armed drill');
  assert.equal(S.DEFAULTS.loop, undefined, 'the endless-loop setting is gone');
  assert.equal(S.DEFAULTS.loopBars, undefined, 'the loop length lives in the file');
});

test('a list stops at its ends rather than wrapping', () => {
  const s = { ...S.DEFAULTS, layout: 'kit' };
  S.applySetting(s, 'layout', -5);
  assert.equal(s.layout, 'kit');
  S.applySetting(s, 'layout', 9);
  assert.equal(s.layout, 'sticking');
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
  settings.layout = 'sticking';
  settings.dynamics = false;
  const again = S.loadSettings(S.serialiseSettings(settings)).settings;
  for (const row of S.ROWS) assert.equal(again[row.key], settings[row.key], row.key);
});

test('only the settings that change the material force a rebuild', () => {
  assert.equal(S.affectsChart('bpm'), true);
  assert.equal(S.affectsChart('reps'), true);
  assert.equal(S.affectsChart('view'), false, 'a redraw is not a rebuild');
  assert.equal(S.affectsChart('pxPerBeat'), false);
});

test('every row formats, and label plus value fits the row', () => {
  /*
   * The real constraint is the ROW, not a character count: the label is drawn
   * at the left and the value right-aligned, and past TEXT_MAX_PX the host
   * simply stops plotting and the value goes missing in silence.
   */
  const px = (t) => t.length * 6 - 1;
  for (const row of S.ROWS) {
    const vals = row.type === 'bool' ? [true, false]
      : row.type === 'int' ? [row.min, row.max]
      : row.values;
    for (const v of vals) {
      const out = S.formatValue(row, v);
      assert.equal(typeof out, 'string');
      assert.ok(out.length > 0, `${row.key}=${v} formatted to nothing`);
      const wide = px(row.label) + px(out) + 8;
      assert.ok(wide <= L.TEXT_MAX_PX, `"${row.label}  ${out}" is ${wide}px of ${L.TEXT_MAX_PX}`);
    }
  }
  assert.equal(S.settingsRows({ ...S.DEFAULTS }).length, S.ROWS.length);
});

test('the defaults are the ones the README promises', () => {
  assert.equal(S.DEFAULTS.guide, false, 'a lit pad is an answer, not a hint');
  assert.equal(S.DEFAULTS.view, 'grid', 'drum tab is what a drummer reads');
  assert.equal(S.DEFAULTS.study, false);
  assert.equal(S.DEFAULTS.strictness, 'normal');
  assert.equal(S.DEFAULTS.midiCh, 0, 'broadcast: a channel mismatch is silent');
  assert.equal(S.DEFAULTS.midiOut, 4, 'the built-in kit, so nothing has to be set up');
});

test('the v2 migration moves a stale staff default to drum tab, once', () => {
  /*
   * A file written at v1 carries view:"staff" whether or not anybody chose
   * it — that was the only default there had ever been — so the new default
   * would otherwise reach nobody who had already opened the module.
   */
  const v1 = JSON.stringify({ version: 1, view: 'staff', bpm: 104, latencyMs: 12 });
  const a = S.loadSettings(v1);
  assert.equal(a.settings.view, 'grid');
  assert.equal(a.changed, true, 'the file has to be rewritten at the new version');
  assert.equal(a.settings.bpm, 104, 'a real preference must survive');
  assert.equal(a.settings.latencyMs, 12);

  /* And once migrated, a chosen staff is respected. */
  const b = S.loadSettings(S.serialiseSettings({ ...a.settings, view: 'staff' }));
  assert.equal(b.settings.view, 'staff');
  assert.equal(b.changed, false, 'a current file must not be rewritten every open');
});

test('settings dropped between versions simply vanish', () => {
  /* `loop` and `loopBars` are gone: how long a practice runs lives in the
   * file now. coerceInto only ever copies keys the table still declares. */
  const { settings } = S.loadSettings(JSON.stringify({ version: 1, loop: true, loopBars: 4 }));
  assert.equal(settings.loop, undefined);
  assert.equal(settings.loopBars, undefined);
  assert.equal(JSON.parse(S.serialiseSettings(settings)).loop, undefined);
});
