import { lazy, Suspense, useEffect, useState } from 'react';
import {
  ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, Circle,
  Clock3, GitFork, LayoutGrid, LockKeyhole, MessageCircle, Play, Target,
} from 'lucide-react';
import { dayOne, stages } from './data/course.js';
import { chapterLessons, lessonEntries, weeklyEntries, weekHref } from './data/lesson-index.js';
import DayOne from './DayOne.jsx';
import { GlossaryText } from './LessonTerm.jsx';

const KnowledgeGraph = lazy(() => import('./KnowledgeGraph.jsx'));
const Tutor = lazy(() => import('./Tutor.jsx'));
const WeeklyLesson = lazy(() => import('./WeeklyLesson.jsx'));

const repo = 'https://github.com/passwordis42/ai-learning-atlas';
const chapters = stages.flatMap((stage) => stage.chapters);
const stageByChapter = new Map(stages.flatMap((stage) => stage.chapters.map(({ id }) => [id, stage])));
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
const weekCount = weeklyEntries.length;
const emptyWeek = {};
const links = [
  { id: 'map', title: '图谱总览', icon: LayoutGrid },
  { id: 'day-1', title: '站内课程', icon: Play },
  { id: 'tutor', title: 'AI 学伴', icon: MessageCircle },
];

function getRoute() {
  const id = window.location.hash.slice(1);
  return links.some((link) => link.id === id) || lessonEntries.has(id) || stages.some((stage) => 'stage-' + stage.id === id) ? id : 'map';
}

