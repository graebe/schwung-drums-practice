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
