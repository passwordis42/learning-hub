import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLightRoute, applyQuestAction, checkPuzzleAttempt, compareJumpWindows, makeQuestState } from '../docs/genre-labs-16-19.js';

test('a jump window can trade fewer missed inputs for more unwanted jumps', () => {
  const { a, b, rows } = compareJumpWindows([[-15, true], [40, true], [45, false], [75, false]], 25, 45);
  assert.deepEqual(a, { expected: 1, missed: 1, unexpected: 0 });
  assert.deepEqual(b, { expected: 2, missed: 0, unexpected: 1 });
  assert.equal(rows[2].b, '意外起跳');
  assert.equal(rows[3].b, '按意图离台');
});

test('moving one light shield reverses the safer detour, while the direct route stays shorter', () => {
  const a = ['upper', 'middle', 'lower'].map((route) => analyzeLightRoute('a', route));
  const b = ['upper', 'middle', 'lower'].map((route) => analyzeLightRoute('b', route));
  assert.deepEqual(a.map(({ exposed }) => exposed), [2, 3, 3]);
  assert.deepEqual(b.map(({ exposed }) => exposed), [3, 3, 2]);
  assert.deepEqual(a.map(({ turns }) => turns), [8, 6, 8]);
  assert.deepEqual(b.map(({ turns }) => turns), [8, 6, 8]);
});

test('puzzle direction applies to both arrangements and misplaced choices report the first mismatch', () => {
  assert.deepEqual(checkPuzzleAttempt('left', ['圆形', '方形', '星形']), { success: true, firstMismatch: 0 });
  assert.deepEqual(checkPuzzleAttempt('right', ['圆形', '方形', '星形']), { success: false, firstMismatch: 1 });
  assert.deepEqual(checkPuzzleAttempt('right', ['方形', '星形', '圆形']), { success: false, firstMismatch: 2 });
  assert.equal(checkPuzzleAttempt('right', ['方形', '圆形', '星形']).success, true);
});

test('the lower entry cost does not guarantee the better build for the optional rescue objective', () => {
  const act = (steps, build) => steps.reduce((state, action) => applyQuestAction(state, build, action).state, makeQuestState(5));
  const tech = { repair: 2, bypass: 3, rescue: 1 };
  const scout = { repair: 4, bypass: 1, rescue: 3 };
  const techWithRescue = act(['repair', 'retrieve', 'rescue', 'return'], tech);
  const scoutWithoutRescue = act(['bypass', 'retrieve', 'return'], scout);
  const scoutWithRescue = act(['bypass', 'retrieve', 'rescue', 'return'], scout);
  assert.equal(techWithRescue.done && techWithRescue.rescue, true);
  assert.equal(techWithRescue.stamina, 0);
  assert.equal(scoutWithoutRescue.done, true);
  assert.equal(scoutWithoutRescue.stamina, 2);
  assert.equal(scoutWithRescue.rescue, true);
  assert.equal(scoutWithRescue.done, false);
  assert.equal(scoutWithRescue.stamina, 0);
});
