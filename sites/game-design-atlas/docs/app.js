import { phases, weeks, prerequisites } from './data/curriculum.js?v=guided-2';
import { lessons } from './data/lessons.js?v=guided-3';
import { buildGraph, phaseColors, weekLabel } from './graph.js';
import { applyChanges, cleanRecords, combineChanges, downloadFile, emptyRecord, mergeWeek, readRecords, readResumeWeek, recordsKey, resumeKey, validResumeWeek, verificationReady, weekChanges, writeRecords, writeResumeWeek } from './records.js?v=guided-3';
import { mountCoach } from './coach.js?v=guided-3';
import { mountStudy } from './study.js?v=guided-3';
import { canFinish } from './study-progress.js?v=guided-3';
import { importExperiments, readExperiments } from './experiments.js';

const el = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let records = readRecords();
const pendingChanges = new Map();
let resumeWeek = readResumeWeek();
let selected = 1;
let activeView = '';
let lastStudyWeek;
let lastStudyStep;
let zoom = 100;
let announcementTimer;

const resumeLink = document.createElement('a');
resumeLink.className = 'hero-resume text-link';
el('graph-view').querySelector('.hero > div').append(resumeLink);

function renderResume() {
  const week = validResumeWeek(resumeWeek) ? weeks[resumeWeek - 1] : undefined;
  resumeLink.hidden = !week;
  if (!week) return;
  resumeLink.href = `#plan/${weekLabel(week.id)}`;
  resumeLink.textContent = `继续上次学习 · 第 ${week.id} 周 ${week.title}`;
}

function showNotice(message) {
  clearTimeout(announcementTimer);
  const announcement = el('announcement');
  announcement.textContent = message;
  announcement.hidden = false;
  announcementTimer = setTimeout(() => { announcement.hidden = true; }, 4500);
}

function courseFinished(id) {
  const study = records[id]?.study;
  return Boolean(study?.finished && canFinish(study));
}

function syncProgress() {
  const completed = new Set(weeks.filter(({ id }) => courseFinished(id)).map(({ id }) => id));
  el('progress-count').textContent = `${completed.size} / ${weeks.length}`;
  el('progress-fill').style.width = `${completed.size / weeks.length * 100}%`;
  updateGraph(selected, completed);
}

function currentRecords() {
  return applyChanges(readRecords(records), pendingChanges);
}

function queueChanges(id, before, after) {
  const changed = weekChanges(before, after);
  pendingChanges.set(id, combineChanges(pendingChanges.get(id), changed));
}

function flushPendingChanges() {
  records = currentRecords();
  if (!pendingChanges.size) return true;
  const saved = writeRecords(records);
  if (saved) pendingChanges.clear();
  return saved;
}

function saveWeek(id, before, after) {
  queueChanges(id, before, after);
  if (!flushPendingChanges()) showNotice('浏览器无法保存。可在页脚导出本次记录。');
  syncProgress();
}

function select(view, id = selected) {
  const target = `#${view}/${weekLabel(id)}`;
  if (location.hash === target) return;
  location.hash = target;
}

const updateGraph = buildGraph(el('graph-canvas'), (id) => select('graph', id));

function section(label, text, style) {
  return `<div class="${style}"><h3>${label}</h3><p>${esc(text)}</p></div>`;
}

function relationsFor(week, view) {
  const incoming = prerequisites.filter(([, to]) => to === week.id).map(([from]) => from);
  const outgoing = prerequisites.filter(([from]) => from === week.id).map(([, to]) => to);
  if (!incoming.length && !outgoing.length) return '';
  function links(ids, label) {
    if (!ids.length) return '';
    const count = view === 'graph' ? 4 : ids.length;
    return `<div class="relations" aria-label="${label}">${ids.slice(0, count).map((id) => `<a class="relation" href="#${view}/${weekLabel(id)}" title="${esc(weeks[id - 1].title)}">${label} ${weekLabel(id)}</a>`).join('')}${ids.length > count ? `<a class="relation" href="#plan/${weekLabel(week.id)}">另 ${ids.length - count} 项</a>` : ''}</div>`;
  }
  return `${links(incoming, '先修')}${links(outgoing, '后续')}`;
}

