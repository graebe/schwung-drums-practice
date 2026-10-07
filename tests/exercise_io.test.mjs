import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as IO from '../src/exercise_io.mjs';
import { VOICE_IDS } from '../src/kit.mjs';
import { chartTotalBeats, loopBeats, practiceSeconds } from '../src/chart.mjs';
import { layoutForChart } from '../src/padmap.mjs';
import { createRun } from '../src/scoring.mjs';

/* The rudiment families; every other category is a groove family. */
const RUDIMENT_CATS = ['rolls', 'diddles', 'flams', 'drags'];

const dir = new URL('../src/exercises/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');

test('a malformed file is refused whole, never half-loaded', () => {
  assert.ok(IO.parseExercise('{not json', 'x').error);
  assert.ok(IO.parseExercise('null', 'x').error);
  assert.ok(IO.parseExercise('{"name":"x"}', 'x').error, 'no events');
  assert.ok(IO.parseExercise('{"events":[{"beat":0,"voices":["SN"]}]}', 'x').error, 'no name');
});

test('every field is checked against what the module can actually play', () => {
  const bad = (o) => IO.validateExercise({ name: 'n', events: [{ beat: 0, voices: ['SN'] }], ...o });
  assert.ok(bad({ bpm: 5 }).length);
  assert.ok(bad({ timeSig: [0, 4] }).length);
  assert.ok(bad({ loopBars: 99 }).length);
  assert.ok(bad({ sticking: 'maybe' }).length);
  assert.ok(bad({ events: [{ beat: 0, voices: ['ZZ'] }] }).length, 'unknown voice');
  assert.ok(bad({ events: [{ beat: 0, voices: ['SN'], hand: 'X' }] }).length);
  assert.ok(bad({ events: [{ beat: 0, voices: ['SN'], dyn: 'loud' }] }).length);
  assert.ok(bad({ events: [{ beat: -1, voices: ['SN'] }] }).length, 'negative beat');
  assert.equal(bad({}).length, 0);
});

test('beats must run forwards — everything downstream walks the list once', () => {
  const r = IO.parseExercise(JSON.stringify({
    name: 'x', events: [{ beat: 2, voices: ['SN'] }, { beat: 1, voices: ['SN'] }],
  }), 'x');
  assert.ok(/backwards/.test(r.error));
});

test('hits on the same beat are folded into one stack', () => {
  /* Two entries on one beat would draw twice and read as a zero-length note. */
  const r = IO.parseExercise(JSON.stringify({
    name: 'x', events: [{ beat: 0, voices: ['KK'] }, { beat: 0, voices: ['HH'] }],
  }), 'x');
  assert.equal(r.chart.events.length, 1);
  assert.deepEqual(r.chart.events[0].voices, ['KK', 'HH']);
});

test('every voice in the legend has a pad, so nothing is unplayable', () => {
  /* The hi-hat pedal used to have no pad anywhere; Ableton's Drum Rack order
   * gives it GM slot 44, so the whole legend is now reachable. */
  for (const v of VOICE_IDS) {
    assert.deepEqual(IO.playabilityWarnings({ events: [{ voices: [v] }], sticking: 'off' }), [],
      `${v} cannot be played`);
  }
});

test('a drill asking for a voice no layout reaches would say so', () => {
  /* The guard stays, for a layout that does not reach everything. */
  const warn = IO.playabilityWarnings({ events: [{ voices: ['ZZ'] }], sticking: 'off' });
  assert.ok(warn.some((w) => /no pad/.test(w)));
});

test('sticking on with no hands written is called out', () => {
  const warn = IO.playabilityWarnings({ events: [{ voices: ['SN'] }], sticking: 'strict' });
  assert.ok(warn.some((w) => /no hands/.test(w)));
});

test('the manifest survives rubbish without losing the good entries', () => {
  const m = IO.parseManifest(JSON.stringify({
    exercises: [{ id: 'a', file: 'a.json' }, null, { id: 'b' }, { file: 'c.json' }],
  }));
  assert.equal(m.entries.length, 1);
  assert.equal(IO.parseManifest('{[').entries.length, 0);
});

/* ---- the bundled material ---------------------------------------------- */

const manifest = IO.parseManifest(read('index.json'));

test('the manifest names every bundled file, and every file is named', () => {
  const onDisk = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  const named = manifest.entries.map((e) => e.file).sort();
  assert.deepEqual(named, onDisk, 'the manifest and the directory disagree');
  assert.equal(new Set(manifest.entries.map((e) => e.id)).size, manifest.entries.length);
});

