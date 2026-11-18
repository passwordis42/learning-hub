import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, List, MessageCircle } from 'lucide-react';
import katex from 'katex';
import type { Lesson, Progress, Stage } from '../types';
import { lessonLocation, stripTerms, type AskContext } from '../learning';
import { stages } from '../content/course';
import { sources } from '../content/resources';
import { buildSteps } from '../content/buildGuide';
import { ExplainedParagraph, TermText, useLearningHelp } from './LearningHelp';
import ActivityHost from './ActivityHost';
import './stepped-lesson.css';
const Guided=lazy(()=>import('./GuidedActivity'));
const allLessons=stages.flatMap(s=>s.lessons);

export default function SteppedLesson({lesson,stage,progress,params,onAnswer,onComplete,onPosition,onMode}:{lesson:Lesson;stage:Stage;progress:Progress;params:URLSearchParams;onAnswer:(n:number)=>void;onComplete:()=>void;onPosition:(id:string,step:string)=>void;onMode:(mode:'steps'|'all')=>void}) {
  const help=useLearningHelp();
  const mainRef=useRef<HTMLElement>(null);
  const steps=[...lesson.steps.map(s=>({id:s.id,title:s.title})),{id:'activity',title:'动手验证'},{id:'formula',title:stage.id===1?'整理关系':'公式与仪器'},{id:'check',title:'理解检查'}];
  const selected=params.get('step')??progress.positions[lesson.id];
  const active=steps.find(s=>s.id===selected)??steps[0];
  const activeIndex=steps.indexOf(active);
  const full=params.has('view')?params.get('view')==='all':progress.readingMode==='all';
  const showActivity=full||active.id==='activity';
  const [activityVisited,setActivityVisited]=useState(showActivity);
  const previousStep=useRef(active.id);
  useEffect(()=>{if(showActivity)setActivityVisited(true);},[showActivity]);
  useEffect(()=>{if(previousStep.current===active.id)return;previousStep.current=active.id;mainRef.current?.querySelector<HTMLElement>(`[data-step-id="${active.id}"] h2`)?.focus();},[active.id]);
  const done=progress.completed.includes(lesson.id);
  const old=progress.legacy.completed.includes(lesson.id)||progress.legacy.answers[lesson.id]!==undefined;
  const index=allLessons.findIndex(l=>l.id===lesson.id),previous=allLessons[index-1],next=allLessons[index+1];
  const context=(step:string,title:string,quote=''):AskContext=>({title:`${lesson.id} ${lesson.title} · ${title}`,location:lessonLocation(lesson.id,step,full?'all':'steps'),quote,sources:lesson.sources});
  const go=(id:string)=>{location.hash=lessonLocation(lesson.id,id,full?'all':'steps').slice(1);};
  const changeMode=()=>{const nextMode=full?'steps':'all';onMode(nextMode);location.hash=lessonLocation(lesson.id,active.id,nextMode).slice(1);};
  useEffect(()=>{onPosition(lesson.id,active.id);},[lesson.id,active.id]);
  useEffect(()=>{if(full&&params.get('step')){const target=mainRef.current?.querySelector<HTMLElement>(`[data-step-id="${active.id}"]`);target?.scrollIntoView({block:'start'});}},[lesson.id,params.get('step'),full]);
  const visible=(id:string)=>full||active.id===id;
  const lessonPosInStage=stage.lessons.findIndex(l=>l.id===lesson.id)+1;
  const isStageEnd=lessonPosInStage===stage.lessons.length;
  const nextStage=stages.find(s=>s.id===stage.id+1);
  return <article className="stepped-lesson" ref={mainRef}>
    <div className="page-heading lesson-heading"><span className="lesson-eyebrow">第 {stage.id} 阶段 · {stage.title}（第 {lessonPosInStage}/{stage.lessons.length} 课 · {lesson.id}）</span><h1>{lesson.title}</h1><p>{lesson.question}</p><div className="stage-context-strip"><strong>本阶段主线：</strong><span>{stage.outcome}</span></div></div>
    <nav className="lesson-tabs" aria-label="本阶段课程">{stage.lessons.map((l,i)=><a key={l.id} href={lessonLocation(l.id)} className={l.id===lesson.id?'active':''}><span>0{i+1}</span>{l.title}{progress.completed.includes(l.id)&&<Check size={14}/>}</a>)}</nav>
    {old&&!done&&<div className="revision-note"><BookOpen size={16}/><p>这节课的内容和题目已更新。旧版学习记录已保留；可以按新的步骤复习，再重新标记完成。</p></div>}
    <div className="reading-toolbar"><div><span>{full?'阅读全文模式':`第 ${activeIndex+1} / ${steps.length} 步`}</span><strong>{full?'从上到下连贯阅读全部步骤':active.title}</strong></div><button className="text-button" onClick={changeMode}>{full?<List size={15}/>:<BookOpen size={15}/>}切换为{full?'分步讲解':'阅读全文'}</button></div>
    <nav className="reading-step-nav" aria-label="本课学习步骤">{steps.map((step,i)=><a key={step.id} href={lessonLocation(lesson.id,step.id,full?'all':'steps')} className={step.id===active.id?'active':''} aria-current={step.id===active.id?'step':undefined}><span>{String(i+1).padStart(2,'0')}</span>{step.title}</a>)}</nav>
    <p className="term-hint">带虚线的词可以点开看通俗解释与例子；每段话右侧也能带着当前上下文去问 AI。按顺序读完、动手试过即可继续。</p>
    {lesson.steps.map((step,i)=><section key={step.id} className="learning-step" data-step-id={step.id} hidden={!visible(step.id)}>
      <div className="step-section-heading"><span>{String(i+1).padStart(2,'0')}</span><h2 tabIndex={-1}>{step.title}</h2></div>
      {i===0&&<div className="step-why-banner"><span>为什么先看这一步</span><p>先把物理对象和测量位置认准，再往下看变化规律，避免后面把数学符号和真实硬件混在一起。</p></div>}
      <div className={`step-explanation ${step.visual?'with-visual':''}`}><div>{step.body.map((body,j)=><ExplainedParagraph key={j} text={body} context={context(step.id,step.title,body)}/>)}</div>
      {step.visual&&visible(step.id)&&<div className="step-visual"><Suspense fallback={<p>正在准备图解…</p>}><Guided id={step.visual.id} focus={step.visual.focus}/></Suspense></div>}</div>
      {step.diagram&&<figure className="step-diagram"><ol>{step.diagram.labels.map((label,j)=><li className={j===step.diagram!.active?'active':''} key={`${j}-${label}`}><span>{j+1}</span><TermText text={label} context={context(step.id,step.title)}/></li>)}</ol><figcaption><TermText text={step.diagram.caption} context={context(step.id,step.title)}/></figcaption></figure>}
    </section>)}
    <section className="learning-step" data-step-id="activity" hidden={!visible('activity')}><div className="step-section-heading"><span>{String(lesson.steps.length+1).padStart(2,'0')}</span><h2 tabIndex={-1}>用一次操作，检查刚才的理解。</h2></div>{(activityVisited||showActivity)&&<ActivityHost active={showActivity} key={lesson.id} activity={lesson.activity} context={context('activity','动手验证')}/>}</section>
    <section className="learning-step" data-step-id="formula" hidden={!visible('formula')}><div className="step-section-heading"><span>{String(lesson.steps.length+2).padStart(2,'0')}</span><h2 tabIndex={-1}>{stage.id===1?'把刚才的关系，放在一起。':'把直觉，接回公式与仪器。'}</h2></div>
      <div className="step-why-banner"><span>为什么要有这一步</span><p>{stage.id===1?'把刚才看到的现象收拢成清晰的对应关系，并核对它在真实核磁仪器里落在哪个部件上。':'公式只是把刚才试出来的直觉写成定量关系；先结合具体数值例子读懂符号，再看它在真实仪器里对应哪个部件。'}</p></div>
      <div className="step-example"><strong>一个具体例子</strong><ExplainedParagraph text={lesson.example} context={context('formula','例子',lesson.example)}/></div>
      <details className="formula" open={!full&&active.id==='formula'?true:undefined}><summary><span className="sigma">∑</span>{stage.id===1?'查看关系与符号':'公式与符号 · 按需展开'}<ChevronDown size={18}/></summary><div className="formula-body"><div className="math" dangerouslySetInnerHTML={{__html:katex.renderToString(lesson.formula.tex,{displayMode:true,throwOnError:false,trust:false})}}/><p><TermText text={lesson.formula.explanation} context={context('formula','公式说明')}/></p><ul>{lesson.formula.symbols.map(s=><li key={s}><TermText text={s} context={context('formula','符号说明')}/></li>)}</ul><button className="text-button" onClick={e=>help.ask(context('formula','公式与符号',`${lesson.formula.tex}\n${lesson.formula.explanation}\n${lesson.formula.symbols.join('\n')}`),e.currentTarget)}><MessageCircle size={14}/>带着公式问 AI</button></div></details>
      <section className="hardware-connection"><h2 className="accent-heading">在仪器里，对应什么</h2><ExplainedParagraph text={lesson.hardware} context={context('formula','硬件对应',lesson.hardware)}/>{stage.id>1&&<a className="text-button" href="#/hardware">查看整机地图<ArrowUpRight size={14}/></a>}{stage.id>=7&&<div className="button-row">{buildSteps.filter(s=>s.lessonIds.includes(lesson.id)).map(s=><a className="secondary-button" key={s.id} href={`#/build/${s.id}`}>制造实践：{s.title}<ArrowRight size={14}/></a>)}</div>}</section>
      <aside className="misconception"><strong>检查一个常见误解</strong><p><TermText text={lesson.misconception} context={context('formula','常见误解')}/></p></aside>
    </section>
    <section className="learning-step" data-step-id="check" hidden={!visible('check')}><div className="step-why-banner"><span>为什么做最后一步自检</span><p>用一道概念题检验刚才的核心因果链是否理顺（答错也不会卡住进度），确认理解后标记本课完成即可进入下一课。</p></div><div className="quiz"><h2 tabIndex={-1}><Check size={20}/>现在，用自己的理解回答。</h2><fieldset><legend>{stripTerms(lesson.quiz.question)}</legend>{lesson.quiz.options.map((option,i)=><label key={i} className={`quiz-option ${progress.answers[lesson.id]===i?'chosen':''}`}><input type="radio" name={`quiz-${lesson.id}`} checked={progress.answers[lesson.id]===i} onChange={()=>onAnswer(i)}/><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{stripTerms(option)}</span></label>)}</fieldset>{progress.answers[lesson.id]!==undefined&&<div className={`quiz-feedback ${progress.answers[lesson.id]===lesson.quiz.answer?'correct':''}`} role="status"><strong>{progress.answers[lesson.id]===lesson.quiz.answer?'理解正确。':'再想一步。'}</strong><TermText text={lesson.quiz.explanation} context={context('check','理解检查解析')}/><span className="answer-line">正确答案：{String.fromCharCode(65+lesson.quiz.answer)} · {stripTerms(lesson.quiz.options[lesson.quiz.answer])}</span></div>}</div>
      <div className={`lesson-completion ${done?'is-done':''}`}><div className="lesson-completion-actions"><button className={done?'secondary-button':'primary-button'} onClick={onComplete}><Check size={16}/>{done?'已完成本课 · 点击撤销':'我理解了，标记本版完成'}</button>{done&&(next?<a className="primary-button lesson-next-cta" href={lessonLocation(next.id)}>进入下一课：{next.id} {next.title}<ArrowRight size={16}/></a>:<a className="primary-button lesson-next-cta" href="#/build">前往硬件工坊实践<ArrowRight size={16}/></a>)}</div><span><strong>{done&&isStageEnd?`已完成第 ${stage.id} 阶段最后一课！`:'本阶段目标：'}</strong>{done&&isStageEnd&&nextStage?`接下来将进入第 ${nextStage.id} 阶段「${nextStage.title}」。`:stage.outcome}</span></div>
      <nav className="lesson-pagination" aria-label="前后课程">{previous?<a href={lessonLocation(previous.id)}><ArrowLeft size={17}/><span><small>上一课 · {previous.id}</small>{previous.title}</span></a>:<span/>}{next?<a href={lessonLocation(next.id)}><span><small>下一课 · {next.id}</small>{next.title}</span><ArrowRight size={17}/></a>:<a href="#/path">回顾学习路线<ArrowRight size={17}/></a>}</nav>
    </section>
    {!full&&<nav className="step-pagination" aria-label="前后学习步骤"><button className="secondary-button" disabled={activeIndex===0} onClick={()=>go(steps[activeIndex-1].id)}><ArrowLeft size={16}/>{activeIndex>0?`上一步：${steps[activeIndex-1].title}`:'上一步'}</button><span>步骤 {activeIndex+1} / {steps.length}</span>{activeIndex<steps.length-1?<button className="primary-button" onClick={()=>go(steps[activeIndex+1].id)}>下一步：{steps[activeIndex+1].title}<ArrowRight size={16}/></button>:<span className="step-end-hint">{done?'已标记完成，可点上方主按钮进入下一课':'确认理解后标记本课完成'}</span>}</nav>}
    <details className="lesson-sources"><summary>本课依据与先修内容<ChevronDown size={15}/></summary><div className="source-links">{lesson.sources.map(id=>sources.find(s=>s.id===id)).filter(s=>!!s).map(s=><a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title}<ArrowUpRight size={13}/></a>)}</div>{lesson.prerequisiteLessonIds.length>0&&<p className="prerequisite-links">需要回顾：{lesson.prerequisiteLessonIds.map(id=><a key={id} href={lessonLocation(id)}>{id} {allLessons.find(l=>l.id===id)?.title}</a>)}</p>}</details>
  </article>;
}
