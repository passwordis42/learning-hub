export function cleanStudy(value) {
  const previous = value && typeof value === 'object' ? value : {};
  const answers = Array.isArray(previous.answers) ? previous.answers.slice(0, 8) : [];
  const reasoning = cleanReasoning(previous.reasoning);
  const study = {
    position: typeof previous.position === 'string' && /^[a-z0-9-]{1,22}$/u.test(previous.position) ? previous.position : '',
    full: previous.full === true,
    answers: Array.from(answers, (answer) => Number.isInteger(answer) && answer >= 0 && answer < 8 ? answer : null),
    practice: typeof previous.practice === 'string' ? previous.practice.slice(0, 4000) : '',
    reasoning,
    legacyFinished: previous.legacyFinished === true || (!reasoning.submitted && previous.finished === true && answers.some(Number.isInteger))
  };
  return { ...study, finished: previous.finished === true && canFinish(study) };
}

export function cleanReasoning(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (key) => typeof source[key] === 'string' ? source[key].slice(0, 2000) : '';
  const answer = { judgment: text('judgment'), evidence: text('evidence'), verification: text('verification'), reflection: text('reflection') };
  return { ...answer, submitted: source.submitted === true && [answer.judgment, answer.evidence, answer.verification].every(hasPractice) };
}

export function hasReasoning(value) {
  return Boolean(value?.judgment || value?.evidence || value?.verification || value?.reflection || value?.submitted);
}

export function hasPractice(text) {
  return typeof text === 'string' && text.replace(/\s/gu, '').length >= 8 && /[\p{L}\p{N}]/u.test(text);
}

export function hasStudy(study) {
  return Boolean(study && (study.practice || study.answers?.some(Number.isInteger) || hasReasoning(study.reasoning) || study.legacyFinished || study.finished));
}

export function canFinish(study) {
  const answer = cleanReasoning(study?.reasoning);
  return hasPractice(study?.practice) && answer.submitted && hasPractice(answer.reflection);
}

export function lessonSteps(lesson) {
  const steps = lesson.teach.map(({ title }, index) => ({ id: `idea-${index + 1}`, title }));
  steps.push({ id: 'example', title: lesson.case.title });
  if (lesson.lab) steps.push({ id: 'lab', title: '交互实验' });
  steps.push({ id: 'practice', title: '自己做一遍' });
  if (lesson.checkpoint) steps.push({ id: 'project', title: '阶段项目自检' });
  steps.push({ id: 'check', title: '陌生案例推理' });
  return steps;
}
