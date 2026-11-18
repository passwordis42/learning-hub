import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, Copy, Download } from 'lucide-react';
import CsvWalkthrough from './CsvWalkthrough.jsx';
import { ChangeScript, downloadText, FileFlow, RunScript, SaveScript, WeekPractice } from './DayOnePractice.jsx';
import { GlossaryText, LessonTerm } from './LessonTerm.jsx';
import { weekHref } from './data/lesson-index.js';
import './lesson-guide.css';

const guideSteps = [
  {
    title: '先认识原表、脚本和结果表',
    task: '先看三个文件从哪里来，再跟着一条例子判断何时保留、何时跳过。',
    why: '先理清「原始表 → 处理脚本 → 结果表」的分工，才能做到不改坏原始数据，看清每一条去重规则到底改变了什么。',
    minutes: 5,
  },
  {
    title: '手算并记录判断',
    task: '根据规则预测清洗后会剩几条，并写出你检查了哪些记录。',
    why: 'AI 写出的代码表面上往往很通顺；只有你自己先在 10 条小样本上算出标准答案，下一步才有依据检验 AI 有没有写错规则。',
    minutes: 10,
  },
  {
    title: '请 AI 起草脚本',
    task: '确认输入、处理规则和输出文件，然后请 AI 生成脚本。',
    why: '把模糊需求拆成明确的「输入、规则、输出」三要素再交给 AI，能避免 AI 自行猜测列名或删错记录。',
    minutes: 10,
  },
  {
    title: '运行并核对',
    task: '运行脚本，把它生成的文件和你手算的结果逐条对照。',
    why: '程序没报错不代表结果正确；把实际输出与手算基准逐条核对，才算真正完成工程验收。',
    minutes: 20,
  },
  {
    title: '改规则，再跑一次',
    task: '亲手改一处去重规则，记录这次结果和发生变化的原因。',
    why: '真实数据任务经常要调整口径；亲手改一行判断条件并预测结果变化，能确认你真正掌控了代码逻辑。',
    minutes: 10,
  },
];
const finish = guideSteps.length;
const outputChecks = [1, 2, 3];
const emptyDraft = { rows: '', reason: '', evidence: '' };
const checkRecords = [
  { id: 1, question: '页面加载慢', category: '性能' },
  { id: 2, question: '页面加载慢', category: '访问' },
  { id: 3, question: '页面加载慢', category: '性能' },
];
const checkChoices = [
  { id: 'second', text: '删第 2 条', feedback: '再看分类。第 2 条是「访问」，和第 1 条的「性能」不同，因此应保留。' },
  { id: 'third', text: '删第 3 条', feedback: '答对了。第 3 条的两个字段都与第 1 条相同，保留第一次出现的记录。' },
  { id: 'both', text: '删第 2、3 条', feedback: '你找到了相同的问题。再比较分类，只删除两个字段都重复的记录。' },
];

function judgmentReady(fields) {
  const rows = Number(fields.rows);
  return fields.rows !== '' && Number.isInteger(rows) && rows >= 0 && rows <= 10 && Boolean(fields.reason.trim() && fields.evidence.trim());
}

function Sample({ csv }) {
  return (
    <details className="guide-sample" open>
      <summary>查看 10 条客服记录</summary>
      <div className="code-frame">
        <div><span>tickets.csv</span><button className="action small-action" type="button" onClick={() => downloadText('tickets.csv', csv, 'text/csv')}><Download size={15} />下载样本</button></div>
        <pre><code>{csv.trimEnd()}</code></pre>
      </div>
    </details>
  );
}

function ConceptCheck({ answer, onAnswer }) {
  return (
    <section className="guide-quiz" aria-labelledby="guide-quiz-title">
      <h3 id="guide-quiz-title">小测：试一试整行去重</h3>
      <p>看完上面的逐行演示后试一试：下面三条记录的问题一模一样，如果按「整行去重」（问题和分类都相同才算重复），哪一条应该删掉？</p>
      <table className="guide-quiz-table">
        <thead><tr><th scope="col">记录</th><th scope="col">问题</th><th scope="col">分类</th></tr></thead>
        <tbody>{checkRecords.map(({ id, question, category }) => <tr key={id}><th scope="row">{id}</th><td>{question}</td><td>{category}</td></tr>)}</tbody>
      </table>
      <div className="guide-inline" role="group" aria-label="去重练习答案">
        {checkChoices.map(({ id, text }) => <button key={id} className="action secondary" type="button" aria-pressed={answer === id} onClick={() => onAnswer(id)}>{text}</button>)}
      </div>
      <p role="status" className="guide-note">{checkChoices.find(({ id }) => id === answer)?.feedback}</p>
    </section>
  );
}

