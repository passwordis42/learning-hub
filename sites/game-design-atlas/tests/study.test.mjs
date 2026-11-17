import assert from 'node:assert/strict';
import test from 'node:test';
import { weeks } from '../docs/data/curriculum.js';
import { lessons } from '../docs/data/lessons.js';
import { calculateBudget, funnelNumbers, jumpSucceeds, labLabels } from '../docs/labs.js';
import { initialPrototypeState, runPrototypeEvent } from '../docs/prototype-lab.js';
import { analyzePracticeLog } from '../docs/research-lab.js';
import { cleanRecords, emptyRecord, mergeWeek } from '../docs/records.js';
import { canFinish, cleanStudy, hasStudy, lessonSteps } from '../docs/study-progress.js';

function assertText(value, label) {
  assert.equal(typeof value, 'string', label);
  assert.ok(value.trim(), label);
}

test('all 28 weeks include teaching, a worked example, practice, and a different open reasoning case', () => {
  assert.equal(weeks.length, 28);
  assert.deepEqual(Object.keys(lessons).map(Number), weeks.map(({ id }) => id));
  const caseTitles = new Set();
  for (const { id } of weeks) {
    const { goal, teach, case: example, activity, reasoning } = lessons[id];
    assertText(goal, `week ${id} goal`);
    assert.ok(teach.length >= 3, `week ${id} teaching sequence`);
    for (const item of teach) {
      assertText(item.title, `week ${id} explanation title`);
      assertText(item.text, `week ${id} explanation`);
    }
    assertText(example.title, `week ${id} case title`);
    assertText(example.text, `week ${id} case`);
    for (const row of example.rows ?? []) {
      assert.equal(row.length, 2, `week ${id} case row`);
      row.forEach((cell) => assertText(cell, `week ${id} case field`));
    }
    for (const field of ['title', 'prompt', 'hint', 'placeholder', 'sample']) {
      assertText(activity[field], `week ${id} practice ${field}`);
    }
    assert.ok(activity.criteria.length >= 2, `week ${id} practice criteria`);
    activity.criteria.forEach((criterion) => assertText(criterion, `week ${id} criterion`));
    assert.equal(Object.hasOwn(lessons[id], 'quiz'), false, `week ${id} retired quiz`);
    assert.deepEqual(Object.keys(reasoning).sort(), ['checks', 'followups', 'prompts', 'sample', 'scenario', 'title']);
    for (const field of ['title', 'scenario', 'sample']) assertText(reasoning[field], `week ${id} reasoning ${field}`);
    assert.notEqual(reasoning.title, example.title, `week ${id} unfamiliar title`);
    assert.notEqual(reasoning.scenario, example.text, `week ${id} unfamiliar scenario`);
    caseTitles.add(reasoning.title);
    for (const [field, length] of [['prompts', 2], ['checks', 3], ['followups', 2]]) {
      assert.equal(reasoning[field].length, length, `week ${id} reasoning ${field}`);
      assert.equal(new Set(reasoning[field]).size, length, `week ${id} distinct ${field}`);
      reasoning[field].forEach((item) => assertText(item, `week ${id} reasoning ${field} item`));
    }
  }
  assert.equal(caseTitles.size, 28);
});

test('lessons order explanation, example, optional known lab, practice, and check', () => {
  const usedLabs = new Set();
  for (const lesson of Object.values(lessons)) {
    const expected = [...lesson.teach.map((_, index) => `idea-${index + 1}`), 'example'];
    if (lesson.lab) {
      assert.ok(Object.hasOwn(labLabels, lesson.lab), `unknown lab: ${lesson.lab}`);
      usedLabs.add(lesson.lab);
      expected.push('lab');
    }
    expected.push('practice');
    if (lesson.checkpoint) expected.push('project');
    assert.deepEqual(lessonSteps(lesson).map(({ id }) => id), [...expected, 'check']);
  }
  assert.deepEqual([...usedLabs].sort(), Object.keys(labLabels).sort());
});

