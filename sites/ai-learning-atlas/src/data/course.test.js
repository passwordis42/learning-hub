import assert from 'node:assert/strict';
import test from 'node:test';
import { dayOne, stages } from './course.js';

test('the learning route covers 40 chapters and 58 weeks with valid prerequisites', () => {
  assert.deepEqual(stages.map(({ id }) => id), ['s1', 's2', 's3', 's4', 's5', 's6a', 's6b', 's6c', 's6d', 's6e']);
  const seen = new Set();
  for (const stage of stages) {
    assert.equal(stage.weeks.length, Number.parseInt(stage.duration, 10));
    assert.ok(stage.resources.length && stage.project.acceptance && stage.startHere);
    if (stage.optional) assert.ok(stage.reason);
    for (const chapter of stage.chapters) {
      if (chapter.optional) assert.ok(chapter.reason);
      assert.ok(!seen.has(chapter.id));
      for (const required of chapter.requires) assert.ok(seen.has(required), `Chapter ${chapter.id} depends on ${required}`);
      seen.add(chapter.id);
    }
  }
  assert.deepEqual([...seen].sort((left, right) => left - right), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.equal(stages.reduce((sum, stage) => sum + stage.weeks.length, 0), 58);
});

test('the Day 1 sample matches its published answer', () => {
  const rows = dayOne.csv.trimEnd().split('\n').slice(1);
  const nonEmpty = rows.filter((row) => row !== ',');
  assert.equal(rows.length, 10);
  assert.equal(nonEmpty.length, 9);
  assert.equal(new Set(nonEmpty).size, dayOne.expectedRows);
  assert.equal(dayOne.steps.reduce((sum, step) => sum + step.minutes, 0), dayOne.minutes);
});
