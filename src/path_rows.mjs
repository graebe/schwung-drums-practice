// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * path_rows.mjs — what the Path's rows say, what Continue offers, and what
 * a click on a Learning Path choice (Settings › Advanced) changes. Pure.
 *
 * The path folder (program.mjs programFolder) holds what the path IS:
 * stages, tracks, steps. What each row SAYS depends on how far you have got,
 * and what Continue opens depends on your progress, your choices and what is
 * due again today; all of it is decided here from the progress, so ui.js only
 * applies and saves it.
 */

import * as PLAN from './program.mjs';
import { item, itemMark, itemValue, isParked, repetitionSession, MARK_DONE, MARK_NEXT, MARK_SKIP,
         MARK_TRIED, INTROS } from './progress.mjs';
import { isUntimedId } from './ids.mjs';
import { isFolder } from './catalog.mjs';

/* The items due again today, most pressing first (progress.mjs). */
export function dueReviews(progress, atMs) {
  return repetitionSession(progress, atMs).filter((r) => !r.done).map((r) => r.id);
}

/*
 * What Continue opens: a review or the next step. When reviews are due it
 * alternates — one review, then one new step — on `turn`, which the caller
 * keeps for the session and turns over each time Continue is used. With no
 * new step left it offers reviews only; with none due, new steps only.
 * Returns { kind: 'review', id } | { kind: 'step', step, stage } | null.
 */
export function continuePick(progress, program, atMs, turn = 'review') {
  const due = dueReviews(progress, atMs);
  const next = PLAN.continueStep(progress, program, atMs);
  if (due.length && (!next || turn === 'review')) return { kind: 'review', id: due[0] };
  return next ? { kind: 'step', step: next.step, stage: next.stage } : null;
}

/* What the list needs to know once for all of a folder's rows: the step
 * Continue would open (marked ▸), what Continue offers, and the stage you
 * are in. `titleOf` names an item for a review. */
export function pathContext(progress, program, atMs, { turn = 'review', titleOf = (id) => id } = {}) {
  const next = PLAN.continueStep(progress, program, atMs);
  return { progress, program, atMs, nextKey: next ? next.step.key : '', next, titleOf,
    pick: continuePick(progress, program, atMs, turn), current: PLAN.currentStage(progress, program) };
}

/* "I know it all: skip" on a folder: the open steps it would skip, and the
 * skipped ones "Undo skip" would take back. */
export function skipAllChange(scope, progress) {
  const open = scope.filter((st) => !PLAN.stepDone(progress, st) && !PLAN.stepSkipped(progress, st));
  return { skip: open.map((st) => st.id),
    unskip: scope.filter((st) => PLAN.stepSkipped(progress, st)).map((st) => st.id) };
}

/* A row of Settings › Advanced › Learning Path, clicked: a track or style
 * toggled, or a choice moved on to its next value. */
export function prefChange(row, path) {
  if (row.group === 'tracks' || row.group === 'styles') return { toggle: [row.group, row.key] };
  if (row.group === 'rungs') return { set: ['rungs', path.rungs === 'full' ? 'short' : 'full'] };
  if (row.group === 'intros') {
    const i = INTROS.indexOf(path.intros);
    return { set: ['intros', INTROS[(i + 1) % INTROS.length]] };
  }
  return {};
}

/*
 * Continue's value in `chars`, so it leaves its label room on a 21-character
 * row: "Continue" and a space leave twelve. The whole title when it fits;
 * else only its rung — "L1", what tells two steps of a groove apart — or
 * nothing at all. The title bar names the whole step while the cursor is on
 * the row (titleWords), so the row never shows a name cut in half.
 */
export function fitValue(text, chars) {
  const s = String(text);
  if (s.length <= chars) return s;
  const last = s.split(' ').filter(Boolean).pop() || '';
  return /^L\d+$/.test(last) && last.length <= chars ? last : '';
}

/* `text` cut at a word to `chars`, for a title bar; a word too long on its
 * own is cut. */
export function titleWords(text, chars) {
  const words = String(text).split(' ').filter(Boolean);
  while (words.length > 1 && words.join(' ').length > chars) words.pop();
  return words.join(' ').slice(0, chars);
}

const ROW_CHARS = 21;

/* What a Learning Path choice shows as its value — Start at, on Settings
 * itself, included. */
export function prefValue(row, path) {
  if (row.group === 'tracks' || row.group === 'styles') return path[row.group][row.key] ? 'on' : 'off';
  if (row.group === 'start') return `Stage ${path.start || 0}`;
  return path[row.group] || '';
}

