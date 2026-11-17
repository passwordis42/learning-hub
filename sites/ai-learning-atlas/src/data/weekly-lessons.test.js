import assert from 'node:assert/strict';
import test from 'node:test';
import { stages } from './course.js';
import { lessons01To19 } from './lessons-01-19.js';
import { lessons20To38 } from './lessons-20-38.js';
import { lessons39To58 } from './lessons-39-58.js';
import { electiveLessons } from './elective-lessons.js';
import { chapterLessons, electiveEntries, lessonEntries, weeklyEntries } from './lesson-index.js';
import { gradePractice, practiceReady } from './lesson-check.js';

const weeklyLessons = [...lessons01To19, ...lessons20To38, ...lessons39To58];
const anyText = (value) => typeof value === 'string' && Boolean(value.trim());

test('all 58 weeks and each of the 40 chapter listings link to an existing lesson', () => {
  assert.deepEqual(weeklyLessons.map(({ week }) => week), weeklyEntries.map(({ week }) => week));
  assert.deepEqual(weeklyLessons.map(({ title }) => title), weeklyEntries.map(({ title }) => title));
  assert.deepEqual(electiveLessons.map(({ chapter }) => chapter), electiveEntries.map(({ chapter }) => chapter));
  assert.deepEqual(electiveLessons.map(({ title }) => title), electiveEntries.map(({ title }) => title));
  assert.equal(lessonEntries.size, 63);
  for (const stage of stages) {
    for (const chapter of stage.chapters) {
      assert.ok(chapterLessons(chapter.id).length > 0, chapter.title);
    }
    const end = weeklyEntries.filter((entry) => entry.stage.id === stage.id).at(-1);
    const { project } = weeklyLessons[end.week - 1];
    assert.ok(anyText(project?.task) && anyText(project?.acceptance), 'Project at week ' + end.week);
  }
});

test('each published lesson has an explanation, demonstration, new practice data and feedback', () => {
  for (const lesson of [...weeklyLessons, ...electiveLessons]) {
    const label = lesson.week ? 'week ' + lesson.week : 'chapter ' + lesson.chapter;
    assert.ok(anyText(lesson.title) && anyText(lesson.plain), label);
    for (const key of ['actor', 'input', 'action', 'output']) assert.ok(anyText(lesson.flow[key]), label + ' ' + key);
    assert.ok(lesson.terms.length > 0, label);
    assert.equal(new Set(lesson.terms.map(({ word }) => word)).size, lesson.terms.length, label);
    for (const term of lesson.terms) assert.ok(['word', 'plain', 'academic', 'example'].every((key) => anyText(term[key])), label);
    assert.ok(anyText(lesson.demo.intro) && lesson.demo.steps.length === 3, label);
    assert.ok(lesson.demo.steps.every(({ action, result }) => anyText(action) && anyText(result)), label);
    const { practice } = lesson;
    assert.ok(['brief', 'data', 'hint', 'evidence'].every((key) => anyText(practice[key])), label);
    assert.ok(anyText(practice.work?.task) && anyText(practice.work?.reference), label);
    assert.notEqual(practice.work.task, practice.work.reference, label);
    assert.notEqual(practice.data, lesson.demo.intro, label);
    assert.equal(practice.questions.length, 2, label);
    assert.ok(practice.questions.some(({ options }) => !options), 'Independent answer in ' + label);
    for (const { prompt, options, answer, explanation, accepted } of practice.questions) {
      assert.ok(anyText(prompt) && anyText(explanation) && (Number.isFinite(answer) || anyText(answer)), label);
      if (options) {
        assert.ok(options.length > 1 && options.every(anyText), label);
        assert.equal(new Set(options).size, options.length, label);
        assert.ok(Number.isInteger(answer) && answer >= 0 && answer < options.length, label);
      }
      if (accepted) assert.ok(typeof answer === 'string' && accepted.every(anyText), label);
    }
    const answers = practice.questions.map(({ answer }) => String(answer));
    assert.equal(practiceReady(practice.questions, answers), true, label);
    assert.ok(gradePractice(practice.questions, answers).every(({ correct }) => correct), label);
  }
});

test('constructed answers check aliases, Unicode formatting and order', () => {
  const questions = [{ answer: 'A,B', accepted: ['A→B'] }];
  assert.equal(practiceReady(questions, ['   ']), false);
  assert.equal(practiceReady(questions, ['B,A']), true);
  assert.equal(gradePractice(questions, ['B,A'])[0].correct, false);
  assert.equal(gradePractice(questions, ['ａ、 b'])[0].correct, true);
  assert.equal(gradePractice(questions, ['a→b'])[0].correct, true);
});

test('numeric and choice inputs reject empty and malformed answers and accept decimal formatting', () => {
  const questions = [{ answer: -1.25 }, { options: ['A', 'B'], answer: 0 }];
  assert.equal(practiceReady(questions, ['', '0']), false);
  assert.equal(practiceReady(questions, ['  ', '0']), false);
  assert.equal(practiceReady(questions, ['0x1', '0']), false);
  assert.equal(practiceReady(questions, ['-1.25', '2']), false);
  assert.equal(practiceReady(questions, ['－１．２５', '0']), true);
  assert.equal(gradePractice(questions, ['−1.25', '0'])[0].correct, true);
  assert.deepEqual(gradePractice(questions, ['－１．２５', '1']).map(({ correct }) => correct), [true, false]);
});
