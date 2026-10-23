// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

/*
 * preview.mjs — render the real drawing code into a 128x64 buffer and print
 * it as ASCII. Not shipped.
 *
 * Every frame is a pure function of (run, songBeats, settings), so any
 * instant of any drill can be dumped and looked at without a Move. That is
 * also how the rendering tests work, and why they can assert on pixels.
 *
 *   npm run preview -- --list
 *   npm run preview -- --exercise single-paradiddle --beats 0.5
 *   npm run preview -- --exercise rock-backbeat --view grid --film 0,1,2,3
 *   npm run preview -- --screen summary
 *   npm run preview -- --exercise rock-backbeat --beats 20 --sloppy
 *   npm run preview -- --exercise rock-backbeat --untimed --cursor 0,3,8 --view grid
 *   npm run preview -- --exercise rock-backbeat --screen untimed-summary
 *   npm run preview -- --exercise kit --px 14 --film 2,8,14,20   (all 21 voices engraved)
 *   npm run preview -- --screen padmap --layout mirror --flip
 *   npm run preview -- --screen ready --level 0..4 [--done] [--beats N] [--part K]
 *                       (the split box: LEVEL at the right, the level's name on the bottom line)
 *   npm run preview -- --screen menu      (the top list, its hint line; --shift for Shift's)
 *   npm run preview -- --screen sheet     (the action sheet of a stage)
 *   npm run preview -- --screen help      (MENU's help on the list; --top N scrolls it)
 *   npm run preview -- --screen welcome --page 0|1|2|3
 *   npm run preview -- --screen tip --tip sheet|practice|quiz|placement [--top N]
 *   npm run preview -- --screen map --level world|island [--to N --t ms]   (stage 0 done, 1 current;
 *                       --to walks the avatar to place N and draws it --t ms into the walk)
 *   npm run preview -- --screen home [--items practice|quiz [--other]]   (a ring: the top, Practice
 *                       or Quiz)
 *   npm run preview -- --screen home [--selected N] [--from M --t ms]   (the five circles; --from
 *                       grows N out of M, --t ms into the 160 ms grow)
 *   npm run preview -- --screen map-sheet   (a stage's options on the map, with Show as list)
 *   npm run preview -- --screen map --level island --stage 0 --fresh [--walked]
 *                       (stage 0 from the start: Meet the pads not walked, or walked)
 *   npm run preview -- --screen tour --stop 0      (Meet the pads; --stop 99 is the end page,
 *                                                   --struck SN a wrong pad named)
 *   npm run preview -- --screen scene --case place|stage|checkpoint [--scene N] [--t ms]
 *   npm run preview -- --screen star [--quiz] [--t ms]   (a level learned: its star frame)
 *                       (a scene of the Learning Path: scene N of the plan, --t ms into it)
 *   npm run preview -- --screen pick --layout mpc|gm|custom [--choice N] [--struck N]
 *                       (Pick: drum on the kit's pads; custom is MPC Classic without the
 *                        ride, so one answer is on the jog only)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createScreen, toAscii } from './screen_buffer.mjs';
import * as V from '../src/view.mjs';
import { createRun, ensureEntries, judgeHit, expireMissed } from '../src/scoring.mjs';
import { builtins } from '../src/generator.mjs';
import { parseExercise, parseManifest } from '../src/exercise_io.mjs';
import { createLadder } from '../src/ladder.mjs';
import { DEFAULTS } from '../src/settings_def.mjs';
import * as PROG from '../src/progress.mjs';
import * as L from '../src/layout.mjs';
import * as UT from '../src/untimed.mjs';
import { projectLevel } from '../src/levels.mjs';
import { VOICES } from '../src/kit.mjs';
import { resolveLayout, PRESETS } from '../src/padmap.mjs';
import * as Q from '../src/guess.mjs';
import * as AP from '../src/answer_pads.mjs';
import * as H from '../src/hints.mjs';
import * as HP from '../src/help.mjs';
import * as TIPS from '../src/tips.mjs';
import { LABELS } from '../src/row_sheet.mjs';
import * as PLAN from '../src/program.mjs';
import * as MP from '../src/map_places.mjs';
import * as SCN from '../src/scenes.mjs';
import * as SV from '../src/scene_view.mjs';
import { createWalk, walkTo, posAt } from '../src/pathmap/walk.mjs';
import { RANDOM_DRILLS } from '../src/generator.mjs';
import * as CAT from '../src/catalog.mjs';
import { DRILLS } from '../src/guess.mjs';
import * as HOME from '../src/home/render.mjs';
import { PRACTICE_DRUMS } from '../src/home/icons.mjs';

/* The real Path, with stage 0 through on its checkpoint and stage 1 begun, for
 * the map previews: every state shows somewhere. */