test('every bundled drill loads, validates and is playable', () => {
  /* All forty PAS rudiments, and at least the fourteen grooves 1.0 shipped. */
  assert.ok(manifest.entries.length >= 54, `${manifest.entries.length} drills`);
  let rudiments = 0;
  let grooves = 0;

  for (const e of manifest.entries) {
    const r = IO.parseExercise(read(e.file), e.id);
    assert.equal(r.error, undefined, `${e.id}: ${r.error}`);
    const c = r.chart;
    assert.deepEqual(IO.playabilityWarnings(c), [], `${e.id} is not playable`);
    assert.ok(layoutForChart(c), `${e.id} needs a layout that does not exist`);
    /* A drill must fit inside its own loop, or it overlaps its own repeat. */
    assert.ok(chartTotalBeats(c) < loopBeats(c), `${e.id} overruns its loop`);
    if (RUDIMENT_CATS.includes(e.category)) rudiments++;
    if (!RUDIMENT_CATS.includes(e.category)) grooves++;
  }
  assert.ok(grooves >= 14, `${grooves} grooves`);
  assert.equal(rudiments, 40, 'the PAS forty, all of them');
});

test('every rudiment enforces sticking and writes a hand on every stroke', () => {
  for (const e of manifest.entries.filter((x) => RUDIMENT_CATS.includes(x.category))) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    assert.equal(c.sticking, 'strict', `${e.id}`);
    for (const ev of c.events) assert.ok(ev.hand, `${e.id} has a stroke with no hand`);
  }
});

test('every rudiment alternates into something a pair of hands could play', () => {
  /* Two strokes on the same hand at the same instant is not a rudiment, it is
   * a typo. */
  for (const e of manifest.entries.filter((x) => RUDIMENT_CATS.includes(x.category))) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    for (let i = 1; i < c.events.length; i++) {
      const gap = c.events[i].beat - c.events[i - 1].beat;
      if (gap > 1e-6) continue;
      assert.notEqual(c.events[i].hand, c.events[i - 1].hand, `${e.id} at beat ${c.events[i].beat}`);
    }
  }
});

test('every groove leaves sticking off and every drill builds a run', () => {
  for (const e of manifest.entries) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    if (!RUDIMENT_CATS.includes(e.category)) assert.equal(c.sticking, 'off', e.id);
    const run = createRun(c, { looping: true });
    assert.ok(run.entries.length > 0, e.id);
    assert.ok(run.totalNotes > 0, e.id);
  }
});

/* ---- what the grooves actually SOUND like ------------------------------- */
/*
 * The test that should have existed from the start.
 *
 * `rock-backbeat` shipped with its hi-hat on QUARTERS: the spec strings were
 * read at eighth resolution, so "x-x-x-x-" meant every OTHER eighth. Nothing
 * caught it, because every test asked whether a drill parsed, fitted its bar
 * and used reachable voices — and it did all three. None asked what it
 * sounded like.
 *
 * So this states the intent independently of the data, as tab, and compares.
 * It is the same trick that made the C harness catch the missing get_error:
 * assert against a separate statement of what is wanted, never against the
 * code's own assumptions.
 *
 *   o hit    X accent    . ghost    - silence
 */
const SHAPE = {
  'rock-backbeat':     { HH: 'o-o-o-o-o-o-o-o-',
                         SN: '----X-------X---',
                         KK: 'o---------o-----' },
  'straight-eights':   { HH: 'o-o-o-o-o-o-o-o-',
                         SN: '----X-------X---',
                         KK: 'o---o---o---o---' },
  /* The kick lands WITH the snare on 3 and nowhere else — that is the drop. */
  'reggae-one-drop':   { HH: 'o---o---o---o---',
                         SN: '--------X-------',
                         KK: '--------o-------' },
  /* Four on the floor, with the hat opening on the off-beats. */
  'disco':             { HH: 'o---o---o---o---',
                         HO: '----o-------o---',
                         SN: '----X-------X---',
                         KK: 'o---o---o---o---' },
  'motown':            { HH: 'o---o---o---o---',
                         SN: 'X---X---X---X---',
                         KK: 'o-------o---o---' },
};

function tabOf(chart, voice, cols = 16) {
  const row = new Array(cols).fill('-');
  for (const e of chart.events) {
    if (!e.voices.includes(voice)) continue;
    const i = Math.round(e.beat * 4);
    if (i >= cols) continue;
    const d = !e.dyn ? 'normal' : typeof e.dyn === 'string' ? e.dyn : (e.dyn[voice] || 'normal');
    row[i] = d === 'accent' ? 'X' : d === 'ghost' ? '.' : 'o';
  }
  return row.join('');
}

test('the named grooves play what their names promise', () => {
  for (const [id, want] of Object.entries(SHAPE)) {
    const entry = manifest.entries.find((e) => e.id === id);
    assert.ok(entry, `${id} is not in the manifest`);
    const chart = IO.parseExercise(read(entry.file), id).chart;
    for (const [voice, tab] of Object.entries(want)) {
      assert.equal(tabOf(chart, voice), tab, `${id} ${voice}`);
    }
    /* And nothing else is playing that the table does not mention. */
    const playing = [...new Set(chart.events.flatMap((e) => e.voices))].sort();
    assert.deepEqual(playing, Object.keys(want).sort(), `${id} plays extra voices`);
  }
});

