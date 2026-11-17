import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'portal/assets/opus/course-progress.js'), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const progress = sandbox.window.HUB_PROGRESS;

function memory(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem() {
      throw new Error('course progress mapping must not write storage');
    },
  };
}

function same(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function put(rows) {
  const initial = {};
  for (const [key, value] of Object.entries(rows)) initial[key] = JSON.stringify(value);
  return memory(initial);
}

const long = '这是一段足够长的练习记录';

test('NMR completion maps lesson ids and ignores legacy, position, and answers', () => {
  const done = progress.idsFor('nmr', put({
    'nmr-from-zero.progress.v2': {
      completed: ['2-1'],
      lastLesson: '1-3',
      answers: { '1-1': 0 },
      positions: { '2-1': 'check' },
      readingMode: 'all',
      legacy: { completed: ['1-1', '3-2'], answers: {} },
    },
    'nmr-from-zero.progress.v1': { completed: ['9-9'] },
  }));
  same(done, ['nmr-2-1']);
});

test('NMR empty completed stays empty when only legacy or browsing fields exist', () => {
  const done = progress.idsFor('nmr', put({
    'nmr-from-zero.progress.v2': {
      completed: [],
      lastLesson: '2-1',
      answers: { '2-1': 1 },
      positions: { '2-1': 'formula' },
      legacy: { completed: ['2-1'] },
    },
  }));
  same(done, []);
});

test('removing an NMR completion drops it from the summary', () => {
  const store = put({ 'nmr-from-zero.progress.v2': { completed: ['2-1', '2-2'] } });
  same(progress.idsFor('nmr', store), ['nmr-2-1', 'nmr-2-2']);
  store.getItem = () => JSON.stringify({ completed: ['2-2'] });
  same(progress.idsFor('nmr', store), ['nmr-2-2']);
});

test('AI weekly completion counts only completed true, not drafts or resume', () => {
  const done = progress.idsFor('ai', put({
    'learning-atlas:weekly-study': {
      'week-01': { completed: true, phase: 3, practice: { work: '草案也留着' } },
      'week-02': { completed: false, phase: 2, practice: { work: '只写到一半' } },
      'elective-16': { completed: true },
      'not-a-lesson': { completed: true },
    },
    'learning-atlas:weekly-resume': 'week-02',
    'learning-atlas:day-one-experiment': '实验草案',
    'learning-atlas:day-one-judgment-draft': '判断草稿',
    'learning-atlas:chapters': ['s1'],
    'learning-atlas:day-one-complete': false,
  }));
  same(done.sort(), ['elective-16', 'week-01']);
});

test('AI day-one completion is the boolean flag, not the experiment draft', () => {
  same(progress.idsFor('ai', put({ 'learning-atlas:day-one-complete': true })), ['ai-day1']);
  same(progress.idsFor('ai', put({
    'learning-atlas:day-one-complete': false,
    'learning-atlas:day-one-experiment': '很长的实验记录也不算完成',
  })), []);
});

test('game completion requires a finished study that can actually finish', () => {
  const ready = {
    finished: true,
    practice: long,
    reasoning: {
      submitted: true,
      judgment: long,
      evidence: long,
      verification: long,
      reflection: long,
    },
  };
  const done = progress.idsFor('game', put({
    'game-design-atlas:learning:v1': {
      1: { complete: false, draft: '项目草案', study: ready },
      2: { complete: true, study: { finished: false, practice: long, reasoning: { submitted: false } } },
      3: { study: { finished: true, practice: '短', reasoning: { submitted: true, judgment: long, evidence: long, verification: long, reflection: long } } },
      4: { study: { finished: true, practice: long, position: 'check', reasoning: { submitted: true, judgment: '短', evidence: long, verification: long, reflection: long } } },
    },
    'game-design-atlas:resume:v1': '1',
  }));
  same(done, ['game-w01']);
});

test('undoing a game finish removes the catalog id', () => {
  const study = {
    finished: false,
    practice: long,
    reasoning: { submitted: true, judgment: long, evidence: long, verification: long, reflection: long },
  };
  same(progress.idsFor('game', put({ 'game-design-atlas:learning:v1': { 1: { study } } })), []);
});

test('present keeps only ids that exist in the catalog', () => {
  const store = put({ 'nmr-from-zero.progress.v2': { completed: ['2-1', '9-9'] } });
  same(progress.present('nmr', ['nmr-2-1', 'nmr-1-1'], store), { 'nmr-2-1': true });
});

test('corrupt or missing stores stay empty and unknown courses stay empty', () => {
  const broken = memory({ 'nmr-from-zero.progress.v2': '{', 'learning-atlas:weekly-study': '[]', 'game-design-atlas:learning:v1': 'null' });
  same(progress.idsFor('nmr', broken), []);
  same(progress.idsFor('ai', broken), []);
  same(progress.idsFor('game', broken), []);
  same(progress.idsFor('p1', memory()), []);
});