function samplePath({ fresh = false, walked = false } = {}) {
  const man = parseManifest(readFileSync(new URL('index.json', exDir), 'utf8'));
  const entries = man.entries.map((e) => ({ chart: parseExercise(readFileSync(new URL(e.file, exDir), 'utf8'), e.id).chart,
    category: e.category }));
  const ids = new Set([...builtins({}).map((c) => c.family), ...RANDOM_DRILLS.map((d) => d.family), 'clock']);
  const program = PLAN.buildProgram({ entries, categories: man.categories, has: (id) => ids.has(id) });
  const progress = PROG.emptyProgress();
  if (walked) PROG.recordTour(progress, 'tour:pads', Date.UTC(2026, 9, 1));
  if (fresh) return { program, progress, folder: PLAN.programFolder(program) };
  const take = (id, speed) => PROG.recordTake(progress, id, { speed, accuracy: 1, sd: 10, clean: true, bpm: 90,
    at: Date.UTC(2026, 9, 1) });
  take('first-beat:l3', 100);
  take('subdiv:eighths', 100);
  take('rock-backbeat:l1', 60);
  PROG.skipItem(progress, 'quiz:pick:subdiv:qe', 1);
  PROG.skipItem(progress, 'quiz:pick:voice', 1);
  return { program, progress, folder: PLAN.programFolder(program) };
}
import * as PT from '../src/pad_tour.mjs';
import { parseLessons } from '../src/lessons.mjs';

const exDir = new URL('../src/exercises/', import.meta.url);