test('a backbeat accents the snare and NOT the hi-hat above it', () => {
  /* Dynamics are per voice for exactly this reason. Folding a stack down to
   * one dynamic would ask for an accented hi-hat on every backbeat in the
   * bundle, which is a thing nobody plays. */
  const chart = IO.parseExercise(read('rock-backbeat.json'), 'x').chart;
  const two = chart.events.find((e) => Math.abs(e.beat - 1) < 1e-6);
  assert.ok(two.voices.includes('HH') && two.voices.includes('SN'), 'beat 2 is a stack');
  assert.equal(tabOf(chart, 'SN')[4], 'X');
  assert.equal(tabOf(chart, 'HH')[4], 'o', 'the hi-hat was accented along with the snare');
});

test('the rock beat leads the list, and is playable on the default layout', () => {
  /* Somebody who has just installed a drum trainer wants a drum beat. */
  assert.equal(manifest.entries[0].id, 'rock-backbeat');
  const c = IO.parseExercise(read('rock-backbeat.json'), 'rock-backbeat').chart;
  assert.equal(layoutForChart(c), 'kit');
  assert.ok(c.bpm <= 100, `${c.bpm} is too fast to lead with`);
});

/* ---- a practice has a length -------------------------------------------- */

test('every bundled drill states how long it is, and none is endless', () => {
  for (const e of manifest.entries) {
    const c = IO.parseExercise(read(e.file), e.id).chart;
    assert.ok(Number.isInteger(c.repeats), `${e.id} has no repeats`);
    assert.ok(c.repeats > 0, `${e.id} is endless — a practice must finish`);
    const secs = practiceSeconds(c);
    assert.ok(secs > 8 && secs < 180, `${e.id} runs ${Math.round(secs)}s`);
  }
});

test('repeats is validated as a whole number, and 0 means endless', () => {
  const mk = (repeats) => IO.validateExercise({
    name: 'n', repeats, events: [{ beat: 0, voices: ['SN'] }],
  });
  assert.equal(mk(0).length, 0, '0 is endless and legal');
  assert.equal(mk(8).length, 0);
  assert.ok(mk(-1).length);
  assert.ok(mk(1.5).length);
  assert.ok(mk(999).length);
  assert.ok(mk('lots').length);
});

test('a file that says nothing about length still ends', () => {
  const c = IO.parseExercise(JSON.stringify({
    name: 'x', events: [{ beat: 0, voices: ['SN'] }],
  }), 'x').chart;
  assert.equal(c.repeats, IO.DEFAULT_REPEATS);
  assert.ok(c.repeats > 0, 'silence about length must not mean forever');
});

test('per-voice dynamics are validated against the voices actually played', () => {
  const ok = IO.validateExercise({
    name: 'n', events: [{ beat: 0, voices: ['HH', 'SN'], dyn: { SN: 'accent' } }],
  });
  assert.deepEqual(ok, []);
  assert.ok(IO.validateExercise({
    name: 'n', events: [{ beat: 0, voices: ['HH'], dyn: { SN: 'accent' } }],
  }).length, 'a dynamic for a voice the stack does not play');
  assert.ok(IO.validateExercise({
    name: 'n', events: [{ beat: 0, voices: ['HH'], dyn: { HH: 'loud' } }],
  }).length);
});

/*
 * A DRAG IS TWO GRACE NOTES. drag.json was byte-for-byte flam.json, and the
 * drag tap and both ratamacues wrote their drags with ONE grace note — a flam
 * spelled with a drag's name. Every drag in the drag family has two, from the
 * hand opposite its main stroke, ahead of it.
 */
test('every drag is two grace notes from the other hand, and Drag is not Flam', () => {
  const chart = (id) => IO.parseExercise(read(`${id}.json`), id).chart;
  assert.notDeepEqual(chart('drag').events, chart('flam').events);
  for (const e of manifest.entries.filter((x) => x.category === 'drags' && x.id !== 'single-dragadiddle')) {
    const evs = chart(e.id).events;
    for (let i = 0; i < evs.length; i++) {
      const v = evs[i];
      if (v.dyn !== 'ghost') continue;
      const next = evs[i + 1];
      if (next && next.dyn === 'ghost') {
        /* A drag before beat 0 sits at the end of the loop: its main stroke
         * is the loop's first. */
        const main = evs[(i + 2) % evs.length];
        assert.ok(main && main.hand !== v.hand && next.hand === v.hand, `${e.id}: a drag at ${v.beat} is not ll R`);
        i++;
      } else {
        assert.fail(`${e.id}: a lone grace note at ${v.beat} — a flam, not a drag`);
      }
    }
  }
});
