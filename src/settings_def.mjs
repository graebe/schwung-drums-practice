/*
 * settings_def.mjs — the settings page AS DATA.
 *
 * One declaration drives four things that would otherwise be four
 * hand-maintained copies of the same ordering: the rows on the settings
 * screen, how the encoder edits each one, how the persisted file is coerced
 * back into range on load, and which changes force the armed drill to be
 * rebuilt. The pitched module records collapsing exactly those four into this
 * shape after a numeric switch, a parallel array of labels and a separate
 * list of chart-affecting keys drifted apart.
 *
 * Row order is load-bearing at the top: knobs 1-4 are wired to rows 0-3.
 *
 * type:
 *   int   clamped to [min, max]
 *   bool  toggles once per gesture regardless of how the delta was batched
 *   list  steps through `values`, stopping at the ends
 *   wrap  like list, but wraps around
 */

export const ROWS = [
  /* ---- knobs 1-4 ---- */
  { key: 'bpm',        label: 'Tempo',     type: 'int',  min: 40, max: 240, rebuild: true,
    format: (v) => `${v}` },
  { key: 'pxPerBeat',  label: 'Read ahead', type: 'int', min: 12, max: 48 },
  { key: 'loopBars',   label: 'Loop len',  type: 'list', values: [1, 2, 4, 8], rebuild: true,
    format: (v) => `${v} bar${v === 1 ? '' : 's'}` },
  { key: 'layout',     label: 'Kit',       type: 'list', values: ['sticking', 'kit4', 'kit8'] },

  /* ---- the rest ---- */
  { key: 'view',       label: 'View',      type: 'list', values: ['staff', 'grid'] },
  { key: 'strictness', label: 'Strict',    type: 'list', values: ['loose', 'normal', 'tight'] },
  { key: 'sticking',   label: 'Sticking',  type: 'list', values: ['strict', 'loose', 'off'] },
  { key: 'dynamics',   label: 'Dynamics',  type: 'bool' },
  { key: 'accentVel',  label: 'Accent vel', type: 'int', min: 40, max: 127 },
  { key: 'ghostVel',   label: 'Ghost vel', type: 'int',  min: 1,  max: 90 },
  { key: 'guide',      label: 'Guide pads', type: 'bool' },
  { key: 'loop',       label: 'Loop',      type: 'bool', rebuild: true },
  { key: 'study',      label: 'Study',     type: 'bool' },
  { key: 'click',      label: 'Click',     type: 'bool' },
  { key: 'clickSubdiv', label: 'Click sub', type: 'list', values: [0, 1, 2, 4],
    format: (v) => (v === 0 ? 'off' : v === 1 ? 'beat' : `${v * 2}ths`) },
  { key: 'countIn',    label: 'Count in',  type: 'int',  min: 0, max: 8 },
  { key: 'ladderStep', label: 'Ladder +',  type: 'int',  min: 1, max: 20,
    format: (v) => `${v} bpm` },
  { key: 'ladderBars', label: 'Ladder bars', type: 'int', min: 1, max: 16 },
  { key: 'clockBars',  label: 'Clock bars', type: 'int',  min: 1, max: 8 },
  { key: 'roundSize',  label: 'Round',     type: 'list', values: [0, 10, 20, 30],
    format: (v) => (v === 0 ? 'endless' : `${v}`) },
  /*
   * The one number that can invalidate every other number in the module. If
   * the rig is 15ms late everywhere, the mean is a lie no amount of practice
   * can fix, and the player would be chasing a bias that is not theirs.
   */
  { key: 'latencyMs',  label: 'Latency',   type: 'int',  min: 0, max: 60,
    format: (v) => `${v} ms` },
  { key: 'midiOut',    label: 'MIDI out',  type: 'list', values: [4, 1, 2, 3],
    format: (v) => ({ 4: 'kit', 1: 'track', 2: 'USB', 3: 'trk+USB' })[v] || `${v}` },
  { key: 'midiCh',     label: 'MIDI ch',   type: 'int',  min: 0, max: 16,
    format: (v) => (v === 0 ? 'all' : `${v}`) },
];

