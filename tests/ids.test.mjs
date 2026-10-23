// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber

import test from 'node:test';
import assert from 'node:assert/strict';
import * as ID from '../src/ids.mjs';

test('a rung id is made and read back, colons in the drill id and all', () => {
  for (const base of ['rock-backbeat', 'subdiv:quarters', 'displace:rock-backbeat:1']) {
    for (let level = 0; level <= ID.MAX_LEVEL; level++) {
      assert.deepEqual(ID.parseLevelId(ID.levelItemId(base, level)), { base, level });
    }
  }
  assert.equal(ID.parseLevelId('flam'), null);
  assert.equal(ID.parseLevelId('x:l5'), null, 'there is no fifth rung');
  assert.equal(ID.isUntimedId('songo:l0'), true);
  assert.equal(ID.isUntimedId('songo:l1'), false);
  assert.equal(ID.isUntimedId(undefined), false);
  assert.deepEqual(ID.higherLevelIds('g:l2'), ['g:l3', 'g:l4']);
  assert.deepEqual(ID.higherLevelIds('g:l4'), []);
  assert.deepEqual(ID.higherLevelIds('flam'), []);
});

test('a quiz item carries its pool; the Clock carries its variant', () => {
  assert.equal(ID.quizItemId('guess', 'voice'), 'quiz:guess:voice');
  assert.equal(ID.quizItemId('guess', 'voice', 'kit3'), 'quiz:guess:voice:kit3');
  assert.equal(ID.isQuizItemId('quiz:pick:groove'), true);
  assert.equal(ID.isQuizItemId('flam'), false);
  assert.equal(ID.clockItemId(), 'clock');
  assert.equal(ID.clockItemId('gap1'), 'clock:gap1');
  assert.notEqual(ID.clockItemId('gap1'), ID.clockItemId('24'), 'each variant is its own item');
  assert.equal(ID.isClockItemId('clock:24'), true);
  assert.equal(ID.isClockItemId('clockwork'), false);
});

test('a record id reads back as written, and names the item it belongs to', () => {
  const opts = { strictness: 'tight', sticking: 'strict' };
  for (const [kind, id] of [['drill', 'rock-backbeat:l3'], ['ladder', 'subdiv:quarters'], ['untimed', 'songo:l0']]) {
    const d = ID.drillId(kind, id, opts);
    assert.deepEqual(ID.parseDrillId(d), { kind, id, strictness: 'tight', sticking: 'strict' });
    assert.equal(ID.itemOfDrillId(d), id);
  }
  assert.equal(ID.drillId('drill', 'flam', { strictness: 'normal', sticking: 'off' }), 'drill:flam:normal');
  assert.equal(ID.itemOfDrillId('clock:reading:4:normal'), 'clock');
  assert.equal(ID.itemOfDrillId('pick:subdiv:qe'), 'quiz:pick:subdiv:qe');
  assert.equal(ID.itemOfDrillId('guess:voice'), 'quiz:guess:voice');
  assert.equal(ID.itemOfDrillId('nonsense:x'), null);
});

test('a tour is its own item, and no quiz', () => {
  assert.equal(ID.tourItemId('pads'), 'tour:pads');
  assert.ok(ID.isTourItemId('tour:pads'));
  assert.ok(!ID.isTourItemId('quiz:guess:voice'));
  assert.ok(!ID.isQuizItemId('tour:pads'));
});
