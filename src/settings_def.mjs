// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

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
 * The knobs edit the rows on screen, a page of five at a time (ui.js
 * settingsRowForKnob), so a page's order is what the knobs reach.
 *
 * type:
 *   int   clamped to [min, max]
 *   bool  toggles once per gesture regardless of how the delta was batched
 *   list  steps through `values`, stopping at the ends
 *   wrap  like list, but wraps around
 *   action  a row that opens something rather than holding a value — Click
 *           on it does what `action` names; it is never saved
 *
 * group: the page the row is on. `main` is Settings itself (MAIN): what is
 * personal — the pads, the click, where the path starts. The rest have good
 * defaults and are filed under Settings › Advanced, a page per GROUPS.
 */

export const ROWS = [
  { key: 'bpm',        group: 'practice', label: 'Tempo',     type: 'int',  min: 40, max: 240, rebuild: true,
    format: (v) => `${v}` },
  /*
   * Every drill at a share of its own tempo — a hand-written one's, or Tempo
   * for a generated one. Also on knob 8 in a drill. Without it the grooves and
   * rudiments, written at up to 270, could not be slowed down at all.
   */
  { key: 'speed',      group: 'practice', label: 'Speed',     type: 'list', rebuild: true,
    values: [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120],
    format: (v) => `${v}%` },
  { key: 'pxPerBeat',  group: 'practice', label: 'Read ahead', type: 'int', min: 12, max: 48 },
  /*
   * An OVERRIDE, not the source of truth. How long a practice is belongs to
   * the file that defines it; this is here so you can decide to play
   * something twice as long today without editing it. `0` is "as written".
   */
  { key: 'reps',       group: 'practice', label: 'Reps',      type: 'list', values: [0, 4, 8, 16, 32], rebuild: true,
    format: (v) => (v === 0 ? 'as written' : `${v}x`) },
  /*
   * The pad layout (padmap.mjs). MPC Classic is the default: it is what most
   * finger drummers learnt on. Chromatic is Move's own drum mode, note for
   * note; Sticking puts the snare on every pad, for rudiments.
   */
  { key: 'layout',     group: 'main',     label: 'Pads',      type: 'list',
    values: ['mpc', 'family', 'centre', 'gm', 'mirror', 'custom', 'sticking'],
    format: (v) => ({ mpc: 'MPC', family: 'Family', centre: 'Centre', gm: 'GM', mirror: 'Mirror',
      custom: 'Custom', sticking: 'Sticking' })[v] || `${v}` },
  /* Mirror the layout left to right, for a left-hander. The hands stay the
   * physical halves. */
  { key: 'flip',       group: 'main',     label: 'Flip',      type: 'bool' },
  { key: 'padMap',     group: 'main',     label: 'Pad map',   type: 'action', action: 'padmap', format: () => '>' },
  { key: 'view',       group: 'practice', label: 'View',      type: 'list', values: ['staff', 'grid'] },
  { key: 'strictness', group: 'practice', label: 'Strict',    type: 'list', values: ['loose', 'normal', 'tight'] },
  { key: 'sticking',   group: 'practice', label: 'Sticking',  type: 'list', values: ['strict', 'loose', 'off'] },
  { key: 'dynamics',   group: 'practice', label: 'Dynamics',  type: 'bool' },
  /* How much louder than your own normal strokes an accent has to be, and
   * how much softer a ghost — in velocity steps (scoring.mjs dynNeed). */
  { key: 'accentLift', group: 'practice', label: 'Accent +',  type: 'int',  min: 5,  max: 60 },
  { key: 'ghostDrop',  group: 'practice', label: 'Ghost -',   type: 'int',  min: 5,  max: 60 },
  { key: 'guide',      group: 'practice', label: 'Guide pads', type: 'bool' },
  { key: 'study',      group: 'practice', label: 'Study',     type: 'bool' },
  { key: 'click',      group: 'main',     label: 'Click',     type: 'bool' },
  { key: 'clickSubdiv',group: 'sound',    label: 'Click sub', type: 'list', values: [0, 1, 2, 4],
    /* Clicks per beat: 2 is eighths, 4 sixteenths. It read `v * 2` and so
     * printed 4ths and 8ths for the eighths and sixteenths it plays. */
    format: (v) => (v === 0 ? 'off' : v === 1 ? 'beat' : `${v * 4}ths`) },
  { key: 'countIn',    group: 'practice', label: 'Count in',  type: 'int',  min: 0, max: 8 },
  { key: 'ladderStep', group: 'practice', label: 'Ladder +',  type: 'int',  min: 1, max: 20,
    format: (v) => `${v} bpm` },
  { key: 'ladderBars', group: 'practice', label: 'Ladder bars', type: 'int', min: 1, max: 16 },
  { key: 'clockBars',  group: 'practice', label: 'Clock bars', type: 'int',  min: 1, max: 8 },
  { key: 'roundSize',  group: 'practice', label: 'Round',     type: 'list', values: [0, 10, 20, 30],
    format: (v) => (v === 0 ? 'endless' : `${v}`) },
  /*
   * The one number that can invalidate every other number in the module. If
   * the rig is 15ms late everywhere, the mean is a lie no amount of practice
   * can fix, and the player would be chasing a bias that is not theirs.
   */
  { key: 'latencyMs',  group: 'sound',    label: 'Latency',   type: 'int',  min: 0, max: 60,
    format: (v) => `${v} ms` },
  { key: 'midiOut',    group: 'midi',     label: 'MIDI out',  type: 'list', values: [4, 1, 2, 3],
    format: (v) => ({ 4: 'kit', 1: 'track', 2: 'USB', 3: 'trk+USB' })[v] || `${v}` },
  /* 0 is General MIDI's drum channel, 10. It said "all", but drum hits are
   * sent on one channel only: sixteen copies of every hit would swamp the
   * inject ring at sixteenth notes. */
  { key: 'midiCh',     group: 'midi',     label: 'MIDI ch',   type: 'int',  min: 0, max: 16,
    format: (v) => (v === 0 ? '10 GM' : `${v}`) },
];