function Judgment({ draft, setDraft, onSave }) {
  function update(field, value) {
    setDraft((old) => ({ ...(old ?? emptyDraft), [field]: value }));
  }

  return (
    <form id="guide-judgment" className="reflection" onSubmit={(event) => {
      event.preventDefault();
      if (judgmentReady(draft)) onSave({ rows: Number(draft.rows), reason: draft.reason.trim(), evidence: draft.evidence.trim() });
    }}>
      <label>我预测保留的记录数
        <input type="number" min="0" max="10" step="1" required value={draft.rows} onChange={(event) => update('rows', event.target.value)} />
      </label>
      <label>我的理由
        <textarea rows={2} required maxLength={500} value={draft.reason} placeholder="你是按什么规则判断的？例如：先去掉全空行，再比较问题和分类……" onChange={(event) => update('reason', event.target.value)} />
      </label>
      <label>我的证据
        <textarea rows={2} required maxLength={650} value={draft.evidence} placeholder="写下被跳过或去重的具体行（如空行、重复的记录）。" onChange={(event) => update('evidence', event.target.value)} />
      </label>
    </form>
  );
}

function AiDraft({ lesson, reflection, scopeConfirmed, setScopeConfirmed, tutorPanel }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [showTutor, setShowTutor] = useState(false);
  const promptRef = useRef(null);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(lesson.prompt);
      setCopyStatus('已复制。把提示词粘贴到你的 AI 工具，生成脚本后保存为 clean_tickets.py。');
    } catch {
      promptRef.current?.focus();
      promptRef.current?.select();
      setCopyStatus('提示词已选中，可以手动复制。');
    }
  }

  return (
    <>
      <p className="guide-note" role="status">
        你的预测是 {reflection.rows} 条。{reflection.rows === lesson.expectedRows ? '和手算参考结果一致！现在你有了一份可靠的验收标准。' : '可以先点开下方「核对手算结果」对照空记录和重复记录，看看差异在哪里。'}
      </p>
      <details className="review-box"><summary>核对手算结果</summary><p>{lesson.expectedSummary}</p></details>
      <div className="guide-block">
        <h3>核对委托给 AI 的任务边界</h3>
        <p>向 AI 提需求前，先由你锁定下面三条规则。确认后把<LessonTerm term="提示词" />交给 AI 生成代码，并保存为<LessonTerm term="脚本" />文件。</p>
        <ul>
          <li>输入文件是 <code>tickets.csv</code>，先去掉字段首尾空白，再丢弃两列都为空的记录。</li>
          <li>只有问题和分类都相同才算重复，保留第一次出现的记录。</li>
          <li>结果另存为 <code>clean_tickets.csv</code>，保留原始文件不覆盖。</li>
        </ul>
        <label className="scope-check"><input type="checkbox" checked={scopeConfirmed} onChange={(event) => setScopeConfirmed(event.target.checked)} />我确认输入、规则和输出。遇到不清楚的地方，先让 AI 向我提问。</label>
      </div>
      {scopeConfirmed && (
        <div className="guide-block">
          <label className="guide-prompt-label">本课提示词
            <textarea className="guide-prompt" ref={promptRef} readOnly rows={4} value={lesson.prompt} />
          </label>
          <div className="guide-inline">
            <button className="action secondary" type="button" onClick={copyPrompt}><Copy size={16} />复制本课提示词</button>
            <button className="action secondary" aria-expanded={showTutor} type="button" onClick={() => setShowTutor(!showTutor)}>{showTutor ? '收起 AI 学伴' : '在这里打开 AI 学伴'}</button>
          </div>
          {copyStatus && <p className="guide-note" role="status">{copyStatus}</p>}
          {showTutor && tutorPanel}
          <SaveScript csv={lesson.csv} />
        </div>
      )}
    </>
  );
}