test('the eight genre weeks use distinct and registered design experiments', () => {
  const ids = [
    'genre-platform', 'genre-shooter', 'genre-puzzle', 'genre-rpg',
    'genre-management', 'genre-sandbox', 'genre-rogue', 'genre-coop',
  ];
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => lessons[index + 16].lab), ids);
  assert.deepEqual(Object.keys(labLabels).filter((id) => id.startsWith('genre-')).sort(), [...ids].sort());
  for (const id of ids) assertText(labLabels[id], id);
});

test('supply arrives before demand and a zero ending stock can still mean full service', () => {
  const budget = calculateBudget({ opening: 5, supply: 2, demand: 3, turns: 6 });
  assert.deepEqual(budget.map(({ stock }) => stock), [4, 3, 2, 1, 0, 0]);
  assert.deepEqual(budget.map(({ shortage }) => shortage), [0, 0, 0, 0, 0, 1]);
  assert.deepEqual(budget.at(-1), { round: 6, stock: 0, shortage: 1 });
  assert.deepEqual(calculateBudget({ opening: 0, supply: 3, demand: 1, turns: 2 }), [
    { round: 1, stock: 2, shortage: 0 },
    { round: 2, stock: 4, shortage: 0 },
  ]);
});

test('stage projects require tangible evidence and transfer to a different context', () => {
  assert.deepEqual(Object.keys(lessons).filter((id) => lessons[id].checkpoint), ['4', '8', '15', '28']);
  for (const { checkpoint } of Object.values(lessons).filter((lesson) => lesson.checkpoint)) {
    assertText(checkpoint.artifact, 'artifact');
    assert.equal(checkpoint.checks.length, 3);
    assertText(checkpoint.transfer, 'transfer');
  }
});

test('prototype rule distinguishes approach from interaction, boundary, failure, and reset', () => {
  let state = initialPrototypeState();
  const rules = { pickupTrigger: 'interact', distanceComparison: 'inclusive', pickupDistance: 40, pickupPhase: 'playing', pickupAction: 'collect', doorCondition: 'requires-box', doorAction: 'open', resetBox: true, resetCount: true, resetDoor: true };
  const act = (type, distance) => { state = runPrototypeEvent(state, rules, { type, distance }).state; };
  act('approach', 41);
  act('interact');
  assert.equal(state.count, 0);
  act('approach', 40);
  assert.equal(state.count, 0);
  act('interact');
  assert.equal(state.count, 1);
  act('interact');
  assert.equal(state.count, 1);
  act('door');
  act('exit');
  assert.equal(state.phase, 'complete');
  act('restart');
  assert.deepEqual(state, initialPrototypeState());
  act('approach', 39);
  act('fail');
  act('interact');
  assert.equal(state.count, 0);
});

test('raw event exercise separates duplicates, repeat runs, assistance, and unknown endings', () => {
  const all = analyzePracticeLog({ version: 'A', unit: 'session', deduplicate: true });
  const first = analyzePracticeLog({ version: 'A', unit: 'first', deduplicate: true });
  assert.deepEqual(all, { starts: 5, independent: 2, assisted: 1, exited: 1, unknown: 1, pickups: 4 });
  assert.deepEqual(first, { starts: 4, independent: 1, assisted: 1, exited: 1, unknown: 1, pickups: 3 });
  assert.equal(analyzePracticeLog({ version: 'A', unit: 'first', deduplicate: false }).pickups, 4);
  assert.equal(analyzePracticeLog({ version: 'B', unit: 'first', deduplicate: true }).starts, 1);
});

test('a jump at the grace boundary succeeds while a later input fails', () => {
  assert.equal(jumpSucceeds(65, 50), false);
  assert.equal(jumpSucceeds(65, 65), true);
  assert.equal(jumpSucceeds(66, 65), false);
  assert.equal(jumpSucceeds(0, 0), true);
  assert.equal(jumpSucceeds(-20, 0), true);
});

