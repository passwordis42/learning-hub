import { phases, weeks } from './data/curriculum.js';
import { weekLabel } from './graph.js';
import { labLabels, mountLab } from './labs.js?v=guided-3';
import { canFinish, cleanStudy, hasPractice, lessonSteps } from './study-progress.js?v=guided-3';
import { mountReasoning } from './reasoning.js';
import { mountExperiment } from './experiment-notebook.js';
import { archiveReadings, readExperiments } from './experiments.js';

export function studyLink(week, id, full = false) {
  const params = new URLSearchParams();
  if (id) params.set('step', id);
  if (full) params.set('view', 'all');
  return `#plan/${weekLabel(week)}${params.size ? `?${params}` : ''}`;
}

function paragraphs(text, escape) {
  return text.split(/\n\s*\n/u).map((paragraph) => `<p>${escape(paragraph)}</p>`).join('');
}

function stepWhy(stepId) {
  if (stepId.startsWith('idea-')) return '建立可观察的设计概念：把主观“好不好玩”拆成规则、行为与反馈，后面分析才站得住脚。';
  switch (stepId) {
    case 'example': return '先看一个具体拆解案例，观察规则差异怎样落成玩家看得见的选择与后果。';
    case 'lab': return '先写预测再调整单一变量试跑，用对照读数检验设计假设，而不是凭印象猜结果。';
    case 'practice': return '轮到你亲手推演一版方案（至少 8 个字），这是解锁本课完成的必要步骤之一。';
    case 'project': return '把前几周的方法收束成阶段试玩里程碑，确认方案能从纸面走到真实玩家面前。';
    case 'check': return '换一个没见过的陌生情境独立推理并复盘，检验今天的方法能不能迁移应用。';
    default: return '';
  }
}

function renderLabRecap(week, lab, full, escape) {
  if (!lab) return '';
  const items = readExperiments().filter((entry) => entry.week === week.id && entry.lab === lab);
  const latestEntry = items.at(-1);
  if (!latestEntry) {
    return `<div class="practice-lab-recap"><strong>实验对照提示</strong><span>你还没有在本课「交互实验」留下读数。建议先试跑一轮，读数会自动同步到这里供写答案参考。</span><a class="outline-button small-btn" href="${studyLink(week.id, 'lab', full)}">先去交互实验试跑 →</a></div>`;
  }
  const readings = archiveReadings(latestEntry);
  const summaryRows = readings.slice(-2).map((reading, idx) => {
    const paramsText = reading.parameters.map((p) => `${p.label}：${p.value}`).join('，');
    const resText = reading.results.slice(0, 3).map((r) => `${r.label}：${r.value}`).join('，');
    return `<li><b>实测 ${idx + 1}</b>（${escape(paramsText)}）→ ${escape(resText)}</li>`;
  }).join('');
  return `<details class="study-details practice-lab-recap-details" open><summary>对照你在「交互实验」留下的实测记录</summary><div><p><strong>当时预测：</strong>${escape(latestEntry.prediction)}</p>${summaryRows ? `<ul>${summaryRows}</ul>` : ''}${latestEntry.reflection ? `<p><strong>实验复盘：</strong>${escape(latestEntry.reflection)}</p>` : ''}</div></details>`;
}