function renderPreview(week) {
  el('preview').innerHTML = `
    <span class="week-stamp">周 ${weekLabel(week.id)}</span>
    <h2>${esc(week.title)}</h2>
    ${section('学习要点', week.concept, 'preview-block')}
    ${section('动手练习', week.exercise, 'preview-block')}
    ${section('验收标准', week.acceptance, 'preview-block')}
    ${relationsFor(week, 'graph')}
    <div class="preview-bottom"></div>
    <a class="primary-button" href="#plan/${weekLabel(week.id)}">${courseFinished(week.id) ? '回看课程' : records[week.id]?.study?.position ? '继续学习' : '开始学习'} <span aria-hidden="true">↗</span></a>`;
}

function renderIndex() {
  const filter = el('search-weeks').value.trim().toLowerCase();
  const matches = weeks.filter((week) => [week.id, weekLabel(week.id), week.title, week.concept, week.exercise].some((value) => String(value).toLowerCase().includes(filter)));
  el('week-list').innerHTML = phases.map((phase) => {
    const group = matches.filter((week) => week.phase === phase.id);
    if (!group.length) return '';
    return `<div class="index-phase"><h3>${esc(phase.title)}</h3>${group.map((week) => `<a class="index-week" ${week.id === selected ? 'aria-current="page"' : ''} href="#plan/${weekLabel(week.id)}"><small>${weekLabel(week.id)}</small>${esc(week.title)}${courseFinished(week.id) ? '<span class="completed-mark" aria-label="课内已完成">✓</span>' : ''}</a>`).join('')}</div>`;
  }).join('') || '<p class="quiet index-phase">找不到匹配的课程。</p>';
}

function renderLesson(week, params) {
  const progress = records[week.id] ?? emptyRecord();
  let editorStudy = progress.study;
  return mountStudy(el('lesson'), week, lessons[week.id], progress, params, {
    saveStudy: (study) => {
      if (JSON.stringify(editorStudy) === JSON.stringify(study)) return;
      const base = { ...(records[week.id] ?? emptyRecord()), study: editorStudy };
      const wasFinished = courseFinished(week.id);
      saveWeek(week.id, base, { ...base, study });
      editorStudy = study;
      if (wasFinished !== courseFinished(week.id)) renderIndex();
    },
    finishProject: () => {
      const latest = currentRecords()[week.id] ?? emptyRecord();
      if (!latest.locked || !verificationReady(latest)) {
        select('coach', week.id);
        showNotice('先保存设计检查点，再记录你亲自完成的项目验收。');
        return;
      }
      saveWeek(week.id, latest, { ...latest, complete: !latest.complete });
      renderLesson(week, params);
      const button = el('finish-week');
      button.closest('details').open = true;
      button.focus();
      showNotice(!latest.complete ? '已记录本周项目验收。' : '已撤销本周项目验收。');
    },
    relations: relationsFor(week, 'plan'),
    escape: esc
  });
}

function renderRoute() {
  el('map-legend').innerHTML = phases.map((phase, i) => `<span style="--stage-color:${phaseColors[i]}"><i aria-hidden="true"></i>${esc(phase.title)}</span>`).join('');
  el('phase-route').innerHTML = phases.map((phase) => {
    const matching = weeks.filter((week) => week.phase === phase.id);
    const first = weekLabel(matching[0].id);
    const last = weekLabel(matching.at(-1).id);
    return `<a class="route-row" href="#plan/${first}"><span class="route-time">周 ${first}–${last}</span><strong>${esc(phase.title)}</strong><span class="route-subtitle">${esc(phase.description)}</span><span aria-hidden="true">→</span></a>`;
  }).join('');
}

