/*
 * menu.mjs — what the drill list contains, and in what order. Pure.
 *
 * Extracted from ui.js because it is a DECISION, not host glue: it settles
 * what somebody sees the first time they open the module, and that is worth
 * being able to test without a Move attached.
 *
 * THE EAR TRAINING LEADS. Knowing a drum by its sound, and a subdivision by
 * its feel, is what the rest of the module is built on — you cannot play a
 * groove you cannot hear. The drills follow, and the things that are ABOUT
 * practising rather than practice itself go to the bottom.
 */

import { availableLevels } from './levels.mjs';

/*
 * `fileCharts` arrives in manifest order, which index.json already groups.
 * A groove with more than one rung opens its LADDER rather than starting at
 * the top — the rungs are projections of the one file, so this costs no extra
 * material and nearly every groove has one.
 */
export function buildMenu({ fileCharts = [], generated = [], quizzes = [] } = {}) {
  const items = [];
  for (const d of quizzes) {
    items.push({ kind: 'quiz', label: d.name, quiz: d });
  }
  for (const c of fileCharts) {
    const levels = availableLevels(c);
    if (levels.length > 1) {
      items.push({ kind: 'levels', label: c.name, value: '>', chart: c, levels });
    } else {
      items.push({ kind: 'chart', label: c.name, chart: c });
    }
  }
  for (const c of generated) {
    items.push({ kind: 'chart', label: c.name, chart: c });
  }
  items.push({ kind: 'ladder', label: 'Ladder' });
  items.push({ kind: 'clock', label: 'Clock' });
  items.push({ kind: 'progress', label: 'Progress' });
  return items;
}

/* The rows the list draws — label on the left, marker on the right. */
export function menuRows(items) {
  return items.map((m) => ({ label: m.label, value: m.value || '' }));
}