function renderExample(lesson, escape) {
  const details = lesson.case.rows?.length ? `<dl class="case-grid">${lesson.case.rows.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : '';
  return `<div class="example-panel">${paragraphs(lesson.case.text, escape)}${details}</div>`;
}

function renderPractice(week, lesson, progress, full, escape) {
  const activity = lesson.activity;
  return `${renderLabRecap(week, lesson.lab, full, escape)}
    <h4>${escape(activity.title)}</h4>${paragraphs(activity.prompt, escape)}
    <details class="study-details"><summary>卡住了？看一个提示</summary><div>${paragraphs(activity.hint, escape)}</div></details>
    <label class="study-input-label" for="practice-notes">我的练习答案（完成本课必写）</label>
    <textarea id="practice-notes" rows="5" maxlength="4000" placeholder="${escape(activity.placeholder)}">${escape(progress.practice)}</textarea>
    <p class="quiet" id="practice-status" aria-live="polite">${hasPractice(progress.practice) ? '✓ 练习记录已达标并保存在此浏览器。' : '先按题目写一版自己的答案（至少 8 个字）。你的记录会自动保存。'}</p>
    <div class="practice-check"><h4>写完对照检查</h4><ul>${activity.criteria.map((item) => `<li>${escape(item)}</li>`).join('')}</ul></div>
    <details class="study-details"><summary>展开示范解法，对照我的答案</summary><div class="sample-answer">${paragraphs(activity.sample, escape)}</div></details>
    <aside class="project-application"><h4>课外延伸 · 用到本周项目</h4><p>${escape(week.exercise)}</p><p><strong>验收标准</strong> ${escape(week.acceptance)}</p><p><strong>要留下的证据</strong> ${escape(week.evidence)}</p><div class="lesson-actions"><button class="outline-button" id="copy-practice" type="button" ${progress.practice.trim() ? '' : 'disabled'}>复制我的练习答案</button><a class="text-link" href="#coach/${weekLabel(week.id)}">记录项目的设计与证据 ↗</a></div></aside>`;
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

  const phaseInfo = phases.find((p) => p.id === week.phase);
  const previous = weeks[week.id - 2];
  const next = weeks[week.id];
  const bodies = {
    ...Object.fromEntries(lesson.teach.map(({ text }, i) => [`idea-${i + 1}`, `<div class="study-copy">${paragraphs(text, escape)}</div>`])),
    example: renderExample(lesson, escape),
    lab: lesson.lab ? `<div class="study-lab" data-lab="${escape(lesson.lab)}"><h4>${escape(labLabels[lesson.lab])}</h4><div class="lab-body"></div></div>` : '',
    practice: renderPractice(week, lesson, progress, full, escape),
    project: lesson.checkpoint ? renderCheckpoint(week, lesson.checkpoint, escape) : '',
    check: `<p class="quiet quiz-intro">先独立写出判断、依据和可证伪条件；提交后再对照示范思路填写复盘，即可标记本课完成。</p>${progress.legacyFinished ? '<p class="quiet">旧版选择题完成记录已保留。本课可重新用开放案例练习。</p>' : ''}<div data-reasoning></div><div class="study-finish"><div class="study-finish-info"><p id="study-finish-status" class="quiet"></p><div data-finish-jumps class="study-finish-jumps"></div></div><div class="study-finish-actions"><button id="study-finish" class="primary-button" type="button">完成本课</button><a data-next-lesson class="primary-button study-next-cta" hidden href="${next ? studyLink(next.id) : '#graph'}">${next ? `下一课：第 ${weekLabel(next.id)} 周 · ${escape(next.title)} →` : '回到知识图谱 ↗'}</a></div></div>`
  };

  const prevStep = index > 0 ? steps[index - 1] : null;
  const nextStep = index < steps.length - 1 ? steps[index + 1] : null;

  container.innerHTML = `
    <header class="study-intro"><div class="study-stamp-row"><span class="week-stamp">第 ${weekLabel(week.id)} 周</span>${phaseInfo ? `<span class="phase-pill">阶段 ${phaseInfo.id} · ${escape(phaseInfo.title)}</span>` : ''}</div><h2 tabindex="-1">${escape(week.title)}</h2><p>${escape(lesson.goal)}</p></header>
    <div class="study-toolbar"><div><span>${full ? `全文阅读（共 ${steps.length} 步）` : `第 ${index + 1} / ${steps.length} 步`}</span><strong>${escape(active.title)}</strong></div><a class="outline-button" href="${full ? `${studyLink(week.id, active.id)}&view=steps` : studyLink(week.id, active.id, true)}">${full ? '切换分步学习' : '阅读全文'}</a></div>
    <nav class="study-step-nav" aria-label="课内步骤">${steps.map((step, i) => `<a href="${studyLink(week.id, step.id, full)}"${i === index ? ' aria-current="step"' : ''}><span aria-hidden="true">${weekLabel(i + 1)}</span>${escape(step.title)}</a>`).join('')}</nav>
    <div class="study-content">${steps.map((step, i) => i === index || full ? `<section class="course-step" id="course-${step.id}" data-step="${step.id}"><div class="course-step-head"><span class="step-badge">步骤 ${i + 1} / ${steps.length}</span><h3 tabindex="-1">${escape(step.title)}</h3><p class="step-why-note"><strong>为什么要做这一步：</strong>${escape(stepWhy(step.id))}</p></div>${bodies[step.id]}</section>` : '').join('')}</div>
    ${!full ? `<nav class="study-pager" aria-label="前后学习步骤">${prevStep ? `<a class="outline-button" href="${studyLink(week.id, prevStep.id)}">← 上一步：${escape(prevStep.title)}</a>` : '<span></span>'}<span class="quiet">步骤 ${index + 1} / ${steps.length}</span>${nextStep ? `<a class="primary-button" href="${studyLink(week.id, nextStep.id)}">下一步：${escape(nextStep.title)} →</a>` : '<span class="quiet">完成上方推理后解锁下一课</span>'}</nav>` : ''}
    <details class="study-details study-extra"><summary>延伸阅读与图谱关系</summary><div><p class="quiet">学完后可再查阅原始资料和相关课程。</p><ul class="resource-list">${week.resources.map(({ title, url }) => `<li><a href="${escape(url)}" rel="noopener noreferrer" target="_blank">${escape(title)} ↗</a></li>`).join('')}</ul>${relations}</div></details>
    <details class="study-details project-gate-details"><summary>课外实战里程碑 · 本周项目与验收（选做，不影响本课完成）${record.complete ? ' · 已验收' : ''}</summary><div><p>${escape(week.exercise)}</p><p><strong>验收标准</strong> ${escape(week.acceptance)}</p><div class="lesson-actions"><a class="outline-button" href="#coach/${weekLabel(week.id)}">打开项目记录</a><button class="outline-button" type="button" id="finish-week">${record.complete ? '✓ 项目已验收 · 取消' : '标记本周项目验收'}</button></div></div></details>
    <nav class="prev-next" aria-label="前后课程">${previous ? `<a href="${studyLink(previous.id)}">← 上一课：第 ${weekLabel(previous.id)} 周 · ${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${studyLink(next.id)}">下一课：第 ${weekLabel(next.id)} 周 · ${escape(next.title)} →</a>` : '<a href="#graph">返回图谱 ↗</a>'}</nav>`;

  function reflectCompletion() {
    const status = container.querySelector('#study-finish-status');
    if (!status) return;
    const ready = canFinish(progress);
    const finished = progress.finished && ready;
    const button = container.querySelector('#study-finish');
    const nextCta = container.querySelector('[data-next-lesson]');
    const jumps = container.querySelector('[data-finish-jumps]');
    button.disabled = !ready;
    button.className = finished ? 'outline-button' : 'primary-button';
    button.textContent = finished ? '✓ 已完成本课 · 取消' : '完成本课';
    if (nextCta) nextCta.hidden = !finished;

    const remaining = [];
    const jumpLinks = [];
    if (!hasPractice(progress.practice)) {
      remaining.push('留下你的动手练习记录');
      jumpLinks.push(full
        ? '<button class="outline-button small-btn" type="button" data-focus-target="#practice-notes">定位到「我的练习答案」↑</button>'
        : `<a class="outline-button small-btn" href="${studyLink(week.id, 'practice', full)}">去「自己做一遍」补写练习 →</a>`);
    }
    if (!progress.reasoning.submitted) {
      remaining.push('提交你的案例判断');
      jumpLinks.push('<button class="outline-button small-btn" type="button" data-focus-target="#reason-judgment">填写上方案例判断 ↑</button>');
    }
    if (progress.reasoning.submitted && !hasPractice(progress.reasoning.reflection)) {
      remaining.push('写下对照后的复盘');
      jumpLinks.push('<button class="outline-button small-btn" type="button" data-focus-target="#reason-reflection">填写上方对照复盘 ↑</button>');
    }
    status.textContent = finished
      ? '✓ 已计入课内学习进度！点击右侧按钮即可进入下一课（课外项目验收单独记录）。'
      : remaining.length
        ? '距离完成本课还差：' + remaining.join('、') + '。'
        : '练习、案例判断和复盘均已就绪，点击「完成本课」记录进度！';
    if (jumps) {
      jumps.innerHTML = finished ? '' : jumpLinks.join('');
    }
  }

  container.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-focus-target]');
    if (!btn) return;
    const target = container.querySelector(btn.dataset.focusTarget);
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }
  });

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
    const message = hasPractice(progress.practice) ? '✓ 练习记录已保存。' : '先写一句完整的判断或做法（至少 8 个字）。';
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
