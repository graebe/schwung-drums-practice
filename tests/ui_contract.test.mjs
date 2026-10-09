// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * Things about ui.js that are true of its TEXT, not of its behaviour.
 * Cheap, and they catch the two mistakes that are invisible on the device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('nothing in the draw path reads a parameter back', () => {
  /* host_module_get_param and shadow_get_param cost ~2.8ms each — more than a
   * whole frame. Naming them in a comment is fine; CALLING them is not. */
  const calls = src.match(/\b(host_module_get_param|shadow_get_param)\s*\(/g);
  assert.equal(calls, null, `forbidden call: ${calls}`);
});

test('the shared host modules are imported by absolute path', () => {
  /* A relative path resolves against the module directory and silently fails
   * to load, taking the whole tool with it. */
  assert.ok(src.includes("'/data/UserData/schwung/shared/input_filter.mjs'"));
  assert.ok(src.includes("'/data/UserData/schwung/shared/screen_reader.mjs'"));
});

test('LEDs go through the shared helpers, never raw MIDI', () => {
  /* The helpers handle LED caching and the USB-MIDI cable byte. Writing raw
   * note messages works until it floods the 64-packet out buffer. */
  assert.equal(/move_midi_internal_send/.test(src), false);
});

test('every sibling import is a real module', async () => {
  const names = [...src.matchAll(/from '\.\/([a-z_]+)\.mjs'/g)].map((m) => m[1]);
  assert.ok(names.length > 10);
  for (const n of names) {
    await import(new URL(`../src/${n}.mjs`, import.meta.url).href);
  }
});

test('ui.js declares all six lifecycle hooks', () => {
  for (const hook of ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal',
                      'onResume', 'onUnload']) {
    assert.ok(src.includes(`globalThis.${hook} =`), `${hook} is not declared`);
  }
});

test('incoming MIDI is decoded as a three-byte message, not a USB packet', () => {
  /*
   * THE BUG THIS PINS. The module shipped once reading data[1] as the status
   * byte, on the assumption that the host passed a four-byte USB-MIDI packet.
   * It does not — it passes [status, d1, d2]. Every press therefore decoded
   * its data byte as the status, matched no branch and was dropped: the
   * module drew its menu once and then ignored every input, which on the
   * device is indistinguishable from a freeze.
   *
   * It survived the whole test suite because the test helpers sent the
   * four-byte form too — the tests agreed with the code because both came
   * from the same misreading. So this asserts against the SHAPE OF THE
   * SOURCE, which is the only thing in the loop that did not.
   */
  const fn = src.slice(src.indexOf('function midiInner'), src.indexOf('function jog('));
  assert.match(fn, /const status = data\[0\]/, 'the status byte is data[0]');
  assert.match(fn, /const d1 = data\[1\]/);
  assert.match(fn, /const d2 = data\[2\]/);
  assert.equal(/data\[3\]/.test(fn), false, 'there is no fourth byte coming in');
});

test('the four-byte form is only ever used OUTBOUND', () => {
  /* move_midi_inject_to_move takes a cable nibble; nothing arrives that way. */
  const out = src.slice(src.indexOf('function serviceOutbox'));
  assert.match(out, /move_midi_inject_to_move\(\[\(2 << 4\)/);
});

/* Cut a function's body out of the source, failing loudly if it is not found:
 * an anchor that silently returned -1 would make every check below pass. */
function body(name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `function ${name} not found`);
  const end = src.indexOf('\n}\n', at);
  assert.ok(end > at, `the end of ${name} not found`);
  return src.slice(at, end);
}

test('a press is judged only while practising and running', () => {
  assert.match(body('padDown'), /if \(screen !== RUNNING \|\| !T\.judging\(tp\)\) return;/);
});

test('only the Settings screen hands a knob to editSetting', () => {
  const midi = body('midiInner');
  const knobs = midi.slice(midi.indexOf('THE KNOBS ARE CONTEXTUAL'));
  assert.ok(knobs.length > 0);
  const calls = knobs.match(/editSetting\(/g) || [];
  assert.equal(calls.length, 1, 'one call, inside the Settings branch');
  assert.match(knobs, /if \(screen === SETTINGS\) \{[\s\S]{0,200}editSetting\(/);
});

test('a whole take is recorded once, and a Ladder records itself', () => {
  const stop = body('stop');
  assert.match(stop, /!tp\.scrubbed/);
  assert.match(stop, /if \(whole && !ladder\) recordRun\(\)/);
});
