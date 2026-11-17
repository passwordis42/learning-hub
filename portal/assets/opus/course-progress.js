/* 只读各课自己的完成记录，不另建入口进度，也不迁移旧域名或旧版本。 */
(function (root) {
  'use strict';
  var AI_STUDY = 'learning-atlas:weekly-study';
  var AI_DAY = 'learning-atlas:day-one-complete';
  var NMR = 'nmr-from-zero.progress.v2';
  var GAME = 'game-design-atlas:learning:v1';

  function read(storage, key) {
    if (!storage) return null;
    try {
      var raw = storage.getItem(key);
      if (raw == null || raw === '') return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function enough(text) {
    return typeof text === 'string' && text.replace(/\s/gu, '').length >= 8 && /[\p{L}\p{N}]/u.test(text);
  }

  /* 与游戏课 canFinish / cleanReasoning 相同：草案、未提交推理、只验收项目都不算完成本课。 */
  function gameStudyFinished(study) {
    if (!study || study.finished !== true) return false;
    var answer = study.reasoning && typeof study.reasoning === 'object' ? study.reasoning : {};
    var submitted = answer.submitted === true && enough(answer.judgment) && enough(answer.evidence) && enough(answer.verification);
    return enough(study.practice) && submitted && enough(answer.reflection);
  }

  function aiIds(storage) {
    var ids = [];
    var study = read(storage, AI_STUDY);
    if (study && typeof study === 'object' && !Array.isArray(study)) {
      Object.keys(study).forEach(function (key) {
        var row = study[key];
        if (row && row.completed === true && /^(week-\d+|elective-\d+)$/.test(key)) ids.push(key);
      });
    }
    if (read(storage, AI_DAY) === true) ids.push('ai-day1');
    return ids;
  }

  function nmrIds(storage) {
    var data = read(storage, NMR);
    if (!data || typeof data !== 'object' || !Array.isArray(data.completed)) return [];
    var ids = [];
    data.completed.forEach(function (id) {
      if (typeof id === 'string' && /^\d+-\d+$/.test(id)) ids.push('nmr-' + id);
    });
    return ids;
  }

  function gameIds(storage) {
    var raw = read(storage, GAME);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    var ids = [];
    for (var n = 1; n <= 28; n += 1) {
      var row = raw[n] || raw[String(n)];
      if (row && gameStudyFinished(row.study)) ids.push('game-w' + (n < 10 ? '0' : '') + n);
    }
    return ids;
  }

  function idsFor(courseId, storage) {
    var source = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (courseId === 'ai') return aiIds(source);
    if (courseId === 'nmr') return nmrIds(source);
    if (courseId === 'game') return gameIds(source);
    return [];
  }

  function present(courseId, knownIds, storage) {
    var allow = {};
    (knownIds || []).forEach(function (id) { allow[id] = true; });
    var found = {};
    idsFor(courseId, storage).forEach(function (id) { if (allow[id]) found[id] = true; });
    return found;
  }

  root.HUB_PROGRESS = { idsFor: idsFor, present: present, gameStudyFinished: gameStudyFinished };
})(typeof window !== 'undefined' ? window : globalThis);