test('funnel totals preserve each cohort and use people entering the selected stage as the denominator', () => {
  const originalNew = funnelNumbers('a', 'new');
  const revisedNew = funnelNumbers('b', 'new');
  const originalExperienced = funnelNumbers('a', 'experienced');
  const revisedExperienced = funnelNumbers('b', 'experienced');
  const ratios = (values) => values.slice(1).map((count, index) => `${count}/${values[index]}`);
  assert.deepEqual(ratios(originalNew), ['3/5', '2/3', '1/2']);
  assert.deepEqual(ratios(revisedNew), ['5/5', '4/5', '3/4']);
  assert.equal(originalExperienced.at(-1) / originalExperienced[0], revisedExperienced.at(-1) / revisedExperienced[0]);
  assert.deepEqual(funnelNumbers('a', 'all'), originalNew.map((count, index) => count + originalExperienced[index]));
  assert.deepEqual(funnelNumbers('b', 'all'), revisedNew.map((count, index) => count + revisedExperienced[index]));
});

test('course completion requires practice, an independently submitted reasoning case, and reflection', () => {
  const practice = '我观察玩家先回头查看线索';
  const reasoning = {
    judgment: '先保留变更后的声音预告规则',
    evidence: '玩家误认相似声音造成等待',
    verification: '同样场景只比较声音变化',
    reflection: '我还需要判断静音条件的影响',
    submitted: true,
  };
  assert.equal(canFinish({ practice, reasoning }), true);
  assert.equal(canFinish({ practice, reasoning: { ...reasoning, submitted: false } }), false);
  for (const field of ['judgment', 'evidence', 'verification', 'reflection']) {
    assert.equal(canFinish({ practice, reasoning: { ...reasoning, [field]: '还没写' } }), false, field);
  }
  assert.equal(canFinish({ practice: '还没写', reasoning }), false);
  assert.equal(cleanStudy({ finished: true, practice, reasoning }).finished, true);
});

test('legacy multiple-choice work is retained but does not unlock the new reasoning assessment', () => {
  const old = { position: 'check', finished: true, practice: '写了离开前最后一次动作', answers: [1, 2] };
  const study = cleanStudy(old);
  assert.deepEqual(study.answers, old.answers);
  assert.equal(study.practice, old.practice);
  assert.equal(study.position, 'check');
  assert.equal(study.legacyFinished, true);
  assert.equal(study.finished, false);
  assert.equal(canFinish(study), false);
  assert.equal(cleanStudy(study).legacyFinished, true);
  assert.equal(cleanStudy({ ...old, finished: false }).legacyFinished, false);
});

test('old checkpoints retain verification and do not imply course completion', () => {
  const project = {
    draft: '门锁需要在踩板后开启。',
    rationale: '希望规则因果关系清晰。',
    evidence: '玩家看向门前的状态变化。',
    verification: '已亲自走通停止与重试。',
    locked: true,
    complete: true,
  };
  const migrated = cleanRecords({ 10: project, 29: project });
  assert.deepEqual(migrated, { 10: { ...project, study: cleanStudy() } });
  assert.equal(hasStudy(migrated[10].study), false);
});

test('import can fill missing project or study records without overwriting existing work', () => {
  const existingStudy = cleanStudy({ position: 'lab', answers: [0, 2], practice: '我观察到三个不同玩家路径' });
  const importedStudy = cleanStudy({ position: 'check', answers: [1, 0], practice: '观察了冷却时长的影响' });
  const blank = emptyRecord();
  const project = { ...blank, draft: '导入的项目草案' };
  const study = { ...blank, study: existingStudy };
  const merged = { ...project, study: existingStudy };
  assert.deepEqual(mergeWeek(study, { ...project, study: importedStudy }), merged);
  assert.deepEqual(mergeWeek(project, study), merged);
  assert.deepEqual(mergeWeek(merged, { ...project, draft: '企图覆盖的项目', study: importedStudy }), merged);
  const browseOnly = { ...blank, study: cleanStudy({ position: 'idea-1' }) };
  assert.deepEqual(mergeWeek(browseOnly, { ...project, study: importedStudy }), { ...project, study: importedStudy });
  assert.deepEqual(mergeWeek(browseOnly, project), { ...project, study: browseOnly.study });
});
