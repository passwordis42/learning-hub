import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChanges, cleanRecords, combineChanges, emptyRecord, readRecords, readResumeWeek, recordsKey, resumeKey, validResumeWeek, weekChanges, writeRecords, writeResumeWeek } from '../docs/records.js';

const rebase = (latest, week, before, after) => applyChanges(latest, new Map([[week, weekChanges(before, after)]]));

test('a change from a stale tab preserves the latest progress on another week', () => {
  const base = emptyRecord();
  const tabA = rebase({}, 7, base, { ...base, study: { ...base.study, position: 'lab', practice: '提高供给会让三关都顺利完成' } });
  const tabB = rebase(tabA, 14, base, { ...base, draft: '邀请首次试玩者独立完成教程。' });
  assert.deepEqual(tabB[7], tabA[7]);
  assert.equal(tabB[14].draft, '邀请首次试玩者独立完成教程。');
});

test('stale tabs can add study notes and project evidence to the same week', () => {
  const base = emptyRecord();
  const tabA = rebase({}, 9, base, { ...base, evidence: '三名玩家在入口处犹豫过。' });
  const tabB = rebase(tabA, 9, base, { ...base, study: { ...base.study, practice: '同样的路口应该先保留对照组', answers: [1] } });
  assert.equal(tabB[9].evidence, tabA[9].evidence);
  assert.deepEqual(tabB[9].study.answers, [1]);
  assert.equal(tabB[9].study.practice, '同样的路口应该先保留对照组');
});

test('quiz answer patches merge independent responses including sparse arrays', () => {
  const base = emptyRecord();
  const tabA = rebase({}, 16, base, { ...base, study: { ...base.study, answers: [2] } });
  const tabB = rebase(tabA, 16, base, { ...base, study: { ...base.study, answers: [undefined, 1] } });
  assert.deepEqual(tabB[16].study.answers, [2, 1]);
});

test('unflushed patches collect independently and the latest edit wins for the same field', () => {
  const base = emptyRecord();
  const draft = { ...base, draft: '第一版规则' };
  const revised = { ...draft, draft: '第二版规则', study: { ...base.study, answers: [2] } };
  const result = applyChanges({}, new Map([[4, combineChanges(weekChanges(base, draft), weekChanges(draft, revised))]]));
  assert.equal(result[4].draft, '第二版规则');
  assert.deepEqual(result[4].study.answers, [2]);
});

test('resume has its own key, ignores out-of-range weeks and interoperates with old records', () => {
  const old = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try {
    const legacy = { 3: { draft: '体验地图版', verification: '已观察一轮', previousVerification: '更早的观察' } };
    assert.equal(writeRecords(legacy), true);
    assert.deepEqual(readRecords(), cleanRecords(legacy));
    assert.equal(readResumeWeek(), null);
    writeResumeWeek(16);
    assert.equal(readResumeWeek(), 16);
    assert.equal(data.get(recordsKey), JSON.stringify(legacy));
    assert.equal(data.get(resumeKey), '16');
    writeResumeWeek(29);
    assert.equal(readResumeWeek(), 16);
    assert.equal(validResumeWeek('16'), false);
  } finally {
    if (old === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = old;
  }
});
