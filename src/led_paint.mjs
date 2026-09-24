/*
 * led_paint.mjs — what colour every pad is. Pure, and ALLOCATION-FREE.
 *
 * Extracted from ui.js and kept pure for two reasons. It is the one piece of
 * host glue with real logic in it, so it is worth testing; and it runs on
 * every LED frame, where the pitched module records a 34k-allocations-per-
 * second path that had to be killed. So `paint` fills a caller-owned array
 * and builds nothing.
 *
 * PRIORITY, highest first. The order is the whole design:
 *
 *   judgement   what just happened to you        flash > everything
 *   pressed     where your finger is
 *   target      what is being asked for          only with Guide pads on
 *   base        what lives on this pad
 *
 * A judgement outranks a press because the press is still down when the
 * verdict arrives: showing the finger instead would hide the answer at
 * exactly the moment it is useful.
 */

import { PAD_FIRST, PAD_COUNT, padVoice, padHand,
         LED_OFF, LED_VOICE, LED_TARGET_FAR, LED_TARGET_NEAR,
         LED_PRESSED, LED_HIT, LED_STICK, LED_MISS, LED_PROMPT } from './padmap.mjs';

export const FLASH_MS = 180;

/* A judgement, for the flash layer. */
export function flashColor(judgement) {
  if (!judgement) return LED_OFF;
  if (judgement.result === 'stray' || judgement.result === 'missed') return LED_MISS;
  if (judgement.result === 'late') return LED_MISS;
  /* Right drum, wrong hand. Its own colour, because it is a different mistake
   * from a wrong drum, it is fixed differently, and sharing red with a miss
   * would make the two indistinguishable mid-bar. */
  if (judgement.handOk === false) return LED_STICK;
  if (judgement.dynOk === false) return LED_STICK;
  return LED_HIT;
}

/*
 * How close the next hit is, as a colour. Nothing when Guide pads is off:
 * this is a reading trainer first, and a lit pad is an answer.
 */
function targetColor(beatsAway) {
  if (beatsAway === null || beatsAway === undefined) return LED_OFF;
  if (beatsAway < 0.25) return LED_TARGET_NEAR;
  if (beatsAway < 1.5) return LED_TARGET_FAR;
  return LED_OFF;
}

/*
 * Fill `out` (length PAD_COUNT) with a colour per pad.
 *
 * `state` is:
 *   layout     which pad map is in force
 *   held       a Set-like with .has(pad), or null
 *   flash      { pads: [...], color } or null — the judgement, for FLASH_MS
 *   targets    [{ voice, hand, beatsAway }] or null, only when guiding
 *   prompt     [voice, ...] lit for a quiz prompt, or null
 *   dark       true to blank everything (the module is closing)
 */
export function paint(out, state) {
  const layout = state.layout;
  for (let i = 0; i < PAD_COUNT; i++) {
    const pad = PAD_FIRST + i;
    if (state.dark) {
      out[i] = LED_OFF;
      continue;
    }

    let c = padVoice(pad, layout) ? LED_VOICE : LED_OFF;

    if (state.prompt) {
      for (let k = 0; k < state.prompt.length; k++) {
        if (padVoice(pad, layout) === state.prompt[k]) c = LED_PROMPT;
      }
    }

    if (state.targets) {
      for (let k = 0; k < state.targets.length; k++) {
        const t = state.targets[k];
        if (padVoice(pad, layout) !== t.voice) continue;
        /* When the drill enforces sticking, only the hand being asked for
         * lights. Lighting both halves would answer the question. */
        if (t.hand && padHand(pad) !== t.hand) continue;
        const tc = targetColor(t.beatsAway);
        if (tc !== LED_OFF) c = tc;
      }
    }

    if (state.held && state.held.has(pad)) c = LED_PRESSED;

    if (state.flash && state.flash.pads) {
      for (let k = 0; k < state.flash.pads.length; k++) {
        if (state.flash.pads[k] === pad) c = state.flash.color;
      }
    }

    out[i] = c;
  }
  return out;
}

export { PAD_COUNT, PAD_FIRST };
