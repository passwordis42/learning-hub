import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react';
import { GlossaryText, LessonTerm } from './LessonTerm.jsx';
import PracticeLabs from './PracticeLabs.jsx';
import { electiveEntries, weeklyEntries, weekHref } from './data/lesson-index.js';
import { gradePractice, practiceReady } from './data/lesson-check.js';
import './weekly-lesson.css';

const phases = [
  { title: '先弄明白', intro: '先看这件事要解决什么问题，再认清参与的人、工具和材料。' },
  { title: '看一遍演示', intro: '一次看一个动作，观察输入经过处理后变成什么。' },
  { title: '换一份材料，自己试', intro: '用刚才的方法做一遍，再提交你得到的结果。' },
  { title: '核对结果', intro: '把自己的结果和参考结果对照，找出第一次分歧发生在哪里。' },
];
const flowLabels = [['actor', '谁来做'], ['input', '对什么做'], ['action', '怎样做'], ['output', '做完看到什么']];
const optional = (entry) => entry.chapter !== undefined;
const noAnswers = [];

async function loadLesson(entry) {
  if (optional(entry)) {
    const { electiveLessons } = await import('./data/elective-lessons.js');
    return electiveLessons.find(({ chapter }) => chapter === entry.chapter);
  }
  let lessons;
  if (entry.week <= 19) ({ lessons01To19: lessons } = await import('./data/lessons-01-19.js'));
  else if (entry.week <= 38) ({ lessons20To38: lessons } = await import('./data/lessons-20-38.js'));
  else ({ lessons39To58: lessons } = await import('./data/lessons-39-58.js'));
  return lessons.find(({ week }) => week === entry.week);
}

function LessonTerms({ terms }) {
  return <div className="week-terms">{terms.map((term) => <LessonTerm key={term.word} term={term.word} definition={term} />)}</div>;
}

function Explain({ lesson, definitions }) {
  return (
    <>
      <div className="week-explanation">
        {lesson.plain.split('\n').filter(Boolean).map((part, index) => <p key={index}><GlossaryText text={part} definitions={definitions} /></p>)}
      </div>
      <dl className="week-flow">
        {flowLabels.map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd><GlossaryText text={lesson.flow[key]} definitions={definitions} /></dd></div>
        ))}
      </dl>
      <div className="week-glossary"><strong>本课术语</strong><LessonTerms terms={lesson.terms} /></div>
    </>
  );
}

function Demo({ demo, seen, update, definitions }) {
  const total = demo.steps.length;
  return (
    <>
      <p><GlossaryText text={demo.intro} definitions={definitions} /></p>
      {seen > 0 && <ol className="week-trace">
        {demo.steps.slice(0, seen).map(({ action, result }, index) => (
          <li key={index}>
            <span className="week-trace-number">{index + 1}</span>
            <div><p><GlossaryText text={action} definitions={definitions} /></p><p className="week-trace-result"><strong>看到的结果</strong> <GlossaryText text={result} definitions={definitions} /></p></div>
          </li>
        ))}
      </ol>}
      <div className="week-demo-controls">
        <span role="status">演示 {seen} / {total} 步</span>
        {seen < total ? (
          <button className="action secondary" type="button" onClick={() => update({ seen: seen + 1 })}>
            {seen === 0 ? '开始演示' : '演示下一步'} <ArrowRight size={16} />
          </button>
        ) : (
          <button className="action secondary" type="button" onClick={() => update({ seen: 0 })}>重看演示 <RotateCcw size={16} /></button>
        )}
      </div>
    </>
  );
}