/*
 * Settings itself, one short page in this order: the pads, how they map and
 * which way round, the click, where the Learning Path starts, and Advanced.
 * Start at and Advanced are rows of the page, not settings: Start at is the
 * learner's progress (progress.mjs path.start), shown from `extra.start`,
 * and Advanced opens the folder of the rest. So they stay out of ROWS, and
 * DEFAULTS and coerceInto never see them.
 */
export const MAIN = ['layout', 'padMap', 'flip', 'click', 'start', 'advanced'];
export const MAIN_GROUP = { key: 'main', label: 'Settings' };
const PAGE_ROWS = {
  start: { key: 'start', group: 'main', label: 'Start at', type: 'path' },
  advanced: { key: 'advanced', group: 'main', label: 'Advanced', type: 'action', action: 'advanced',
    format: () => '>' },
};

/*
 * The pages under Settings › Advanced, in its order, as the editor shows
 * them. The Learning Path's choices and Help are folders of the menu, not
 * rows of this table — the path's choices are the learner's progress and
 * Help's rows are actions — so only these open the editor.
 */
export const GROUPS = [
  { key: 'practice', label: 'Practice' },
  { key: 'sound', label: 'Sound' },
  { key: 'midi', label: 'MIDI' },
];

/* A page by its key: Settings itself or a group of Advanced. */
export function groupByKey(key) {
  return key === MAIN_GROUP.key ? MAIN_GROUP : GROUPS.find((g) => g.key === key) || null;
}

/* The rows of one page: Settings itself in MAIN's order, a group in table order. */
export function rowsIn(group) {
  if (group === MAIN_GROUP.key) return MAIN.map((k) => byKey[k] || PAGE_ROWS[k]);
  return ROWS.filter((r) => r.group === group);
}

export const DEFAULTS = {
  bpm: 90,
  speed: 100,
  pxPerBeat: 32,
  reps: 0,
  layout: 'mpc',
  flip: false,
  /* Drum tab, not a staff. It is what a drummer reads, it is legible at a
   * glance while playing, and the percussion staff is one setting away for
   * when reading notation is the point. */
  view: 'grid',
  strictness: 'normal',
  /* Finger drumming: either hand may take a pad, so the written R and L are a
   * guide, shown and not judged. Strict and loose are there to opt in. */
  sticking: 'off',
  dynamics: true,
  accentLift: 15,
  ghostDrop: 20,
  /* Off by default: this is a reading trainer first, and a lit pad is an
   * answer rather than a hint. */
  guide: false,
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
  /* General MIDI's drum channel, which a Move drum rack listens on. */
  midiCh: 0,
};

/* Bumped whenever a migration is added below. */
export const SETTINGS_VERSION = 5;

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

/* The rows as the list shows them; a page row of type `path` shows
 * `extra[key]` (Start at: "Stage 1"). */
export function settingsRows(settings, rows = ROWS, extra = {}) {
  return rows.map((r) => ({ key: r.key, label: r.label,
    value: r.type === 'path' ? String(extra[r.key] ?? '') : formatValue(r, settings[r.key]),
    action: r.action || null }));
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
  if (!row || !delta || row.type === 'action') return settings;
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
    if (row.type === 'action') continue;
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
  const from = Number.isFinite(fromVersion) ? fromVersion : 0;
  if (from < 1) changed = true;

  /*
   * v2 — the default view became drum tab.
   *
   * A file written at v1 carries `view: "staff"` whether or not anybody chose
   * it, because that was the only default there had ever been. Leaving it
   * alone would mean the new default reached nobody who had already opened
   * the module once. This resets a deliberate choice of the staff exactly
   * once, which is the lesser evil, and the setting is one click away.
   *
   * The dead keys from v1 (`loop`, `loopBars`) need no handling: how long a
   * practice runs now lives in the file, and coerceInto only ever copies keys
   * the table still declares.
   */
  if (from < 2) {
    settings.view = DEFAULTS.view;
    changed = true;
  }

  /*
   * v3 — dynamics are judged against your own strokes. `accentVel` and
   * `ghostVel` were absolute velocities; a lift over the take's median is a
   * different quantity and nothing about the old number says what it would
   * be, so the new keys start at their defaults. coerceInto has already
   * dropped the old ones; this only rewrites the file once.
   */
  if (from < 3) changed = true;

  /*
   * v4 — the pad layouts. `layout: "kit"`, the Drum Rack order, was the only
   * default there had ever been, and coerceInto has already replaced it with
   * the new default, MPC Classic; `sticking` is still a layout and is kept.
   */
  if (from < 4) changed = true;

  /*
   * v5 — hands are not judged by default (DEFAULTS.sticking). `strict` was
   * the only default there had ever been, so a file carrying it says nothing
   * about a choice; as with the view at v2, it is reset exactly once.
   */
  if (from < 5) {
    if (settings.sticking === 'strict') settings.sticking = DEFAULTS.sticking;
    changed = true;
  }

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
  for (const row of ROWS) if (row.type !== 'action') out[row.key] = settings[row.key];
  return JSON.stringify(out);
}
