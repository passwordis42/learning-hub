import { weeks } from './data/curriculum.js';
import { weekLabel } from './graph.js';
import { labLabels, mountLab } from './labs.js?v=guided-3';
import { canFinish, cleanStudy, hasPractice, lessonSteps } from './study-progress.js?v=guided-3';
import { mountReasoning } from './reasoning.js';
import { mountExperiment } from './experiment-notebook.js';

export function studyLink(week, id, full = false) {
  const params = new URLSearchParams();
  if (id) params.set('step', id);
  if (full) params.set('view', 'all');
  return `#plan/${weekLabel(week)}${params.size ? `?${params}` : ''}`;
}

function paragraphs(text, escape) {
  return text.split(/\n\s*\n/u).map((paragraph) => `<p>${escape(paragraph)}</p>`).join('');
}

function renderExample(lesson, escape) {
  const details = lesson.case.rows?.length ? `<dl class="case-grid">${lesson.case.rows.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : '';
  return `<div class="example-panel">${paragraphs(lesson.case.text, escape)}${details}</div>`;
}

function renderPractice(week, activity, progress, escape) {
  return `<h4>${escape(activity.title)}</h4>${paragraphs(activity.prompt, escape)}
    <details class="study-details"><summary>卡住了？看一个提示</summary><div>${paragraphs(activity.hint, escape)}</div></details>
    <label class="study-input-label" for="practice-notes">我的练习答案</label>
    <textarea id="practice-notes" rows="5" maxlength="4000" placeholder="${escape(activity.placeholder)}">${escape(progress.practice)}</textarea>
    <p class="quiet" id="practice-status" aria-live="polite">${hasPractice(progress.practice) ? '练习记录保存在此浏览器。' : '先按题目写一版自己的答案。你的记录会自动保存。'}</p>
    <div class="practice-check"><h4>写完对照检查</h4><ul>${activity.criteria.map((item) => `<li>${escape(item)}</li>`).join('')}</ul></div>
    <details class="study-details"><summary>展开示范解法，对照我的答案</summary><div class="sample-answer">${paragraphs(activity.sample, escape)}</div></details>
    <aside class="project-application"><h4>用到本周项目</h4><p>${escape(week.exercise)}</p><p><strong>验收标准</strong> ${escape(week.acceptance)}</p><p><strong>要留下的证据</strong> ${escape(week.evidence)}</p><div class="lesson-actions"><button class="outline-button" id="copy-practice" type="button" ${progress.practice.trim() ? '' : 'disabled'}>复制我的练习答案</button><a class="text-link" href="#coach/${weekLabel(week.id)}">记录项目的设计与证据 ↗</a></div></aside>`;
}

function renderCheckpoint(week, checkpoint, escape) {
  return `<div class="practice-check"><h4>${escape(checkpoint.title)}</h4>
    <p>${escape(checkpoint.artifact)}</p><ol>${checkpoint.checks.map((check) => `<li>${escape(check)}</li>`).join('')}</ol>
    <h4>换一个情境再做</h4><p>${escape(checkpoint.transfer)}</p></div>
    <div class="lesson-actions"><a class="outline-button" href="#coach/${weekLabel(week.id)}">记录项目证据与复测结果</a></div>`;
}

export function mountStudy(container, week, lesson, record, params, { saveStudy, finishProject, relations, escape }) {
  const steps = lessonSteps(lesson);
  let progress = cleanStudy(record.study);
  const requested = params.get('step') || progress.position;
  const index = Math.max(0, steps.findIndex(({ id }) => id === requested));
  const active = steps[index];
  const full = params.has('view') ? params.get('view') === 'all' : progress.full;
  progress = { ...progress, position: active.id, full };
  saveStudy(progress);

  const previous = weeks[week.id - 2];
  const next = weeks[week.id];
  const bodies = {
    ...Object.fromEntries(lesson.teach.map(({ text }, i) => [`idea-${i + 1}`, `<div class="study-copy">${paragraphs(text, escape)}</div>`])),
    example: renderExample(lesson, escape),
    lab: lesson.lab ? `<div class="study-lab" data-lab="${escape(lesson.lab)}"><h4>${escape(labLabels[lesson.lab])}</h4><div class="lab-body"></div></div>` : '',
    practice: renderPractice(week, lesson.activity, progress, escape),
    project: lesson.checkpoint ? renderCheckpoint(week, lesson.checkpoint, escape) : '',
    check: `<p class="quiet quiz-intro">先独立推理。提交后再核对依据、比较示范思路，或者请 AI 追问。</p>${progress.legacyFinished ? '<p class="quiet">旧版选择题完成记录已保留。本课可重新用开放案例练习。</p>' : ''}<div data-reasoning></div><div class="study-finish"><p id="study-finish-status" class="quiet"></p><button id="study-finish" class="primary-button" type="button">完成本课</button></div>`
  };

  container.innerHTML = `
    <header class="study-intro"><span class="week-stamp">第 ${weekLabel(week.id)} 周</span><h2 tabindex="-1">${escape(week.title)}</h2><p>${escape(lesson.goal)}</p></header>
    <div class="study-toolbar"><div><span>${full ? '全文阅读' : `第 ${index + 1} / ${steps.length} 步`}</span><strong>${escape(active.title)}</strong></div><a class="outline-button" href="${full ? `${studyLink(week.id, active.id)}&view=steps` : studyLink(week.id, active.id, true)}">${full ? '切换分步学习' : '阅读全文'}</a></div>
    <nav class="study-step-nav" aria-label="课内步骤">${steps.map((step, i) => `<a href="${studyLink(week.id, step.id, full)}"${i === index ? ' aria-current="step"' : ''}><span aria-hidden="true">${weekLabel(i + 1)}</span>${escape(step.title)}</a>`).join('')}</nav>
    <div class="study-content">${steps.map((step, i) => i === index || full ? `<section class="course-step" id="course-${step.id}" data-step="${step.id}"><h3 tabindex="-1">${escape(step.title)}</h3>${bodies[step.id]}</section>` : '').join('')}</div>
    ${!full ? `<nav class="study-pager" aria-label="前后学习步骤">${index ? `<a class="outline-button" href="${studyLink(week.id, steps[index - 1].id)}">← 上一步</a>` : '<span></span>'}<span class="quiet">${index + 1} / ${steps.length}</span>${index < steps.length - 1 ? `<a class="primary-button" href="${studyLink(week.id, steps[index + 1].id)}">下一步 →</a>` : next ? `<a class="primary-button" href="${studyLink(next.id)}">下一课 →</a>` : '<a class="primary-button" href="#graph">回到图谱 ↗</a>'}</nav>` : ''}
    <details class="study-details study-extra"><summary>延伸阅读与图谱关系</summary><div><p class="quiet">学完后可再查阅原始资料和相关课程。</p><ul class="resource-list">${week.resources.map(({ title, url }) => `<li><a href="${escape(url)}" rel="noopener noreferrer" target="_blank">${escape(title)} ↗</a></li>`).join('')}</ul>${relations}</div></details>
    <details class="study-details"><summary>本周项目与验收${record.complete ? ' · 已验收' : ''}</summary><div><p>${escape(week.exercise)}</p><p><strong>验收标准</strong> ${escape(week.acceptance)}</p><div class="lesson-actions"><a class="outline-button" href="#coach/${weekLabel(week.id)}">打开项目记录</a><button class="outline-button" type="button" id="finish-week">${record.complete ? '✓ 项目已验收 · 取消' : '标记本周项目验收'}</button></div></div></details>
    <nav class="prev-next" aria-label="前后课程">${previous ? `<a href="${studyLink(previous.id)}">← ${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${studyLink(next.id)}">${escape(next.title)} →</a>` : '<a href="#graph">返回图谱 ↗</a>'}</nav>`;

  function reflectCompletion() {
    const status = container.querySelector('#study-finish-status');
    if (!status) return;
    const ready = canFinish(progress);
    const finished = progress.finished && ready;
    const button = container.querySelector('#study-finish');
    button.disabled = !ready;
    button.textContent = finished ? '✓ 已完成本课 · 取消' : '完成本课';
    const remaining = [];
    if (!hasPractice(progress.practice)) remaining.push('留下你的动手练习记录');
    if (!progress.reasoning.submitted) remaining.push('提交你的案例判断');
    if (progress.reasoning.submitted && !hasPractice(progress.reasoning.reflection)) remaining.push('写下对照后的复盘');
    status.textContent = finished ? '已计入课内学习进度。项目验收单独记录。' : remaining.length ? '完成本课前，请' + remaining.join('、') + '。' : '案例判断、复盘和练习已经记录。';
  }

  function update(nextProgress) {
    progress = { ...progress, ...nextProgress };
    if (!canFinish(progress)) progress.finished = false;
    saveStudy(progress);
    reflectCompletion();
  }

  container.querySelector('#practice-notes')?.addEventListener('input', (event) => {
    update({ practice: event.target.value });
    container.querySelector('#copy-practice').disabled = !progress.practice.trim();
    const status = container.querySelector('#practice-status');
    const message = hasPractice(progress.practice) ? '练习记录已保存。' : '先写一句完整的判断或做法。';
    if (status.textContent !== message) status.textContent = message;
  });
  container.querySelector('#copy-practice')?.addEventListener('click', async () => {
    const status = container.querySelector('#practice-status');
    try {
      await navigator.clipboard.writeText(progress.practice);
      if (status?.isConnected) status.textContent = '已复制你的练习，打开项目记录后可自行粘贴。';
    } catch {
      if (!status?.isConnected) return;
      const notes = container.querySelector('#practice-notes');
      notes.focus();
      notes.select();
      status.textContent = '已选中你的练习文字，可以手动复制。';
    }
  });

  const reasoning = container.querySelector('[data-reasoning]');
  if (reasoning) mountReasoning(reasoning, week, lesson.reasoning, progress.reasoning, (value) => update({ reasoning: value }), escape);
  reflectCompletion();
  container.querySelector('#study-finish')?.addEventListener('click', () => {
    if (canFinish(progress)) update({ finished: !progress.finished });
  });
  container.querySelector('#finish-week').addEventListener('click', finishProject);
  const stepNav = container.querySelector('.study-step-nav');
  const selectedStep = stepNav.querySelector('[aria-current="step"]');
  const navBox = stepNav.getBoundingClientRect();
  const stepBox = selectedStep.getBoundingClientRect();
  if (stepBox.right > navBox.right) stepNav.scrollLeft += stepBox.right - navBox.right + 4;
  const lab = container.querySelector('[data-lab]');
  if (lab) mountExperiment(lab.querySelector('.lab-body'), week, lab.dataset.lab, labLabels[lab.dataset.lab], (body) => mountLab(lab.dataset.lab, body), escape);
  return active.id;
}