function Practice({ practice, answers, work, onWork, onAnswer, onSubmit, definitions, week, ready }) {
  return (
    <>
      <p><GlossaryText text={practice.brief} definitions={definitions} /></p>
      <pre className="week-data">{practice.data}</pre>
      <details className="review-box"><summary>卡住了？看一条提示</summary><p><GlossaryText text={practice.hint} definitions={definitions} /></p></details>
      <PracticeLabs week={week} />
      <form id="weekly-practice" className="week-practice" onSubmit={onSubmit}>
        <fieldset className="week-work">
          <legend>先自己做一遍</legend>
          <p id="week-work-prompt"><GlossaryText text={practice.work.task} definitions={definitions} /></p>
          <label htmlFor="week-work">我的操作记录</label>
          <textarea id="week-work" aria-describedby="week-work-prompt" rows={4} maxLength={1800} required value={work}
            placeholder="写下你实际得到的中间结果或操作步骤。" onChange={(event) => onWork(event.target.value)} />
        </fieldset>
        {practice.questions.map((question, index) => (
          <fieldset key={index}>
            <legend><span>{index + 1}</span> {question.prompt}</legend>
            {question.options ? (
              <div className="week-choices">{question.options.map((option, choice) => (
                <label key={option} className={answers[index] === String(choice) ? 'selected' : undefined}>
                  <input type="radio" name={'question-' + index} checked={answers[index] === String(choice)} onChange={() => onAnswer(index, String(choice))} />
                  <span>{option}</span>
                </label>
              ))}</div>
            ) : (
              <div className="week-number-field">
                <input className={typeof question.answer === 'string' ? 'week-answer week-answer-text' : 'week-answer'}
                  aria-label={'第 ' + (index + 1) + ' 题答案'} aria-describedby={'week-number-hint-' + index}
                  type="text" inputMode={typeof question.answer === 'number' ? 'decimal' : undefined} autoComplete="off"
                  maxLength={typeof question.answer === 'number' ? 30 : 150} value={answers[index] ?? ''}
                  placeholder={typeof question.answer === 'number' ? '输入数字' : '按题目格式输入'} onChange={(event) => onAnswer(index, event.target.value)} />
                <span id={'week-number-hint-' + index}>{typeof question.answer === 'number' ? '只填数字，单位和格式以题目为准。' : '按题目要求填写，大小写和空格都可以。'}</span>
              </div>
            )}
          </fieldset>
        ))}
      </form>
      {!ready && <p className="fineprint">写下操作记录并答完两题后，就能核对。</p>}
    </>
  );
}

function Results({ lesson, entry, scores, update, state, definitions }) {
  const correctCount = scores.filter((result) => result.correct).length;
  const further = entry.week ? electiveEntries.filter(({ after }) => after === entry.week) : [];
  return (
    <>
      <section className="week-work-review" aria-label="对照操作过程">
        <h3>对照操作过程</h3>
        <div className="week-work-columns">
          <div><strong>你的记录</strong><p>{state.submission.work}</p></div>
          <div><strong>参考过程</strong><p><GlossaryText text={lesson.practice.work.reference} definitions={definitions} /></p></div>
        </div>
        <p className="fineprint">逐步检查用了哪条规则、得到了什么。写法可以不同，关键是步骤与结果能对上。</p>
      </section>
      <p className="guide-note" role="status">{correctCount} / {scores.length} 题与参考结果一致。你可以对照下面的过程，再决定是否重试。</p>
      <ol className="week-feedback">
        {lesson.practice.questions.map(({ prompt, explanation }, index) => {
          const result = scores[index];
          return (
            <li key={index} data-correct={result.correct}>
              <strong>{index + 1}. {prompt}</strong>
              <p>你的答案：{result.attempted}　·　参考答案：{result.expected}</p>
              <p><GlossaryText text={explanation} definitions={definitions} /></p>
            </li>
          );
        })}
      </ol>
      <div className="week-evidence">
        <h3>今天留下什么证据</h3>
        <p><GlossaryText text={lesson.practice.evidence} definitions={definitions} /></p>
        <label>学习记录 <span>可选，自动保存在此浏览器</span>
          <textarea rows={3} maxLength={1200} value={state.note ?? ''} placeholder="记下你的过程、结果，或下一次要检查的地方。" onChange={(event) => update({ note: event.target.value })} />
        </label>
      </div>
      {lesson.project && <details className="review-box">
        <summary>把本阶段方法用到项目里</summary>
        <p><strong>任务</strong>　<GlossaryText text={lesson.project.task} definitions={definitions} /></p>
        <p><strong>怎样验收</strong>　<GlossaryText text={lesson.project.acceptance} definitions={definitions} /></p>
      </details>}
      {further.length > 0 && <details className="review-box">
        <summary>感兴趣时可以选学</summary>
        <ul className="week-options">
          {further.map((option) => <li key={option.key}><a href={'#' + option.key}>{option.title} <ArrowRight size={14} /></a><p>{option.reason}</p></li>)}
        </ul>
      </details>}
    </>
  );
}