/*
 * A step of the path: done at ITS target, which may be short of a ✓ — the
 * spiral brings the drill back faster later — skipped, next, tried, or parked
 * for the day (`~`). Short of 100%, the best is read against the target: 45/60.
 */
export function stepRowOf(row, pc) {
  const { progress } = pc;
  const st = row.step;
  let mark = null;
  if (PLAN.stepDone(progress, st)) mark = MARK_DONE;
  else if (PLAN.stepSkipped(progress, st)) mark = MARK_SKIP;
  else if (st.key === pc.nextKey) mark = MARK_NEXT;
  else mark = itemMark(progress, st.id) === MARK_TRIED ? MARK_TRIED : null;
  if (!mark && isParked(progress, st.id, pc.atMs)) return { label: row.label, value: '~', mark };
  const it = item(progress, st.id);
  const timed = !st.quiz && !isUntimedId(st.id);
  let value = itemValue(progress, st.id);
  if (value && timed && st.target < 100) value = `${it.best}/${st.target}`;
  return { label: row.label, value, mark };
}

/*
 * A groove of the Path, one row for its rungs: the rung it would open and how
 * that stands — "L1 45/60" — and a tick once every rung is through.
 */
function levelRowOf(row, pc) {
  const st = PLAN.levelRowStep(row.steps, pc.progress, pc.nextKey);
  const one = stepRowOf({ label: row.label, step: st }, pc);
  const rung = st.label.split(' ')[0];
  const all = row.steps.every((x) => PLAN.stepDone(pc.progress, x));
  return { label: row.label, value: one.value ? `${rung} ${one.value}` : rung, mark: all ? MARK_DONE : one.mark };
}

/*
 * A groove of the library, one row for its rungs (catalog.mjs chartNode):
 * the highest rung played and its best — "L2 80%" — a tick once the top rung
 * is learned, which carries every rung below it, a ring when played but never
 * clean.
 */
export function levelValue(progress, levels) {
  let value = '';
  let tried = false;
  for (let i = levels.length - 1; i >= 0 && !value; i--) {
    const it = item(progress, levels[i].id);
    if (!it || !it.plays) continue;
    const v = itemValue(progress, levels[i].id);
    value = v ? `${levels[i].step} ${v}` : levels[i].step;
    tried = !v;
  }
  const top = levels[levels.length - 1];
  const mark = itemMark(progress, top.id) === MARK_DONE ? MARK_DONE : tried ? MARK_TRIED : null;
  return { value, mark };
}

/* The rung a groove opens on: the first not yet learned, else the last. */
export function defaultLevel(progress, levels) {
  const open = levels.findIndex((lv) => itemMark(progress, lv.id) !== MARK_DONE);
  return open >= 0 ? open : levels.length - 1;
}

/*
 * A row of the Path as the list shows it — and the Continue row, and the
 * rows of Settings › Path — or null for a row this module does not speak for
 * (a library drill, Review, a plain folder), which the caller decorates as it
 * does everywhere else.
 */
export function pathRow(row, pc) {
  const { progress } = pc;
  if (row.continueRow) {
    const pick = pc.pick;
    /* `title` is the whole step, for the title bar while the cursor is here. */
    if (pick && pick.kind === 'review') {
      const title = pc.titleOf(pick.id);
      return { label: 'Review', value: fitValue(title, ROW_CHARS - 'Review'.length - 1), mark: null, title };
    }
    const value = pick ? PLAN.stepTitle(pick.step) : 'all learned';
    return { label: row.label, value: fitValue(value, ROW_CHARS - row.label.length - 1), mark: null,
      title: pick ? value : '' };
  }
  if (row.prefRow) return { label: row.label, value: prefValue(row, progress.path) };
  if (row.lessonsRow) return { label: row.label, value: '', mark: null };
  if (row.stage) {
    const sum = PLAN.stepsSummary(progress, row.steps);
    const mark = PLAN.stageComplete(progress, row.stage) ? MARK_DONE
      : row.stage === pc.current ? MARK_NEXT : null;
    return { label: row.label, value: sum.played ? `${sum.done}/${sum.count}` : '>', mark };
  }
  if (row.levelRow) return levelRowOf(row, pc);
  if (row.steps && isFolder(row)) {
    const sum = PLAN.stepsSummary(progress, row.steps);
    return { label: row.label, value: sum.played ? `${sum.done}/${sum.count}` : '>' };
  }
  if (row.step) return stepRowOf(row, pc);
  return null;
}