function navigate() {
  const [route, query] = location.hash.slice(1).split('?');
  const [path, id] = route.split('/');
  const params = new URLSearchParams(query);
  if (path === 'main' && activeView) return;
  const view = ['graph', 'plan', 'coach'].includes(path) ? path : 'graph';
  const week = weeks.find((item) => item.id === Number(id)) ?? weeks[selected - 1];
  const changedView = view !== activeView;
  activeView = view;
  selected = week.id;

  for (const name of ['graph', 'plan', 'coach']) {
    el(`${name}-view`).hidden = name !== view;
    const link = document.querySelector(`[data-nav="${name}"]`);
    if (name === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  syncProgress();
  if (view === 'graph') renderPreview(week);
  if (view === 'plan') {
    const previousWeek = lastStudyWeek;
    const previousStep = lastStudyStep;
    renderIndex();
    lastStudyWeek = week.id;
    lastStudyStep = renderLesson(week, params);
    if (resumeWeek !== week.id) {
      resumeWeek = week.id;
      writeResumeWeek(week.id);
      renderResume();
    }
    if (changedView || previousWeek !== week.id) {
      el('lesson').querySelector('h2').focus({ preventScroll: true });
      if (!changedView) el('lesson').scrollIntoView({ block: 'start' });
    } else if (previousStep !== lastStudyStep || params.has('view')) {
      el(`course-${lastStudyStep}`).querySelector('h3').focus();
    }
  }
  if (view === 'coach') {
    let editorRecord = records[week.id] ?? emptyRecord();
    mountCoach(el('coach-content'), week, editorRecord, {
      save: (record) => {
        saveWeek(week.id, editorRecord, record);
        editorRecord = record;
      },
      notice: showNotice,
      selectWeek: (newWeek) => select('coach', newWeek),
      esc
    });
  }
  if (changedView) window.scrollTo(0, 0);
}

function setZoom(value) {
  zoom = Math.max(75, Math.min(175, value));
  const graph = el('graph-canvas');
  graph.style.width = `${zoom}%`;
  graph.style.minWidth = `${805 * zoom / 100}px`;
  el('zoom-reset').textContent = `${zoom}%`;
  el('zoom-out').disabled = zoom === 75;
  el('zoom-in').disabled = zoom === 175;
}

renderRoute();
renderResume();
el('zoom-in').addEventListener('click', () => setZoom(zoom + 25));
el('zoom-out').addEventListener('click', () => setZoom(zoom - 25));
el('zoom-reset').addEventListener('click', () => { setZoom(100); el('graph-scroll').scrollTo(0, 0); });
el('search-weeks').addEventListener('input', renderIndex);
el('export-progress').addEventListener('click', () => downloadFile(JSON.stringify({ version: 1, records: currentRecords(), resumeWeek, experiments: readExperiments() }, null, 2), 'game-design-progress.json', 'application/json'));
el('import-progress').addEventListener('click', () => el('progress-file').click());
el('progress-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 16000000) throw new Error();
    const parsed = JSON.parse(await file.text());
    if (parsed?.version !== 1 || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) throw new Error();
    const incoming = cleanRecords(parsed.records);
    records = currentRecords();
    let added = 0;
    for (const [id, record] of Object.entries(incoming)) {
      const existing = records[id];
      const merged = mergeWeek(existing, record);
      if (merged === existing) continue;
      queueChanges(id, existing ?? emptyRecord(), merged);
      added++;
    }
    if (!resumeWeek && validResumeWeek(parsed.resumeWeek)) {
      resumeWeek = parsed.resumeWeek;
      writeResumeWeek(resumeWeek);
      renderResume();
    }
    const saved = flushPendingChanges();
    const experiments = importExperiments(parsed.experiments);
    navigate();
    showNotice(saved && experiments.saved ? `导入 ${added} 周课程记录、${experiments.added} 次实验。已有记录已保留。` : '已读入本次会话。浏览器无法保存，请导出备份。');
  } catch { showNotice('无法读取此文件。请使用本网站导出的进度文件。'); }
});
window.addEventListener('storage', (event) => {
  if (event.key === recordsKey || event.key === null) {
    records = currentRecords();
    syncProgress();
    if (activeView === 'plan' && !el('week-list').contains(document.activeElement)) renderIndex();
    if (activeView === 'graph' && !el('preview').contains(document.activeElement)) renderPreview(weeks[selected - 1]);
  }
  if (event.key === resumeKey || event.key === null) {
    resumeWeek = readResumeWeek();
    renderResume();
  }
});
window.addEventListener('hashchange', navigate);
navigate();
