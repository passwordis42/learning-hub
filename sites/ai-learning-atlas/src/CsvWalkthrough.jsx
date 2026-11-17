import { useId, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import './csv-walkthrough.css';

const example = [
  { question: '申请单没收到', category: '邮件' },
  { question: '申请单没收到', category: '表单' },
  { question: '申请单没收到', category: '邮件' },
  { question: '', category: '' },
];

export function buildCleaningTrace(records) {
  const retained = [];
  return records.map((source, index) => {
    const record = { number: index + 1, question: source.question.trim(), category: source.category.trim() };
    const blank = !record.question && !record.category;
    if (blank) return { record, kept: false, blank };

    const duplicate = retained.find((previous) => previous.question === record.question && previous.category === record.category);
    const comparison = duplicate ?? retained.find((previous) => previous.question === record.question);
    const kept = !duplicate;
    if (kept) retained.push(record);
    return { record, kept, blank, comparison };
  });
}

const trace = buildCleaningTrace(example);

function decisionText({ record, kept, blank, comparison }) {
  if (blank) return '两个字段都为空。脚本跳过这条记录。';
  if (!kept) return `问题和分类都与第 ${comparison.number} 条相同。脚本保留先写出的第 ${comparison.number} 条，跳过第 ${record.number} 条。`;
  if (comparison) return `问题和第 ${comparison.number} 条相同，分类不同。脚本把这条也写入结果。`;
  return '这条记录非空，之前写出的结果里没有相同的记录。脚本把它写入结果。';
}

function RecordTable({ rows, current, caption, showReadState = false }) {
  return (
    <table className="csv-walkthrough-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">原始编号</th><th scope="col">问题</th><th scope="col">分类</th></tr></thead>
      <tbody>
        {rows.map(({ number, question, category }) => (
          <tr key={number} data-current={number === current || undefined}>
            <th scope="row">
              {number}
              {showReadState && number === current && <span className="csv-walkthrough-current">刚处理</span>}
            </th>
            <td>{question || '（空）'}</td>
            <td>{category || '（空）'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CsvWalkthrough() {
  const titleId = useId();
  const [processed, setProcessed] = useState(0);
  const current = trace[processed - 1];
  const output = trace.slice(0, processed).filter(({ kept }) => kept).map(({ record }) => record);
  const finished = processed === trace.length;

  return (
    <section className="csv-walkthrough" aria-labelledby={titleId}>
      <header className="csv-walkthrough-header">
        <h3 id={titleId}>看脚本逐条清洗</h3>
        <p>每点击一次，网页就模拟脚本读一条记录。看脚本读了什么、怎样判断和写入。原始编号供演示对照，文件中只有问题和分类两列。</p>
      </header>

      <div className="csv-walkthrough-flow">
        <RecordTable rows={trace.map(({ record }) => record)} current={processed} caption="1. 脚本读取演示输入" showReadState />
        <section className="csv-walkthrough-decision" aria-label="脚本的比较和决定">
          <h4>2. 脚本比较并决定</h4>
          {current?.comparison && (
            <RecordTable rows={[current.comparison, current.record]} current={processed} caption={`已写出的第 ${current.comparison.number} 条，与刚读到的第 ${current.record.number} 条`} />
          )}
          <p role="status">{current ? `第 ${processed} 条。 ${decisionText(current)}` : '脚本还没读取数据。先点击「读取第 1 条」。'}</p>
        </section>
        {output.length ? <RecordTable rows={output} caption="3. 脚本写出的结果" /> : (
          <div className="csv-walkthrough-output"><h4>3. 脚本写出的结果</h4><p>结果还没有数据行。</p></div>
        )}
      </div>

      <div className="csv-walkthrough-controls">
        <span>已处理 {processed} / {trace.length} 条</span>
        {processed > 0 && !finished && (
          <button type="button" className="action secondary" onClick={() => setProcessed(0)}>
            <RotateCcw size={15} aria-hidden="true" />重来
          </button>
        )}
        <button type="button" className="action secondary" onClick={() => setProcessed((previous) => previous === trace.length ? 0 : previous + 1)}>
          {finished ? '再演示一遍' : `读取第 ${processed + 1} 条`} {finished ? <RotateCcw size={15} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>
      {finished && <p className="csv-walkthrough-next">脚本已处理 {processed} 条，写入结果 {output.length} 条。接下来，可以用刚才的规则判断另一份样本。</p>}
    </section>
  );
}