export const DEFAULTS = {
  bpm: 90,
  pxPerBeat: 32,
  loopBars: 1,
  layout: 'kit4',
  view: 'staff',
  strictness: 'normal',
  sticking: 'strict',
  dynamics: true,
  accentVel: 90,
  ghostVel: 45,
  /* Off by default: this is a reading trainer first, and a lit pad is an
   * answer rather than a hint. */
  guide: false,
  loop: true,
  study: false,
  click: true,
  clickSubdiv: 1,
  countIn: 4,
  ladderStep: 5,
  ladderBars: 4,
  clockBars: 4,
  roundSize: 20,
  latencyMs: 0,
  midiOut: 4,
  /* Broadcast. A module cannot read or change which channel a track listens
   * on, and a mismatch is silent with no clue on screen. */
  midiCh: 0,
};

/* Bumped whenever a migration is added below. */
export const SETTINGS_VERSION = 1;

export const KNOB_ROWS = [0, 1, 2, 3];

const byKey = {};
for (let i = 0; i < ROWS.length; i++) byKey[ROWS[i].key] = ROWS[i];

export function rowFor(key) {
  return byKey[key] || null;
}

export function formatValue(row, value) {
  if (row.format) return String(row.format(value));
  if (row.type === 'bool') return value ? 'on' : 'off';
  return String(value);
}

export function settingsRows(settings) {
  return ROWS.map((r) => ({ key: r.key, label: r.label, value: formatValue(r, settings[r.key]) }));
}

/*
 * Apply an encoder delta to one row.
 *
 * A bool toggles ONCE per gesture however the delta arrived: the host batches
 * encoder ticks, and a flick that arrives as +3 must not toggle a switch
 * three times and land back where it started.
 */
export function applySetting(settings, key, delta) {
  const row = byKey[key];
  if (!row || !delta) return settings;
  const cur = settings[key];
  if (row.type === 'bool') {
    settings[key] = !cur;
    return settings;
  }
  if (row.type === 'int') {
    settings[key] = Math.max(row.min, Math.min(row.max, (cur | 0) + delta));
    return settings;
  }
  const vals = row.values;
  let i = vals.indexOf(cur);
  if (i < 0) i = 0;
  const n = vals.length;
  i = row.type === 'wrap'
    ? (((i + delta) % n) + n) % n
    : Math.max(0, Math.min(n - 1, i + delta));
  settings[key] = vals[i];
  return settings;
}

/* True when changing this key means the armed drill has to be rebuilt. */
export function affectsChart(key) {
  const row = byKey[key];
  return Boolean(row && row.rebuild);
}

/*
 * Coerce a loaded object into range, from the same declaration the editor
 * uses — so a hand-edited or downgraded file cannot put a value on screen
 * that the encoder could never produce.
 */
export function coerceInto(target, loaded) {
  const out = { ...DEFAULTS, ...target };
  if (!loaded || typeof loaded !== 'object') return out;
  for (const row of ROWS) {
    const v = loaded[row.key];
    if (v === undefined) continue;
    if (row.type === 'bool') {
      out[row.key] = Boolean(v);
    } else if (row.type === 'int') {
      if (Number.isFinite(v)) out[row.key] = Math.max(row.min, Math.min(row.max, Math.round(v)));
    } else if (row.values.indexOf(v) >= 0) {
      out[row.key] = v;
    }
  }
  return out;
}

/*
 * Numbered migrations, applied after coercion. Returns true when anything
 * changed, so the caller can avoid rewriting a file that is already current —
 * an eMMC write on every open, for nothing.
 */
export function migrate(settings, fromVersion) {
  let changed = false;
  if (!Number.isFinite(fromVersion) || fromVersion < 1) changed = true;
  settings.version = SETTINGS_VERSION;
  return changed;
}

export function loadSettings(text) {
  let obj = null;
  if (text) {
    try {
      obj = JSON.parse(text);
    } catch (e) {
      obj = null;
    }
  }
  const settings = coerceInto({}, obj);
  const changed = migrate(settings, obj && obj.version);
  return { settings, changed };
}

export function serialiseSettings(settings) {
  const out = { version: SETTINGS_VERSION };
  for (const row of ROWS) out[row.key] = settings[row.key];
  return JSON.stringify(out);
}