function Checks({ items, labels, checklist, onCheck }) {
  return (
    <div className="guide-checks">
      {items.map((index) => (
        <label key={index}>
          <input type="checkbox" checked={checklist.includes(index)} onChange={() => onCheck(index)} />{labels[index]}
        </label>
      ))}
    </div>
  );
}

export default function DayOne({
  lesson, checklist, setChecklist, done, setDone, reflection, setReflection, scopeConfirmed, setScopeConfirmed,
  position, setPosition, draft, setDraft, experiment, setExperiment, tutorPanel,
}) {
  const ranChecks = outputChecks.every((index) => checklist.includes(index));
  const limit = !reflection ? 1 : !scopeConfirmed ? 2 : !ranChecks ? 3 : done ? finish : 4;
  const legacyStep = done ? finish : scopeConfirmed && ranChecks ? 4 : reflection ? 2 : 0;
  const reached = Math.min(limit, Math.max(position?.reached ?? 0, legacyStep));
  const step = Math.min(position?.step ?? legacyStep, reached);
  const current = guideSteps[step];
  const headingRef = useRef(null);
  const justNavigated = useRef(false);
  const draftValue = draft ?? (reflection ? { ...reflection, rows: String(reflection.rows) } : emptyDraft);
  const changePrediction = position?.changePrediction ?? '';
  const canChange = Boolean(position?.changeReady || checklist.includes(4) || experiment.trim());

  useEffect(() => {
    if (justNavigated.current) {
      justNavigated.current = false;
      window.scrollTo(0, 0);
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [step]);

  function openStep(next) {
    justNavigated.current = true;
    setPosition((old) => ({ ...old, step: next, reached: Math.max(reached, next) }));
  }

  function toggleCheck(index) {
    setChecklist((old) => old.includes(index) ? old.filter((entry) => entry !== index) : [...old, index]);
    if (done) setDone(false);
  }

  function saveJudgment(value) {
    setReflection(value);
    setChecklist((old) => old.includes(0) ? old : [...old, 0]);
    openStep(2);
  }

  function confirmScope(confirmed) {
    setScopeConfirmed(confirmed);
    if (!confirmed && done) setDone(false);
  }

  function finishLesson() {
    setChecklist((old) => old.includes(4) ? old : [...old, 4]);
    setDone(true);
    openStep(finish);
  }

  const actionHints = [
    '看完演示或做完小测后，去 10 条真实记录上试算',
    !judgmentReady(draftValue) ? '填好保留条数（0–10）、理由和具体记录后解锁下一步' : '已填完整，保存后进入 AI 起草步骤',
    !scopeConfirmed ? '请先勾选上方「我确认输入、规则和输出」再继续' : '保存好 clean_tickets.py 后即可进入运行核对',
    !ranChecks ? '完成上方 3 项输出核对勾选后解锁下一步' : '核对通过，去尝试改一条去重规则',
    !canChange ? '先在上方写下你的预测并点「保存预测，查看改法」' : (!experiment.trim() && !checklist.includes(4) ? '写下复跑后的条数差异与原因即可完成第一天' : '可以标记第一天完成了'),
  ];

  const buttons = [
    <button key="sample" className="action primary" type="button" onClick={() => openStep(1)}>查看样本并预测 <ArrowRight size={18} /></button>,
    <button key="save" className="action primary" type="submit" form="guide-judgment" disabled={!judgmentReady(draftValue)}>保存判断，去核对规则 <ArrowRight size={18} /></button>,
    <button key="run" className="action primary" type="button" disabled={!scopeConfirmed} onClick={() => openStep(3)}>脚本已保存，去运行 <ArrowRight size={18} /></button>,
    <button key="change" className="action primary" type="button" disabled={!ranChecks} onClick={() => openStep(4)}>核对完毕，去改规则 <ArrowRight size={18} /></button>,
    <button key="finish" className="action primary" type="button" disabled={!experiment.trim() && !checklist.includes(4)} onClick={finishLesson}>完成第一天 <Check size={18} /></button>,
  ];

  return (
    <div className="guided-lesson">
      <header className="guide-header">
        <div className="hero-meta"><span className="label-chip">阶段 1 · 第 1 周 · 第一天</span><span className="time-note"><Clock3 size={16} />约 {lesson.minutes} 分钟</span></div>
        <h1>{lesson.title}</h1>
        <p>我们用<LessonTerm term="CSV" />装一张客服工单表，用<LessonTerm term="脚本" />告诉电脑如何清理空行与重复行：<strong>你先手算标准答案，再委托 AI 写代码，最后亲手改一条规则验证</strong>。</p>
      </header>
      <section className="onboarding-banner panel" aria-label="为什么从清洗表格开始学 AI">
        <div className="onboarding-banner-head">
          <span className="label-chip">起步导读</span>
          <strong>为什么学 AI 第一天不直接调大模型，而是先清洗一张 10 行 CSV 表？</strong>
        </div>
        <div className="onboarding-pillars">
          <div>
            <b>1. 数据是所有模型的地基</b>
            <p>无论是训练分类器还是搭建大模型知识库（RAG），原始记录里的空行、重复和标签冲突都会直接误导模型——看清数据是一切 AI 工程的第一步。</p>
          </div>
          <div>
            <b>2. 先手算真值，才敢用 AI 写代码</b>
            <p>AI 生成代码很快，但也会悄悄理解错规则。先在 10 行样本上算出标准答案，你才能一眼验出 AI 写得对不对，而不是盲目相信输出。</p>
          </div>
          <div>
            <b>3. 同一份工单贯穿后续主线</b>
            <p>今天洗干净的客服工单，会在第 1–8 周用来建立测试用例、向量与基线分类模型，并在后续阶段升级为站内检索问答系统。</p>
          </div>
        </div>
      </section>
      <div className="guide-progress">
        <div className="guide-progress-copy"><strong>{current ? `第 ${step + 1} / ${finish} 步 · ${current.title}` : '第一天已完成'}</strong><span>已完成 {reached} / {finish} 步</span></div>
        <progress aria-label="第一天课程进度" value={reached} max={finish} />
      </div>
      <div className="guide-layout">
        <div className="guide-main">
          <section className="guide-card panel" aria-labelledby="guide-step-title">
            <div className="guide-card-head">
              <span className="guide-kicker">{current ? `步骤 ${step + 1} / ${finish} · 约 ${current.minutes} 分钟` : '练习完成'}</span>
              <h2 id="guide-step-title" ref={headingRef} tabIndex={-1}>{current?.title ?? '你完成了第一天的练习'}</h2>
              <p>{current?.task ?? '保留原始文件、清洗后的文件和改规则前后的运行结果。它们是你今天的验收证据。'}</p>
              {current?.why && (
                <div className="why-step-banner">
                  <strong>为什么要做这一步？</strong>
                  <span>{current.why}</span>
                </div>
              )}
              {current && <div className="guide-next"><ArrowRight size={15} /><strong>下一步预告</strong><span>{guideSteps[step + 1]?.title ?? '完成第一天，进入第 1 周边界样本练习'}</span></div>}
            </div>
            <div className="guide-content" key={step}>
              {step === 0 && (
                <>
                  <p className="guide-terms-note">提示：正文中带虚线下划线的词（如 CSV、脚本、记录）都可以点击查看白话解释与例子。</p>
                  <FileFlow />
                  <div className="concept-grid">
                    {lesson.concepts.map((concept) => <article key={concept.title}><h3><GlossaryText text={concept.title} /></h3><p><GlossaryText text={concept.body} /></p><p className="example">{concept.example}</p></article>)}
                  </div>
                  <details className="review-box" open>
                    <summary>互动演示 · 先看脚本怎样逐行扫描这张小表</summary>
                    <CsvWalkthrough />
                  </details>
                  <ConceptCheck answer={position?.answer} onAnswer={(answer) => setPosition((old) => ({ ...old, answer }))} />
                </>
              )}
              {step === 1 && (
                <>
                  <p>现在请你先扮演一次“人肉脚本”：从上往下读每一条<LessonTerm term="记录" />，先忽略每格首尾空白；<strong>两格都空就跳过</strong>；否则比较「问题」和「分类」，<strong>两个字段都相同时只保留第一次出现的那条</strong>。注意第一行<LessonTerm term="表头" />是列名，不计入数据条数。</p>
                  <Sample csv={lesson.csv} />
                  <details className="review-box"><summary>卡住了？点开看手算分步提示</summary><p>给表头下面的 10 行数据从 1 到 10 编号：① 先找出只有逗号、两侧全是空白的空行划掉；② 再看有没有哪两行的「问题」和「分类」完全一样（注意同问题但不同分类不算整行重复！），划掉后面重复出现的那行。</p></details>
                  <Judgment draft={draftValue} setDraft={(update) => setDraft((old) => update(old ?? draftValue))} onSave={saveJudgment} />
                </>
              )}
              {step === 2 && <AiDraft lesson={lesson} reflection={reflection} scopeConfirmed={scopeConfirmed} setScopeConfirmed={confirmScope} tutorPanel={tutorPanel} />}
              {step === 3 && (
                <>
                  <RunScript expectedSummary={lesson.expectedSummary} />
                  <Checks items={outputChecks} labels={lesson.checklist} checklist={checklist} onCheck={toggleCheck} />
                </>
              )}
              {step === 4 && (
                <>
                  <div className="guide-block reflection">
                    <label>{lesson.reviewQuestion}
                      <textarea rows={2} maxLength={350} value={changePrediction} readOnly={canChange} placeholder="先写你的预测：如果只按「问题」文字去重，哪一条原本保留的记录会被额外删掉？" onChange={(event) => {
                        const value = event.target.value;
                        setPosition((old) => ({ ...old, changePrediction: value }));
                      }} />
                    </label>
                    {!canChange && <button className="action secondary" type="button" disabled={!changePrediction.trim()} onClick={() => setPosition((old) => ({ ...old, changeReady: true }))}>保存预测，查看改法</button>}
                  </div>
                  {canChange && (
                    <>
                      <ChangeScript />
                      <div className="guide-block reflection">
                        <label>这次保留了几条？为什么？
                          <textarea rows={3} maxLength={650} value={experiment} placeholder="写下实际保留条数、少了哪条，以及你的解释。" onChange={(event) => setExperiment(event.target.value)} />
                        </label>
                      </div>
                    </>
                  )}
                </>
              )}
              {step === finish && (
                <>
                  <details className="review-box" open><summary>核对复跑结果</summary>{experiment.trim() && <p><strong>你的记录</strong>　{experiment.trim()}</p>}<p>{lesson.reviewAnswer}</p></details>
                  <div className="guide-complete">
                    <span className="label-chip">推荐下一步</span>
                    <h3>第 01 周 · 用三种样本检查清洗规则</h3>
                    <p>今天你已经走通了「手算真值 → 让 AI 写脚本 → 运行核对 → 改规则复测」的完整闭环。下一课你将学会设计<strong>正常表、全空表、分类冲突表</strong>三类测试样本，系统检验任何数据处理程序。</p>
                    <WeekPractice />
                  </div>
                </>
              )}
            </div>
            <div className="guide-actions">
              {step > 0 && <button className="action secondary" type="button" onClick={() => openStep(step - 1)}><ArrowLeft size={16} />{current ? '上一步' : '回顾最后一步'}</button>}
              {current && <span className="guide-action-hint">{actionHints[step]}</span>}
              {current ? buttons[step] : <a className="action primary" href={weekHref(1)}>进入第 1 周 · 下一课 <ArrowRight size={17} /></a>}
            </div>
          </section>
        </div>
        <aside className="guide-sidebar" aria-label="本课步骤与资料">
          <nav className="guide-outline panel" aria-label="本课步骤">
            <h2>本课步骤</h2>
            <ol>
              {guideSteps.map(({ title }, index) => {
                const status = index === step ? 'current' : index < reached ? 'done' : 'upcoming';
                return (
                  <li key={title} className="guide-outline-item" data-state={status}>
                    <button type="button" disabled={index > reached || index === step} aria-current={index === step ? 'step' : undefined} onClick={() => openStep(index)}>
                      <span className="guide-step-dot" aria-hidden="true">{status === 'done' ? <Check size={14} /> : index + 1}</span>
                      <span>{title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="guide-outline panel">
            <details className="guide-resources">
              <summary>参考资料</summary>
              {lesson.resources.map(({ title, url }) => <a key={url} href={url} target="_blank" rel="noreferrer">{title} <ArrowRight size={14} /></a>)}
            </details>
            <p className="fineprint">步骤与学习记录自动保存在此浏览器。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
