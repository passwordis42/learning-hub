import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendReading, archiveReadings, canArchiveExperiment, cleanReading, importExperiments,
  makeExperiment, readExperiments, saveExperiment
} from '../docs/experiments.js';
import { applyChanges, emptyRecord, weekChanges } from '../docs/records.js';
import { cleanStudy } from '../docs/study-progress.js';

const row = (label, value) => ({ label, value });
const reading = (capacity, fulfilled = capacity) => ({
  parameters: [row('加工产能', capacity)],
  results: [row('服务订单数', fulfilled)]
});
const prediction = '先扩充产能会减少中期急单的缺口。';
const reflection = '扩产减少了急单缺口，但第 4 轮仍需要维护。';

function withLocalStorage(run) {
  const prior = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); }
  };
  globalThis.localStorage = storage;
  try { run(storage); }
  finally {
    if (prior === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prior;
  }
}

test('starting a notebook preserves the learner prediction without executing a lab', () => {
  const record = makeExperiment(20, 'genre-management', '  ' + prediction + '  ');
  assert.equal(record.week, 20);
  assert.equal(record.lab, 'genre-management');
  assert.equal(record.prediction, prediction);
  assert.ok(record.id.length >= 8);
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  assert.equal(record.complete, false);
  assert.equal(record.latest, null);
  assert.deepEqual(record.readings, []);
  assert.equal(canArchiveExperiment(record), false);
});

test('a reading requires both sides and sanitizes values without changing its source', () => {
  const oversized = '测'.repeat(900);
  const raw = {
    parameters: [null, { label: 4, value: 'missing label' }, row('参'.repeat(120), oversized), row('电量', 4)],
    results: [row('状态', '已经返回'), row('非有限值', Infinity)]
  };
  const clean = cleanReading(raw);
  assert.equal(clean.parameters.length, 2);
  assert.equal(clean.parameters[0].label.length, 100);
  assert.equal(clean.parameters[0].value.length, 800);
  assert.equal(clean.parameters[1].value, 4);
  assert.equal(clean.results[1].value, '');
  assert.equal(raw.parameters[2].value, oversized);
  assert.equal(cleanReading(null), null);
  assert.equal(cleanReading({ parameters: raw.parameters, results: [] }), null);
  assert.equal(cleanReading({ parameters: [], results: raw.results }), null);
});

test('the notebook freezes each reading, skips adjacent duplicates, and caps one comparison', () => {
  const first = makeExperiment(20, 'genre-management', prediction);
  const raw = reading(3);
  const second = appendReading(first, raw);
  raw.parameters[0].value = 8;
  assert.deepEqual(first.readings, []);
  assert.deepEqual(second.latest, reading(3));
  assert.strictEqual(appendReading(second, reading(3)), second);
  assert.strictEqual(appendReading(second, { parameters: [], results: [] }), second);

  const third = appendReading(second, reading(5, 4));
  assert.deepEqual(third.readings, [reading(3), reading(5, 4)]);
  assert.deepEqual(third.latest, reading(5, 4));
  const repeated = appendReading(third, reading(3));
  assert.deepEqual(repeated.readings, [reading(3), reading(5, 4), reading(3)]);
  const full = Array.from({ length: 10 }, (_, index) => reading(index + 10)).reduce(appendReading, repeated);
  assert.equal(full.readings.length, 8);
  assert.strictEqual(appendReading({ ...third, complete: true }, reading(6)).readings, third.readings);
});

test('archiving requires a measured result and a substantive learner reflection', () => {
  const first = makeExperiment(20, 'genre-management', prediction);
  const tried = appendReading(first, reading(3));
  assert.equal(canArchiveExperiment({ ...first, reflection }), false);
  assert.equal(canArchiveExperiment({ ...tried, reflection: '...........' }), false);
  assert.equal(canArchiveExperiment({ ...tried, reflection: '好   好' }), false);
  assert.equal(canArchiveExperiment({ ...tried, reflection }), true);
});

