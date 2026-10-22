// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * path_rows.mjs — what the Learning Path's rows say, and what clicking its
 * own rows changes. Pure.
 *
 * The path folder (program.mjs programFolder) holds what the path IS:
 * stages, tracks, steps, and rows with a job — Continue, Skip, Skip all here,
 * Your path. What each row SAYS depends on how far you have got, and what a
 * click on it changes depends on your progress and your choices; both are
 * decided here from the progress, so ui.js only applies and saves them.
 */

import * as PLAN from './program.mjs';
import { item, itemMark, itemValue, isParked, MARK_DONE, MARK_NEXT, MARK_SKIP, MARK_TRIED,
         INTROS } from './progress.mjs';
import { isUntimedId } from './ids.mjs';
import { isFolder } from './catalog.mjs';

/* What the list needs to know once for all of a folder's rows: the step
 * Continue would open (marked ▸) and the stage you are in. */
export function pathContext(progress, program, atMs) {
  const next = PLAN.continueStep(progress, program, atMs);
  return { progress, program, atMs, nextKey: next ? next.step.key : '', next,
    current: PLAN.currentStage(progress, program) };
}

/* What a "Skip" row skips: the next open step of its folder, or, at the top
 * of the path, the step Continue would open. */
export function skipTarget(row, progress, program, atMs) {
  if (row.scope) return PLAN.nextOpen(progress, row.scope, atMs);
  const next = PLAN.continueStep(progress, program, atMs);
  return next ? next.step : null;
}

/* "Skip all here": the open steps of the folder to skip — or, when nothing in
 * it is left to skip, the skips to take back. One row, so it is never more
 * than a click to undo. */
export function skipAllChange(scope, progress) {
  const open = scope.filter((st) => !PLAN.stepDone(progress, st) && !PLAN.stepSkipped(progress, st));
  if (open.length) return { skip: open.map((st) => st.id) };
  return { unskip: scope.filter((st) => PLAN.stepSkipped(progress, st)).map((st) => st.id) };
}

/* A row of Your path, clicked: a track or style toggled, or a choice moved
 * on to its next value. */
export function prefChange(row, path, stageCount) {
  if (row.group === 'tracks' || row.group === 'styles') return { toggle: [row.group, row.key] };
  if (row.group === 'rungs') return { set: ['rungs', path.rungs === 'full' ? 'short' : 'full'] };
  if (row.group === 'intros') {
    const i = INTROS.indexOf(path.intros);
    return { set: ['intros', INTROS[(i + 1) % INTROS.length]] };
  }
  if (row.group === 'start') return { set: ['start', ((path.start || 0) + 1) % Math.max(1, stageCount)] };
  return {};
}

/* What a Your path row shows as its value. */
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
 * A row of the Learning Path as the list shows it, or null for a row this
 * module does not speak for (a library drill, Repetition, a plain folder),
 * which the caller decorates as it does everywhere else.
 */
export function pathRow(row, pc) {
  const { progress, program } = pc;
  if (row.continueRow) {
    return pc.next
      ? { label: `Next: ${PLAN.stepTitle(pc.next.step)}`, value: '', mark: MARK_NEXT }
      : { label: 'All learned', value: '', mark: MARK_DONE };
  }
  if (row.skipRow) {
    const next = skipTarget(row, progress, program, pc.atMs);
    return { label: next ? `Skip: ${PLAN.stepTitle(next)}` : 'Skip: nothing left', value: '' };
  }
  if (row.skipAllRow) {
    const change = skipAllChange(row.scope, progress);
    return { label: change.unskip && change.unskip.length ? 'Unskip all here' : 'Skip all here', value: '' };
  }
  if (row.prefRow) return { label: row.label, value: prefValue(row, progress.path) };
  if (row.lessonsRow) return { label: row.label, value: '', mark: null };
  if (row.stage) {
    const sum = PLAN.stepsSummary(progress, row.steps);
    const mark = PLAN.stageComplete(progress, row.stage) ? MARK_DONE
      : row.stage === pc.current ? MARK_NEXT : null;
    return { label: row.label, value: sum.played ? `${sum.done}/${sum.count}` : '>', mark };
  }
  if (row.steps && isFolder(row)) {
    const sum = PLAN.stepsSummary(progress, row.steps);
    return { label: row.label, value: sum.played ? `${sum.done}/${sum.count}` : '>' };
  }
  if (row.step) return stepRowOf(row, pc);
  return null;
}