function readProgress(key, fallback) {
  try {
    const value = localStorage.getItem(`learning-atlas:${key}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function useProgress(key, fallback) {
  const [value, setValue] = useState(() => readProgress(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(`learning-atlas:${key}`, JSON.stringify(value));
    } catch {
      // The lesson still works when browser storage is unavailable.
    }
  }, [key, value]);
  return [value, setValue];
}

function stageLabel(id) {
  return id.startsWith('s6') ? `6${id.slice(2).toUpperCase()}` : id.slice(1);
}

function Sidebar({ view, selectedStage, selectedChapter, completed, dayDone, learningHref, completedWeeks, onStageSelect, onChapterSelect }) {
  return (
    <aside className="sidebar">
      <a href="#map" className="brand" aria-label="AI 学习图谱首页">
        <span className="brand-mark"><GitFork size={23} strokeWidth={2.4} /></span>
        <span>AI 学习图谱</span>
      </a>
      <nav className="primary-nav" aria-label="主导航">
        {links.map(({ id, title, icon: Icon }) => (
          <a key={id} href={id === 'day-1' ? learningHref : '#' + id} aria-current={view === id || (id === 'day-1' && view === 'lesson') ? 'page' : undefined}>
            <Icon size={18} /><span>{title}</span>{id === 'day-1' && dayDone && <Check size={15} className="nav-done" />}
          </a>
        ))}
      </nav>
      {view === 'map' && <span className="mobile-progress">站内课 {completedWeeks} / {weekCount}{dayDone && ' · 第一天已完成'}</span>}
      {view === 'map' && <nav className="stage-nav" aria-label="学习阶段">
        <div className="section-caption">学习阶段 <span>{chapters.length} 章</span></div>
        {stages.map((stage) => {
          const expanded = view === 'map' && selectedStage === stage.id;
          return (
            <div className="stage-nav-group" key={stage.id}>
              <button className="stage-nav-trigger" aria-expanded={expanded} onClick={() => onStageSelect(stage.id, true)}>
                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span>{stageLabel(stage.id)}. {stage.shortTitle}</span>
                {stage.optional && <span className="nav-elective" aria-label="选学" />}
              </button>
              {expanded && (
                <ul className="subnav">
                  {stage.chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <button aria-current={selectedChapter === chapter.id ? 'true' : undefined} onClick={() => onChapterSelect(chapter.id, true)}>
                        {completed.has(chapter.id) ? <Check size={13} /> : <Circle size={10} />}
                        <span>{chapter.id}. {chapter.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>}
      {view === 'map' && <div className="sidebar-progress">
        <div><span>站内课程</span><strong>{completedWeeks} / {weekCount} 课</strong></div>
        <progress aria-label="已完成站内课程" max={weekCount} value={completedWeeks} />
        <small>{dayDone ? '第一天练习已完成' : '从第一天课程开始'} · 进度保存在此浏览器</small>
      </div>}
    </aside>
  );
}

function Project({ project }) {
  return (
    <div className="project-box">
      <Target size={19} />
      <div><strong>{project.title}</strong><p><GlossaryText text={project.brief} /></p><p><b>验收</b>　<GlossaryText text={project.acceptance} /></p></div>
    </div>
  );
}

function Inspector({ stage, chapter, completed, onToggle, onChapterSelect, learningAction, learningHref }) {
  if (chapter) {
    return (
      <section className="inspector panel" aria-label="章节详情">
        <span className={`label-chip ${chapter.optional || stage.optional ? 'elective' : ''}`}>第 {chapter.id} 章 · {chapter.optional || stage.optional ? '选学' : '先学'}</span>
        <h2><GlossaryText text={chapter.title} /></h2>
        <p><GlossaryText text={chapter.description} /></p>
        {(chapter.reason || stage.optional) && <div className="inspector-note"><strong>{chapter.optional || stage.optional ? '选学理由' : '学习重点'}</strong><p><GlossaryText text={chapter.reason || stage.reason} /></p></div>}
        <div className="inspector-note">
          <strong>前置章节</strong>
          {chapter.requires.length ? <div className="prerequisites">{chapter.requires.map((id) => (
            <button key={id} onClick={() => onChapterSelect(id)}>第 {id} 章 {chapterById.get(id)?.title}</button>
          ))}</div> : <p>可以直接开始。</p>}
        </div>
        {chapter.id === 2 && <a href="#day-1" className="action primary">打开第一天课程 <ArrowRight size={17} /></a>}
        {chapterLessons(chapter.id).map((lesson) => <a key={lesson.key} className="action secondary" href={'#' + lesson.key}>
          {lesson.chapter ? '拓展课' : '第 ' + lesson.week + ' 周'} · {lesson.title} <ArrowRight size={16} />
        </a>)}
        <button className="action secondary" onClick={() => onToggle(chapter.id)} aria-pressed={completed.has(chapter.id)}>
          {completed.has(chapter.id) ? '已完成 · 点击取消' : '标记本章为已完成'} <Check size={17} />
        </button>
      </section>
    );
  }

  if (stage.id === 's1') {
    return (
      <section className="inspector panel" aria-label="第一天课程简介">
        <span className="label-chip">第一天</span>
        <h2>{dayOne.title}</h2>
        <p>{dayOne.objective}</p>
        <a href={learningHref} className="action primary">{learningAction} <ArrowRight size={18} /></a>
        {learningHref !== '#day-1' && <a href="#day-1" className="action secondary">复习第一天 <ArrowRight size={17} /></a>}
        <div className="inspector-note outcomes">
          <strong>练习目标</strong>
          <ul>
            <li><Check size={16} />分清脚本的输入与输出</li>
            <li><Check size={16} />自己算出正确清洗结果</li>
            <li><Check size={16} />改一条规则并重新验证</li>
          </ul>
        </div>
        <span className="time-note"><Clock3 size={15} />约 {dayOne.minutes} 分钟</span>
      </section>
    );
  }

  return (
    <section className="inspector panel" aria-label="阶段详情">
      <span className={`label-chip ${stage.optional ? 'elective' : ''}`}>阶段 {stageLabel(stage.id)} · {stage.optional ? '方向选学' : '主线'}</span>
      <h2>{stage.title}</h2>
      <p><GlossaryText text={stage.startHere} /></p>
      <div className="inspector-note"><strong>{stage.optional ? '为什么是选学' : '为什么现在学'}</strong><p><GlossaryText text={stage.reason} /></p></div>
      <div className="inspector-note"><strong>练习项目</strong><p>{stage.project.title}</p></div>
      <a className="action primary" href={'#' + weeklyEntries.find((entry) => entry.stage.id === stage.id).key}>打开本阶段第一课 <ArrowRight size={17} /></a>
      <a className="action secondary" href={`#stage-${stage.id}`} onClick={(event) => { event.preventDefault(); document.getElementById(`stage-${stage.id}`)?.scrollIntoView({ block: 'start' }); }}>查看项目与章节 <ArrowRight size={17} /></a>
    </section>
  );
}

function RouteDetails({ onChapterSelect, completed, selectedStage, studyProgress }) {
  return (
    <section className="route-details" aria-labelledby="route-title">
      <h2 id="route-title">学习路线详情</h2>
      <p>第一天之后，按这 {weekCount} 周进入站内课。每课从例子开始，依次完成演示、练习和结果核对。带下划线的术语可以点开解释。</p>
      <p>前五阶段是通用基础。方向课在通用路线中属于选学，本路线在完成主线后依次深入全部五个方向。</p>
      <div className="stage-list">
        {stages.map((stage, stageIndex) => (
          <details key={stage.id} id={`stage-${stage.id}`} className="stage-row" open={stage.id === selectedStage ? true : undefined}>
            <summary>
              <ChevronDown size={17} />
              <span><span className="stage-num">{stageLabel(stage.id)}</span> {stage.title}</span>
              <span className={`label-chip ${stage.optional ? 'elective' : ''}`}>{stage.optional ? '方向选学' : '主线'}</span>
              <span className="duration">{stage.duration}</span>
            </summary>
            <div className="stage-expanded">
              <p className="stage-start-here"><strong>先理解这个例子</strong>　<GlossaryText text={stage.startHere} /></p>
              <p><GlossaryText text={stage.summary} /></p>
              <p><strong>{stage.optional ? '选学理由' : '学习理由'}</strong>　<GlossaryText text={stage.reason} /></p>
              <Project project={stage.project} />
              {stage.weeks?.length > 0 && <details className="weekly-plan">
                <summary><ChevronDown size={16} />按周安排 <span>{stage.weeks.length} 周</span></summary>
                <ol>{stage.weeks.map((week, index) => {
                  const number = stages.slice(0, stageIndex).reduce((total, prior) => total + prior.weeks.length, index + 1);
                  const href = weekHref(number);
                  const progress = studyProgress[href.slice(1)];
                  return (
                    <li key={week.title}>
                      <span className="week-index">第 {number} 周</span>
                      <div><strong><GlossaryText text={week.title} /></strong><p><GlossaryText text={week.body} /></p>
                        <a className="week-directory-link" href={href} aria-label={'第 ' + number + ' 周：' + week.title}>
                          {progress?.completed ? '复习这节课' : progress ? '继续这节课' : '进入站内课'} <ArrowRight size={14} />
                        </a>
                      </div>
                    </li>
                  );
                })}</ol>
              </details>}
              {stage.resources?.length > 0 && <div className="stage-resources"><strong>学习资料</strong>{stage.resources.map(({ title, url }) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">{title} <ArrowRight size={14} /></a>
              ))}</div>}
              <ul className="chapter-list">
                {stage.chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <button onClick={() => onChapterSelect(chapter.id, true)}>
                      <span className="mono">{String(chapter.id).padStart(2, '0')}</span>
                      {chapter.title}
                      {chapter.optional && <span className="label-chip elective">选学</span>}
                      {completed.has(chapter.id) && <Check size={16} />}
                      <ChevronRight size={16} className="chapter-arrow" />
                    </button>
                    {chapter.optional && <p><GlossaryText text={chapter.reason} /></p>}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [selectedStage, setStage] = useState('s1');
  const [selectedChapter, setChapter] = useState(null);
  const [completedIds, setCompletedIds] = useProgress('chapters', []);
  const [checklist, setChecklist] = useProgress('day-one-checklist', []);
  const [dayDone, setDayDone] = useProgress('day-one-complete', false);
  const [reflection, setReflection] = useProgress('day-one-reflection', null);
  const [scopeConfirmed, setScopeConfirmed] = useProgress('day-one-scope', false);
  const [position, setPosition] = useProgress('day-one-guide', null);
  const [draft, setDraft] = useProgress('day-one-judgment-draft', null);
  const [experiment, setExperiment] = useProgress('day-one-experiment', '');
  const [studyProgress, setStudyProgress] = useProgress('weekly-study', {});
  const [lastLessonKey, setLastLessonKey] = useProgress('weekly-resume', null);
  const lessonEntry = lessonEntries.get(route);
  const view = lessonEntry ? 'lesson' : route.startsWith('stage-') ? 'map' : route;
  const completed = new Set(completedIds);
  const stage = stages.find(({ id }) => id === selectedStage) ?? stages[0];
  const chapter = chapterById.get(selectedChapter);
  const learningHref = lessonEntries.has(lastLessonKey) ? '#' + lastLessonKey : dayDone ? weekHref(1) : '#day-1';
  const completedWeeks = weeklyEntries.filter(({ key }) => studyProgress[key]?.completed).length;
  const learningAction = completedWeeks === weekCount ? '复习课程' : learningHref !== '#day-1' || position || reflection ? '继续学习' : '开始学习';
  const viewTitle = lessonEntry ? lessonEntry.week ? '第 ' + lessonEntry.week + ' 周' : '拓展课' : view === 'day-1' ? '第一天课程' : links.find(({ id }) => id === view).title;
  const tutorPanel = reflection && scopeConfirmed && (
    <Suspense fallback={<div className="lesson-card panel" role="status">正在打开 AI 学伴…</div>}>
      <Tutor context={`AI 学习图谱 · 第一阶段第一天：${dayOne.title}\n${dayOne.objective}\n${dayOne.prompt}\n\n学习者已保存自己的判断。\n预计保留 ${reflection.rows} 条。\n理由：${reflection.reason}\n证据：${reflection.evidence}`} />
    </Suspense>
  );

  useEffect(() => {
    const handleHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    document.title = viewTitle + ' · AI 学习图谱';
    if (route.startsWith('stage-')) {
      setStage(route.slice(6));
      setChapter(null);
      const frame = requestAnimationFrame(() => document.getElementById(route)?.scrollIntoView({ block: 'start' }));
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
  }, [route, viewTitle]);

  useEffect(() => {
    if (lessonEntry) setLastLessonKey(lessonEntry.key);
  }, [lessonEntry, setLastLessonKey]);

  function showMap(scroll) {
    if (view !== 'map') window.location.hash = 'map';
    else if (scroll) document.getElementById('map-title')?.scrollIntoView({ block: 'start' });
  }

  function selectStage(id, scroll = false) {
    setStage(id);
    setChapter(null);
    showMap(scroll);
  }

  function selectChapter(id, scroll = false) {
    const nextStage = stageByChapter.get(id);
    if (!nextStage) return;
    setStage(nextStage.id);
    setChapter(id);
    showMap(scroll);
  }

  function toggleCompleted(id) {
    setCompletedIds((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
  }

  function updateLesson(changes) {
    const key = lessonEntry.key;
    setStudyProgress((old) => ({ ...old, [key]: { ...old[key], ...changes } }));
  }

  function continueLesson(nextKey) {
    updateLesson({ completed: true });
    if (nextKey) setLastLessonKey(nextKey);
    window.location.hash = nextKey ?? 'map';
  }

  return (
    <div className="atlas-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳到主要内容</a>
      <Sidebar view={view} selectedStage={selectedStage} selectedChapter={selectedChapter} completed={completed} dayDone={dayDone} learningHref={learningHref} completedWeeks={completedWeeks} onStageSelect={selectStage} onChapterSelect={selectChapter} />
      <main className="workspace" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="breadcrumb"><span>学习路线</span><ChevronRight size={15} /><span>{viewTitle}</span></div>
          {view === 'map' ? <a className="action top-action" href={learningHref}>{learningAction} <ArrowRight size={16} /></a> : <a className="action top-action" href={view === 'tutor' ? '#day-1' : '#map'}><LayoutGrid size={16} />{view === 'tutor' ? '返回第一天' : '返回图谱'}</a>}
        </header>
        {view === 'map' && (
          <>
            <div className="hero">
              <h1 id="map-title">AI 学习图谱</h1>
              <p>沿着 {chapters.length} 章路线，从第一个可验证的练习开始。</p>
            </div>
            <section className="atlas-start-banner panel" aria-label="推荐学习路径">
              <div className="atlas-start-copy">
                <span className="label-chip">{dayDone || completedWeeks > 0 ? `已完成 ${completedWeeks} / ${weekCount} 周` : '新手起步路线'}</span>
                <strong>怎么用这张图谱最高效？按三步循序推进：</strong>
                <ol className="atlas-start-steps">
                  <li><b>① 第一天起步</b><span>用 10 行工单表养成「先手算真值、再让 AI 写代码、最后核对验收」的基本功。</span></li>
                  <li><b>② 第 01–18 周主线</b><span>从数据清洗、特征与评估指标一路打通到大模型检索增强（RAG）与上线评测。</span></li>
                  <li><b>③ 第 19–58 周方向课</b><span>主线稳固后，按兴趣选学强化学习、多模态、因果推断等五个进阶方向。</span></li>
                </ol>
              </div>
              <div className="atlas-start-actions">
                <a href={learningHref} className="action primary">{learningAction === '开始学习' ? '从第一天课程开始' : learningAction} <ArrowRight size={17} /></a>
                {learningHref !== '#day-1' && <a href="#day-1" className="action secondary">回看第一天起步课</a>}
              </div>
            </section>
            <div className="atlas-grid">
              <section className="graph-panel panel" aria-label="交互式知识图谱">
                <Suspense fallback={<div className="graph-loading" role="status">正在打开知识图谱…</div>}>
                  <KnowledgeGraph selectedStage={stage.id} selectedChapter={selectedChapter} completed={completed} onStageSelect={selectStage} onChapterSelect={selectChapter} />
                </Suspense>
              </section>
              <Inspector stage={stage} chapter={chapter} completed={completed} onToggle={toggleCompleted} onChapterSelect={selectChapter} learningAction={learningAction} learningHref={learningHref} />
            </div>
            <RouteDetails selectedStage={selectedStage} onChapterSelect={selectChapter} completed={completed} studyProgress={studyProgress} />
          </>
        )}
        {view === 'day-1' && (
          <DayOne lesson={dayOne} checklist={checklist} setChecklist={setChecklist} done={dayDone} setDone={setDayDone}
            reflection={reflection} setReflection={setReflection} scopeConfirmed={scopeConfirmed} setScopeConfirmed={setScopeConfirmed}
            position={position} setPosition={setPosition} draft={draft} setDraft={setDraft} experiment={experiment} setExperiment={setExperiment} tutorPanel={tutorPanel} />
        )}
        {lessonEntry && <Suspense fallback={<p className="graph-loading" role="status">正在打开站内课程…</p>}>
          <WeeklyLesson key={lessonEntry.key} entry={lessonEntry} state={studyProgress[lessonEntry.key] ?? emptyWeek}
            onUpdate={updateLesson} onContinue={continueLesson} overviewHref={'#stage-' + lessonEntry.stage.id} />
        </Suspense>}
        {view === 'tutor' && (
          <div className="tutor-page">
            <div className="hero"><h1>AI 学伴</h1><p>第一天课程的辅学工具。用提示提问、解释代码和排查错误，最后由你验证结果。</p></div>
            {tutorPanel || (
              <section className="lesson-card panel tutor-gate">
                <div className="lesson-section-title"><LockKeyhole size={22} /><h2>{reflection ? '先确认委托范围与规则' : '先做一次独立判断'}</h2></div>
                <p>{reflection ? '回到第一天课程，确认要处理哪个文件、怎样去重、输出保存到哪里。' : '回到第一天课程，写下你预计会保留几行、为什么，以及你用到的是哪几条记录。保存后再核对要交给 AI 的任务。'}</p>
                <a href="#day-1" className="action primary">去第一天课程 <ArrowRight size={17} /></a>
              </section>
            )}
          </div>
        )}
        <footer className="page-footer"><BookOpen size={16} />AI 学习图谱 <a href={repo} target="_blank" rel="noreferrer">GitHub 源码 <ArrowRight size={14} /></a></footer>
      </main>
    </div>
  );
}