test('notebook storage keeps complete comparisons and rejects bad or duplicate imports', () => {
  withLocalStorage((storage) => {
    const first = makeExperiment(20, 'genre-management', prediction);
    const complete = { ...appendReading(appendReading(first, reading(3)), reading(5, 4)), reflection, complete: true };
    assert.equal(saveExperiment(complete), true);
    assert.deepEqual(readExperiments(), [complete]);
    const invalidId = { ...complete, id: null };
    const invalidWeek = { ...complete, id: 'bad-week-1234', week: 100 };
    const invalidLab = { ...complete, id: 'bad-lab-1234', lab: '../../desktop' };
    const invalidPrediction = { ...complete, id: 'bad-text-1234', prediction: '  ' };
    const incomplete = { ...makeExperiment(21, 'genre-sandbox', '带气囊时回程能省下更多电量。'), reflection: '', complete: true };
    const duplicate = { ...complete, prediction: '试图用导入覆盖原来的预测。' };
    assert.equal(saveExperiment(invalidId), false);
    assert.deepEqual(importExperiments(null), { added: 0, saved: true });
    assert.deepEqual(importExperiments([duplicate, invalidId, invalidWeek, invalidLab, invalidPrediction, incomplete]), { added: 1, saved: true });
    const stored = readExperiments();
    assert.deepEqual(stored.find((record) => record.id === complete.id), complete);
    assert.equal(stored.find((record) => record.id === incomplete.id).complete, false);
    assert.ok(stored.every((record) => JSON.parse(storage.getItem('game-design-atlas:experiments:v1')).some((item) => item.id === record.id)));
  });
});

test('a newer backup restores an unfinished experiment and retains the final unpinned run', () => {
  withLocalStorage(() => {
    const initial = makeExperiment(20, 'genre-management', prediction);
    const draft = { ...appendReading(initial, reading(3)), latest: reading(5, 4) };
    assert.equal(saveExperiment(draft), true);
    const final = { ...draft, reflection, complete: true };
    assert.equal(canArchiveExperiment(final), true);
    assert.deepEqual(importExperiments([final]), { added: 1, saved: true });
    assert.deepEqual(archiveReadings(readExperiments()[0]), [reading(3), reading(5, 4)]);
    assert.equal(readExperiments()[0].complete, true);

    const onlyLatest = { ...initial, latest: reading(5, 4), reflection };
    assert.equal(canArchiveExperiment(onlyLatest), true);
    assert.deepEqual(archiveReadings(onlyLatest), [reading(5, 4)]);
  });
});

test('stale tabs cannot edit reasoning already submitted in another tab', () => {
  const base = emptyRecord();
  const established = {
    judgment: '先测试加粗轮廓的版本，再恢复时间限制。',
    evidence: '原版两位玩家都没看见目标，其余两位顺利完成。',
    verification: '只改轮廓和对照组；每位玩家只做一次首轮任务。',
    reflection: '两个版本还需要换一批新玩家按同一个标准验证。', submitted: true
  };
  const afterSubmission = {
    ...base,
    study: cleanStudy({ ...base.study, reasoning: established, practice: '记录三个玩家都停在哪一个门口。', finished: true })
  };
  const staleEdit = {
    ...base,
    study: cleanStudy({ ...base.study, practice: '梳理轮廓干扰和目标位置的两个解释。', reasoning: {
      ...established, judgment: '一个未经确认的异步补写选项。', submitted: false
    } })
  };
  const pending = new Map([[12, weekChanges(base, staleEdit)]]);
  const updated = applyChanges({ 12: afterSubmission }, pending)[12].study;
  assert.deepEqual(updated.reasoning, established);
  assert.equal(updated.finished, true);
  assert.equal(updated.practice, staleEdit.study.practice);

  const conflictingSubmission = { ...staleEdit, study: { ...staleEdit.study, reasoning: { ...staleEdit.study.reasoning, submitted: true } } };
  const conflicts = new Map([[12, weekChanges(base, conflictingSubmission)]]);
  assert.deepEqual(applyChanges({ 12: afterSubmission }, conflicts)[12].study.reasoning, established);
});