function LessonGuide({ lesson, entry, state, onUpdate, next, overviewHref, onContinue }) {
  const canReview = Boolean(state.submission || state.checked);
  const stepLimit = canReview ? 3 : state.furthest ?? 0;
  const phase = Math.min(state.phase ?? 0, stepLimit);
  const lessonHeading = useRef(null);
  const heading = useRef(null);
  const moving = useRef(false);
  const definitions = useMemo(() => Object.fromEntries(lesson.terms.map((term) => [term.word, term])), [lesson.terms]);
  const answers = state.practice?.answers ?? noAnswers;
  const work = state.practice?.work ?? '';
  const demonstrated = state.seen ?? 0;
  const demoReady = demonstrated === lesson.demo.steps.length || stepLimit > 1;
  const ready = Boolean(work.trim()) && practiceReady(lesson.practice.questions, answers);
  const scores = state.submission ? gradePractice(lesson.practice.questions, state.submission.answers) : [];

  useEffect(() => { lessonHeading.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!moving.current) return;
    moving.current = false;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [phase]);

  function move(nextPhase, patch = {}) {
    moving.current = true;
    onUpdate({ phase: nextPhase, furthest: Math.max(stepLimit, nextPhase), ...patch });
  }

  function check(event) {
    event.preventDefault();
    if (ready) move(3, { submission: { answers: [...answers], work: work.trim() } });
  }

  function writeAnswer(index, value) {
    const rewritten = [...answers];
    rewritten[index] = value;
    onUpdate({ practice: { ...state.practice, answers: rewritten } });
  }

  const previous = entry.week > 1 ? weekHref(entry.week - 1) : '#day-1';
  const nextTitle = entry.chapter ? '回到主线 · 第 ' + next.week + ' 周' : next ? '第 ' + next.week + ' 周 · ' + next.title : '回到学习路线';
  const nextHeading = phases[phase + 1]?.title ?? nextTitle;
  const stageNumber = entry.stage.id.slice(1).toUpperCase();
  const lessonLabel = entry.chapter ? '选学 · 第 ' + entry.chapter + ' 章' : '阶段 ' + stageNumber + ' · 第 ' + entry.week + ' 周';
  const longer = phases[phase];

  return (
    <div className="guided-lesson weekly-lesson">
      <header className="guide-header">
        <div className="hero-meta"><span className={'label-chip' + (entry.chapter ? ' elective' : '')}>{lessonLabel}</span>{state.completed && <span className="week-completed"><Check size={15} />本课已完成</span>}</div>
        <h1 ref={lessonHeading} tabIndex={-1}>{lesson.title}</h1>
        {entry.reason && <p>{entry.reason}</p>}
      </header>
      <div className="guide-progress">
        <div className="guide-progress-copy"><strong>第 {phase + 1} / {phases.length} 步</strong><span>读懂 · 演示 · 实践 · 核对</span></div>
        <progress aria-label="本课步骤进度" value={state.completed ? phases.length : phase} max={phases.length} />
      </div>
      <div className="guide-layout">
        <section className="guide-card panel" aria-labelledby="week-step-title">
          <div className="guide-card-head">
            <span className="guide-kicker">现在学</span>
            <h2 id="week-step-title" ref={heading} tabIndex={-1}>{longer.title}</h2>
            <p>{longer.intro}</p>
            <div className="guide-next"><ArrowRight size={15} /><strong>接下来</strong><span>{nextHeading}</span></div>
          </div>
          <div className="guide-content" key={phase}>
            {phase > 0 && <details className="review-box week-review-terms"><summary>随手查本课术语</summary><LessonTerms terms={lesson.terms} /></details>}
            {phase === 0 && <Explain lesson={lesson} definitions={definitions} />}
            {phase === 1 && <Demo demo={lesson.demo} seen={demonstrated} update={onUpdate} definitions={definitions} />}
            {phase === 2 && <Practice practice={lesson.practice} answers={answers} work={work} onWork={(value) => onUpdate({ practice: { ...state.practice, work: value } })}
              onAnswer={writeAnswer} onSubmit={check} definitions={definitions} week={entry.week} ready={ready} />}
            {phase === 3 && (state.submission
              ? <Results lesson={lesson} entry={entry} scores={scores} update={onUpdate} state={state} definitions={definitions} />
              : <><p className="guide-note">这课的练习已更新。你可以回到练习，提交这次的操作过程和答案。</p>{state.note && <div className="week-old-note"><strong>上次的学习笔记</strong><p>{state.note}</p></div>}</>)}
          </div>
          <div className="guide-actions">
            {phase > 0 && <button className="action secondary" type="button" onClick={() => move(phase - 1)}><ArrowLeft size={16} />{phase === 3 ? '回到练习' : '上一步'}</button>}
            {phase === 0 && <button className="action primary" type="button" onClick={() => move(1)}>去看演示 <ArrowRight size={17} /></button>}
            {phase === 1 && <button className="action primary" type="button" onClick={() => move(2)} disabled={!demoReady}>开始自己试 <ArrowRight size={17} /></button>}
            {phase === 2 && <button className="action primary" type="submit" form="weekly-practice" disabled={!ready}>提交并核对结果 <ArrowRight size={17} /></button>}
            {phase === 3 && <button className="action primary" type="button" onClick={() => onContinue(next?.key)}>
              {next ? (entry.chapter ? '完成选学，回到主线' : '完成本课，进入下一课') : '完成本课，返回图谱'} <ArrowRight size={17} />
            </button>}
          </div>
        </section>
        <aside className="guide-sidebar" aria-label="本课步骤与资料">
          <nav className="guide-outline panel" aria-label="本课步骤">
            <h2>本课步骤</h2>
            <ol>{phases.map(({ title }, index) => {
              const status = index === phase ? 'current' : index < stepLimit || state.completed ? 'done' : 'upcoming';
              return <li key={title} className="guide-outline-item" data-state={status}><button type="button" disabled={index === phase || index > stepLimit} aria-current={index === phase ? 'step' : undefined} onClick={() => move(index)}><span className="guide-step-dot" aria-hidden="true">{status === 'done' ? <Check size={14} /> : index + 1}</span><span>{title}</span></button></li>;
            })}</ol>
          </nav>
          <div className="guide-outline panel">
            <details className="guide-resources">
              <summary>阶段延伸阅读</summary>
              {entry.stage.resources.map(({ title, url }) => <a key={url} href={url} target="_blank" rel="noreferrer">{title} <ArrowRight size={14} /></a>)}
            </details>
            <p className="fineprint">步骤、作答和笔记自动保存在此浏览器。</p>
          </div>
          <div className="week-course-links">
            {entry.week && <a href={previous}><ArrowLeft size={14} />上一课</a>}
            <a href={overviewHref}>本阶段目录 <ArrowRight size={14} /></a>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function WeeklyLesson({ entry, state, onUpdate, onContinue, overviewHref }) {
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const next = entry.chapter ? weeklyEntries[entry.after] : weeklyEntries[entry.week];

  useEffect(() => {
    let active = true;
    loadLesson(entry).then((lesson) => {
      if (active) {
        if (lesson) setLoaded(lesson);
        else setFailed(true);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [entry, retry]);

  if (failed) return <section className="panel lesson-card" role="alert"><h2>这节课暂时没能打开</h2><p>可以重试加载，或返回本阶段目录。</p><div className="guide-inline"><button type="button" className="action primary" onClick={() => { setFailed(false); setRetry((count) => count + 1); }}>重试</button><a className="action secondary" href={overviewHref}>返回目录</a></div></section>;
  if (!loaded) return <p className="graph-loading" role="status">正在打开「{entry.title}」…</p>;
  return <LessonGuide lesson={loaded} entry={entry} state={state} onUpdate={onUpdate} onContinue={onContinue} overviewHref={overviewHref} next={next} />;
}