function allDrills() {
  const out = builtins({ bpm: DEFAULTS.bpm }).slice();
  const man = parseManifest(readFileSync(new URL('index.json', exDir), 'utf8'));
  for (const e of man.entries) {
    const r = parseExercise(readFileSync(new URL(e.file, exDir), 'utf8'), e.id);
    if (r.chart) out.push(r.chart);
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const drills = allDrills();
/* The whole kit, one voice a beat in staff order: the engraving to review. */
drills.push({
  id: 'kit', name: 'The kit', bpm: 60, timeSig: [4, 4], loopBars: 6, repeats: 1, sticking: 'off',
  events: VOICES.map((v, i) => ({ beat: i, voices: [v.id] })),
});
if (arg('list', false)) {
  for (const d of drills) console.log(`${d.id}\t${d.name}`);
  process.exit(0);
}


/* Without this the preview plays every note 2.7ms late — machine-perfect — and
 * the header's spread reads 0. */
const sloppy = arg('sloppy', false) !== false;
const id = String(arg('exercise', 'single-paradiddle'));
const chart = drills.find((d) => d.id === id) || drills[0];
const view = String(arg('view', 'staff'));
const px = Number(arg('px', DEFAULTS.pxPerBeat));
const looping = !arg('once', false);
const screen = arg('screen', null);

/* Play everything behind the playhead, so the picture shows a drill in
 * progress rather than a wall of misses. */
function runAt(beats, { sloppy = false } = {}) {
  const run = createRun(chart, {
    looping, sticking: chart.sticking, strictness: DEFAULTS.strictness, dynamics: true,
  });
  ensureEntries(run, beats + 8);
  for (const e of run.entries) {
    if (e.beat >= beats) break;
    for (const n of e.notes) {
      const off = sloppy ? (Math.sin(e.beat * 7.3) * 0.04) : 0.004;
      judgeHit(run, {
        voice: n.voice,
        hand: sloppy && Math.sin(e.beat * 3.1) > 0.7
          ? (n.wantHand === 'R' ? 'L' : 'R') : n.wantHand,
        velocity: n.wantDyn === 'accent' ? (sloppy ? 60 : 115) : 95,
      }, e.beat + off);
    }
  }
  expireMissed(run, beats);
  return run;
}

/*
 * An L0 take stepped up to stack `upTo`, each stack struck together 500ms
 * after the last. With --sloppy the third stack is struck apart first.
 */
function untimedAt(upTo, { sloppy = false } = {}) {
  const c = projectLevel(chart, 'l0') || { ...chart, untimed: true, repeats: 2 };
  const run = createRun(c, { sticking: c.sticking, strictness: DEFAULTS.strictness, dynamics: true });
  const u = UT.createUntimed(run, { togetherMs: 60 });
  let t = 0;
  while (!u.finished && u.index < upTo) {
    const e = UT.current(u);
    if (sloppy && u.index === 2) {
      UT.press(u, { voice: e.notes[0].voice, velocity: 90 }, t);
      UT.expire(u, t + 100);
      t += 200;
    }
    for (const n of e.notes) UT.press(u, { voice: n.voice, hand: n.wantHand, velocity: n.wantDyn === 'accent' ? 120 : 90 }, t);
    t += 500;
  }
  return { c, run, u };
}

function untimedState({ c, run, u }) {
  return {
    run, chart: c, view, dynamics: true, cursor: u.index, done: u.finished, title: c.name,
    rightLabel: u.livePace > 0 ? `${Math.round(u.livePace)}bpm` : '--',
    footerRight: `${u.firstTry}/${u.stacks - u.firstTry}`, progress: UT.progress(u),
  };
}

function dump(label, ctx) {
  console.log(`--- ${label} ---`);
  console.log(toAscii(ctx, { ruler: Boolean(arg('ruler', false)) }));
  console.log();
}

/* The ready box's LEVEL and bottom line for --level N (0..4; --done marks
 * it learned), as ui.js hands them over: the keys beside the level's name. */
function readyLevel(n) {
  if (arg('level', null) === null && n !== 0) return { hint: H.hintFor(H.SCREENS.READY)[0] };
  const names = ['Own pace', 'Time only', '+ kick', '+ snare', 'Everything'];
  const left = `L${n}  ${names[n]}`;
  const parts = H.besideParts(left, H.hintFor(H.SCREENS.READY,
    { levels: true, untimed: n === 0, width: Math.max(7, 21 - left.length - 2) }));
  const part = parts[Number(arg('part', 0)) % parts.length];
  return { level: { digit: String(n), down: n > 0, up: n < 4, done: Boolean(arg('done', false)) },
    hintLeft: part[0], hint: part[1] };
}

if (screen) {
  const ctx = createScreen();
  const run = runAt(8, { sloppy: true });
  if (screen === 'summary') {
    /* The shape ui.js resultOf hands over. By default the reported take —
     * every note hit at tempo, every accent soft; --clean a take that counted. */
    const clean = Boolean(arg('clean', false));
    const h = [[0, 100, 83, 24, 4], [1, 100, 83, 12, 4]];
    if (clean) h.push([2, 100, 98, 14, 5]);
    V.drawSummary(ctx, {
      name: chart.name, bpm: chart.bpm, status: clean ? 'LEARNED' : 'NOT CLEAN',
      mark: clean ? PROG.MARK_DONE : null, clean, speed: 100, accuracy: clean ? 0.98 : 0.8333,
      share: 90, sdMs: clean ? 14 : 12, meanMs: 3, failAcc: !clean, failSd: false,
      cause: clean ? '' : '16 soft accents 74<83', limb: 'SN +3 s12',
      series: PROG.percentSeries(h, V.SUMMARY_PLOT.w - 2, V.SUMMARY_PLOT.h - 2),
      footer: H.hintFor(H.SCREENS.SUMMARY)[0],
    });
  }
  else if (screen === 'untimed-summary') {
    const h = [[0, 31, 81, 0, 8], [1, 38, 94, 0, 9], [2, 47, 100, 0, 9]];
    V.drawSummary(ctx, {
      name: chart.name, status: 'LEARNED', mark: PROG.MARK_DONE, clean: true, speed: 47,
      accuracy: 1, share: 90, failAcc: false, failSd: false, cause: '',
      sideA: '100% 1st try', sideB: `43 of ${chart.bpm}bpm`, rowLeft: '16 stacks', limb: '',
      series: PROG.percentSeries(h, V.SUMMARY_PLOT.w - 2, V.SUMMARY_PLOT.h - 2, PROG.UNTIMED_SCALE),
      footer: 'REC again  CLICK next',
    });
  } else if (screen === 'untimed-ready') {
    const st = untimedState(untimedAt(0));
    const lv = readyLevel(0);
    V.drawUntimedReady(ctx, { ...st, rightLabel: '16 stacks', footerRight: '', ready: true, ...lv });
  } else if (screen === 'ladder') {
    V.drawLadder(ctx, { ladder: Object.assign(createLadder({ bpm: 112 }), { rungs: 6 }), barsDone: 2 });
  } else if (screen === 'ready') {
    V.drawReady(ctx, {
      run: runAt(0), chart, bpm: chart.bpm, title: chart.name,
      songBeats: Number(arg('beats', 0)), pxPerBeat: px, view,
      dynamics: true, ready: true, ...readyLevel(Number(arg('level', 2))),
      rightLabel: Number(arg('beats', 0)) > 0 ? `${Math.floor(Number(arg('beats', 0)) / 4) + 1}/8` : '8 bars  0:21',
    });
  } else if (screen === 'padmap') {
    const lay = resolveLayout(String(arg('layout', 'mpc')), { flip: Boolean(arg('flip', false)) });
    V.drawPadMap(ctx, { title: lay.name, right: lay.flip ? 'flip' : '', grid: lay.grid, selected: [],
      footer: 'PAD hear CLICK edit' });
  } else if (screen === 'tour') {
    const { pads } = parseLessons(readFileSync(new URL('../src/lessons.json', import.meta.url), 'utf8'));
    const tour = PT.createTour(resolveLayout(String(arg('layout', 'mpc'))), { texts: pads,
      measure: (t) => ctx.textWidth(t), width: L.PAGE_FULL_PX });
    PT.skip(tour, Number(arg('stop', 0)));
    if (arg('struck', false)) PT.press(tour, String(arg('struck')), 0);
    const stop = PT.screenOf(tour);
    V.drawTour(ctx, { ...stop, footer: H.hintFor(H.SCREENS.TOUR, stop)[0] });
  } else if (screen === 'menu') {
    /* Continue on a step too long for the row: its rung, the whole step on top. */
    const items = [{ label: 'Continue', value: 'L0' }, { label: 'Learning Path', value: '>' },
      { label: 'Practice', value: '>' }, { label: 'Quiz', value: '>' }, { label: 'Progress', value: '' },
      { label: 'Settings', value: '>' }];
    const shift = Boolean(arg('shift', false));
    V.drawList(ctx, { title: 'FIRST BEAT L0', items, selected: 0,
      footer: H.hintFor(H.SCREENS.MENU, { depth: 1, shift })[0] });
  } else if (screen === 'sheet') {
    const items = [LABELS.skipAll, LABELS.start, LABELS.testOut, LABELS.lessons, LABELS.settings];
    V.drawList(ctx, { title: '1 EIGHTH NOTES', items, selected: 0, footer: H.hintFor(H.SCREENS.SHEET)[0] });
  } else if (screen === 'help') {
    const topics = HP.parseHelp(readFileSync(new URL('../src/help.json', import.meta.url), 'utf8'));
    const page = HP.helpPage(H.SCREENS.MENU, { st: { depth: 2, section: 'Learning Path' }, topics });
    V.drawPage(ctx, { title: page.title, lines: HP.fitPage(page.lines, (t) => ctx.textWidth(t)),
      top: Number(arg('top', 0)), footer: H.hintFor(H.SCREENS.HELP)[0] });
  } else if (screen === 'welcome') {
    const n = Number(arg('page', 0));
    const pages = TIPS.welcomePages();
    const page = pages[n];
    const footer = H.hintFor(H.SCREENS.WELCOME, { asks: Boolean(page.choices) })[0];
    if (page.choices) V.drawList(ctx, { title: page.title, items: page.choices, selected: 0, footer });
    else {
      V.drawPage(ctx, { title: page.title, right: `${n + 1}/${pages.length}`, footer,
        lines: HP.fitPage(page.items, (t) => ctx.textWidth(t)) });
    }
  } else if (screen === 'tip') {
    const key = String(arg('tip', 'sheet'));
    const lines = HP.fitPage(TIPS.tipItems(key), (t) => ctx.textWidth(t));
    V.drawPage(ctx, { title: TIPS.TIP_TITLE, lines, top: Number(arg('top', 0)),
      footer: H.hintFor(H.SCREENS.TIP, { scrolls: lines.length > L.PAGE_ROWS })[0] });
  } else if (screen === 'home') {
    /* A ring as ui.js draws it: the title, the circles, the hint line — the
     * top, or --items practice|quiz one level down (--other: with Other). */
    const ring = String(arg('items', 'top'));
    const rows = ring === 'practice'
      ? ['Subdivisions', 'Grooves', 'Rudiments', 'Random', ...(arg('other', false) ? ['Other'] : [])]
        .map((label) => [label, CAT.PRACTICE_ICONS[label]])
      : ring === 'quiz' ? DRILLS.map((d) => [d.name, CAT.QUIZ_ICONS[`${d.mode}:${d.kind}`]])
        : [['Learning Path', 'path'], ['Practice', PRACTICE_DRUMS], ['Quiz', 'quiz'], ['Progress', 'progress'],
          ['Settings', 'settings']];
    const items = rows.map(([label, icon]) => ({ key: label, label, icon }));
    const to = Number(arg('selected', 0));
    const grow = HOME.createGrow(Number(arg('from', to)));
    if (arg('from', null) !== null) HOME.startGrow(grow, to, 0);
    ctx.clear();
    ctx.text(1, 0, ring === 'top' ? 'DRUMS' : ring.toUpperCase(), 1);
    ctx.fillRect(0, L.HEADER_RULE_Y, L.SCREEN_W, 1, 1);
    HOME.drawHome(ctx, { items, selected: to, grow, now: Number(arg('t', 1000)) });
    V.drawHint(ctx, H.hintFor(H.SCREENS.HOME, { depth: ring === 'top' ? 1 : 2 })[0]);
  } else if (screen === 'pick') {
    /* Pick: drum, the eight core drums, on the kit's own pads. */
    const quiz = Q.createQuiz({ kind: 'voice', mode: 'pick', seed: 3 });
    Q.moveChoice(quiz, Number(arg('choice', 0)));
    if (arg('struck', null) !== null) quiz.eliminated.push(Number(arg('struck', 0)));
    const id = String(arg('layout', 'mpc'));
    const layout = id === 'custom'
      ? resolveLayout('custom', { custom: { rows: PRESETS.mpc.rows.map((r) => r.replace(/RD/g, '.')), pair: 'twin' } })
      : resolveLayout(id);
    const footer = H.hintFor(H.SCREENS.QUIZ, { pick: true, hintsLeft: 2, audible: true,
      warning: AP.padless(quiz.options, layout).map((v) => `NO ${v} ON PADS`)[0] || '' });
    V.drawQuiz(ctx, { quiz, title: 'PICK: DRUM', progress: '3/20', colours: AP.COLOUR_NAMES,
      padGrid: AP.kitGrid(quiz.options, layout), labelFor: (v) => Q.labelFor(quiz, v),
      shortFor: (v) => Q.shortFor(quiz, v), isEliminated: (i) => Q.isEliminated(quiz, i), hintsLeft: 2,
      footer: footer[Number(arg('part', 0)) % footer.length] });
  } else if (screen === 'star') {
    const sc = { kind: 'star', under: arg('quiz', false) ? 'result' : 'summary' };
    const learned = arg('quiz', false) ? SV.learnedOf({ result: { rate: 24.4, isBest: true } })
      : SV.learnedOf({ summary: { name: 'Rock backbeat L2', status: 'LEARNED', clean: true, speed: 100 } });
    const ms = Number(arg('t', 300));
    SV.drawScene(ctx, { scene: sc, args: SV.sceneArgs(sc, { seed: 1, learned, ctx }), ms, now: ms, learned,
      footer: H.hintFor(H.SCREENS.ANIM)[0] });
  } else if (screen === 'scene') {
    /* A scene of the Learning Path, from a real step and its plan. */
    const { program, folder } = samplePath({ fresh: true });
    const progress = PROG.emptyProgress();
    const at = Date.UTC(2026, 9, 1);
    const finish = (st) => (st.tour ? PROG.recordTour(progress, st.id, at)
      : st.quiz ? PROG.recordRound(progress, st.id, { correct: 20, wrong: 0, hinted: 0, at })
        : PROG.recordTake(progress, st.id, { speed: 100, accuracy: 1, sd: 10, clean: true, bpm: 90, at }));
    const core = PLAN.coreSteps(program.stages[0]);
    /* place: Time's quarters; stage: Meet the pads, the rest of stage 0 done
     * (its Groove 3 skipped); checkpoint: stage 0's checkpoint. */
    const which = String(arg('case', 'place'));
    let step = core.find((st) => st.tour);
    if (which === 'stage') {
      for (const st of core) if (st !== step && st.id !== 'first-beat:l3') finish(st);
      PROG.skipItem(progress, 'first-beat:l3', at);
    } else {
      finish(step);
      step = which === 'checkpoint' ? PLAN.checkpointSteps(program.stages[0])[0]
        : core.find((st) => st.id === 'subdiv:quarters');
    }
    const folders = folder.children.filter((c) => c.stage);
    const env = { atMs: at };
    const before = SCN.pathState(progress, program, folders, env);
    finish(step);
    const change = SCN.changes(before, SCN.pathState(progress, program, folders, env));
    const plan = SCN.pathScenes({ progress, program, folders, step, next: PLAN.stepAfter(progress, program, step, at),
      change, env });
    const n = Math.min(plan.length - 1, Number(arg('scene', 0)));
    const sc = plan[n];
    const ms = Number(arg('t', 0));
    const walk = SV.sceneWalk(sc, 0);
    SV.drawScene(ctx, { scene: sc, args: SV.sceneArgs(sc, { seed: n + 1 }), walk, now: ms, ms,
      footer: H.hintFor(H.SCREENS.ANIM)[0] });
    console.log(`scenes: ${plan.map((x) => x.kind).join(', ')}; showing ${n} (${sc.kind}) at ${ms} ms`);
  } else if (screen === 'map' || screen === 'map-sheet') {
    const { program, progress, folder } = samplePath({ fresh: Boolean(arg('fresh', false)),
      walked: Boolean(arg('walked', false)) });
    const island = arg('level', 'world') === 'island';
    const built = island
      ? MP.islandPlaces(progress, program, folder.children[Number(arg('stage', 1)) + 1], { atMs: Date.UTC(2026, 9, 2) })
      : MP.worldPlaces(progress, program, {});
    const layout = MP.mapLayout(island ? 'island' : 'world', built.places.length);
    const walk = createWalk(layout, MP.startPlace(built.places));
    const to = arg('to', null);
    const t = Number(arg('t', 0));
    if (to !== null) walkTo(walk, Number(to), 0);
    const place = built.places[posAt(walk, t).at];
    const head = MP.mapTitle(place, L.SCREEN_W - 2, (x) => ctx.textWidth(x));
    V.drawMapScreen(ctx, { title: head.title, right: head.right, places: built.places, layout, walk, now: t,
      footer: H.hintFor(H.SCREENS.MAP)[0] });
    if (screen === 'map-sheet') {
      const items = [LABELS.skipAll, LABELS.start, LABELS.testOut, LABELS.list, LABELS.settings];
      V.drawList(ctx, { title: '1 EIGHTH NOTES', items, selected: 3, footer: H.hintFor(H.SCREENS.SHEET)[0] });
    }
  } else if (screen === 'progress') {
    const h = [70, 75, 80, 78, 85, 90, 95, 100].map((pct, i) => [i, pct, 93, 24 - i * 2, i === 3 ? 4 : 5]);
    V.drawProgress(ctx, {
      title: chart.name, best: 100, bpm: chart.bpm, plays: h.length, done: true, isQuiz: false,
      last: h[h.length - 1],
      series: PROG.percentSeries(h, L.PROGRESS_PLOT.w - 2, L.PROGRESS_PLOT.h - 2),
    });
  } else {
    console.error(`unknown screen: ${screen}`);
    process.exit(1);
  }
  dump(`${screen} (${chart.name})`, ctx);
} else if (arg('untimed', false)) {
  for (const upTo of String(arg('cursor', '0')).split(',').map(Number)) {
    const ctx = createScreen();
    V.drawUntimedView(ctx, untimedState(untimedAt(upTo, { sloppy })));
    dump(`${chart.name} L0 @ stack ${upTo} (${view})`, ctx);
  }
} else {
  const frames = String(arg('film', arg('beats', '0'))).split(',').map(Number);
  for (const beats of frames) {
    const ctx = createScreen();
    V.drawReadingView(ctx, {
      run: runAt(beats, { sloppy }), chart, songBeats: beats, pxPerBeat: px, view,
      title: chart.name, bpm: chart.bpm, looping, dynamics: true,
      beatFlash: Math.abs(beats % 1) < 0.02,
    });
    dump(`${chart.name} @ beat ${beats} (${view})`, ctx);
  }
}
