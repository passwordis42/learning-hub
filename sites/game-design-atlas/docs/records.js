import { cleanStudy, hasReasoning, hasStudy } from './study-progress.js?v=guided-3';

export const recordsKey = 'game-design-atlas:learning:v1';
export const resumeKey = 'game-design-atlas:resume:v1';
const fields = ['draft', 'rationale', 'evidence'];
const projectFields = [...fields, 'locked', 'verification', 'previousVerification', 'complete'];
const studyFields = ['position', 'full', 'practice', 'legacyFinished', 'finished'];
const slotPattern = /^触发\s*[:：]\s*(.+?)\s*[;；]\s*条件\s*[:：]\s*(.+?)\s*[;；]\s*结果\s*[:：]\s*(.+?)\s*[;；]\s*例外\s*[:：]\s*(.+)$/u;
const unanswered = /(?:待定|未定|未填写|不知道|随便|AI\s*(?:决定|补齐|自行|补全)|尚未确认|TBD|TODO|\[空\]|[?？_]{2,}|…{2,})/iu;

export function cleanRecords(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const result = {};
  for (let i = 1; i <= 28; i++) {
    const original = source[i];
    if (!original || typeof original !== 'object') continue;
    const record = Object.fromEntries(fields.map((field) => [field, typeof original[field] === 'string' ? original[field].slice(0, 4000) : '']));
    record.locked = original.locked === true && checkpointReady(record);
    record.verification = typeof original.verification === 'string' ? original.verification.slice(0, 4000) : '';
    if (typeof original.previousVerification === 'string' && original.previousVerification) {
      record.previousVerification = original.previousVerification.slice(0, 4000);
    }
    record.complete = original.complete === true && record.locked && verificationReady(record);
    record.study = cleanStudy(original.study);
    result[i] = record;
  }
  return result;
}

export function readRecords(fallback = {}) {
  try { return cleanRecords(JSON.parse(localStorage.getItem(recordsKey))); }
  catch { return fallback; }
}

export function writeRecords(records) {
  try { localStorage.setItem(recordsKey, JSON.stringify(records)); return true; }
  catch { return false; }
}

export function emptyRecord() {
  return { draft: '', rationale: '', evidence: '', locked: false, verification: '', complete: false, study: cleanStudy() };
}

export function mergeWeek(existing, incoming) {
  if (!existing) return incoming;
  const existingProject = projectFields.some((key) => Boolean(existing[key]));
  const incomingProject = projectFields.some((key) => Boolean(incoming[key]));
  const existingStudy = hasStudy(existing.study);
  const incomingStudy = hasStudy(incoming.study);
  const addReasoning = hasReasoning(incoming.study?.reasoning) && !hasReasoning(existing.study?.reasoning);
  if ((!incomingProject || existingProject) && (!incomingStudy || existingStudy) && !addReasoning) return existing;
  let study = incomingStudy && !existingStudy ? incoming.study : existing.study;
  if (addReasoning && study === existing.study) study = { ...study, reasoning: incoming.study.reasoning, finished: incoming.study.finished };
  return { ...(existingProject ? existing : incoming), study };
}

function changedFields(before, after, keys) {
  return Object.fromEntries(keys.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]]));
}

export function weekChanges(before, after) {
  const previousStudy = cleanStudy(before.study);
  const nextStudy = cleanStudy(after.study);
  const questionIndices = Array.from({ length: Math.max(previousStudy.answers.length, nextStudy.answers.length) }, (_, index) => index);
  const answers = Object.fromEntries(questionIndices
    .filter((index) => (previousStudy.answers[index] ?? null) !== (nextStudy.answers[index] ?? null))
    .map((index) => [index, nextStudy.answers[index] ?? null]));
  const study = changedFields(previousStudy, nextStudy, studyFields);
  if (JSON.stringify(previousStudy.reasoning) !== JSON.stringify(nextStudy.reasoning)) study.reasoning = nextStudy.reasoning;
  if (!nextStudy.finished && (Object.hasOwn(study, 'practice') || Object.hasOwn(study, 'reasoning'))) study.finished = false;
  return {
    ...changedFields(before, after, projectFields),
    study: { ...study, answers }
  };
}

export function combineChanges(first, last) {
  return { ...first, ...last, study: {
    ...first?.study, ...last.study,
    answers: { ...first?.study?.answers, ...last.study.answers }
  } };
}

export function applyChanges(records, pending) {
  if (!pending.size) return records;
  const next = { ...records };
  for (const [week, patch] of pending) {
    const latest = next[week] ?? emptyRecord();
    const answers = [...latest.study.answers];
    Object.assign(answers, patch.study.answers);
    const studyPatch = { ...patch.study };
    const currentCase = latest.study.reasoning;
    if (currentCase.submitted && studyPatch.reasoning && (!studyPatch.reasoning.submitted || ['judgment', 'evidence', 'verification'].some((key) => studyPatch.reasoning[key] !== currentCase[key]))) {
      delete studyPatch.reasoning;
      delete studyPatch.finished;
    }
    next[week] = cleanRecords({
      [week]: { ...latest, ...patch, study: { ...latest.study, ...studyPatch, answers } }
    })[week];
  }
  return next;
}

export function validResumeWeek(value) {
  return Number.isInteger(value) && value >= 1 && value <= 28;
}

export function readResumeWeek() {
  try {
    const week = JSON.parse(localStorage.getItem(resumeKey));
    return validResumeWeek(week) ? week : null;
  } catch { return null; }
}

export function writeResumeWeek(week) {
  if (!validResumeWeek(week)) return;
  try { localStorage.setItem(resumeKey, String(week)); }
  catch { /* The current session can still resume. */ }
}

export function checkpointReady(record) {
  return fields.every((field) => meaningful(record[field]));
}

function meaningful(value) {
  return typeof value === 'string' && value.replace(/\s/gu, '').length >= 4 && /[\p{L}\p{N}]/u.test(value);
}

export const verificationReady = (record) => meaningful(record.verification);

export function ruledLines(draft) {
  return [...new Set(draft.split(/\r?\n/u).map((line) => line.trim().slice(0, 1501)).filter((line) => line.length <= 1500 && slotPattern.test(line)))];
}

export function completeRules(lines) {
  return lines.length > 0 && lines.length <= 12 && lines.every((line) => line.match(slotPattern)?.slice(1).every((slot, index) => {
    const value = slot.trim();
    return /[\p{L}\p{N}]/u.test(value) && !unanswered.test(value) && ((index === 1 || index === 3) || !/^(?:无|没有|不适用|N\/?A)$/iu.test(value));
  }));
}

export function downloadFile(value, filename, contentType) {
  const url = URL.createObjectURL(new Blob([value], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
