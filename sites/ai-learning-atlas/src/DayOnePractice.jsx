import { Download } from 'lucide-react';
import referenceScript from './data/clean_tickets.py?raw';
import { LessonTerm } from './LessonTerm.jsx';

export function downloadText(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FileFlow() {
  return (
    <div className="guide-file-flow" aria-label="谁准备文件，谁负责运行">
      <ol>
        <li><strong>网页提供原表</strong><code>tickets.csv</code><span>你下载它。</span></li>
        <li><strong>AI 写操作步骤</strong><code>clean_tickets.py</code><span>你把回答里的代码保存成这个文件。</span></li>
        <li><strong>你启动 Python</strong><code>clean_tickets.csv</code><span>Python 按脚本处理原表，再生成这张新表。</span></li>
      </ol>
    </div>
  );
}

export function SaveScript({ csv }) {
  return (
    <div className="guide-block">
      <h3>把两个文件放到一起</h3>
      <ol className="guide-instructions">
        <li>新建一个练习文件夹。把网站下载的 <code>tickets.csv</code> 移进去。它是脚本要读的<LessonTerm term="输入文件" />。</li>
        <li>把 AI 回复中的代码复制到<LessonTerm term="文本编辑器">记事本</LessonTerm>。代码块开头和结尾的三个反引号留在聊天里，只把里面的代码粘过来。</li>
        <li>在记事本选「另存为」，文件名填 <code>clean_tickets.py</code>，保存类型选「所有文件」，<LessonTerm term="编码" />选 <LessonTerm term="UTF-8" />，存进同一个练习文件夹。</li>
      </ol>
      <p>继续前，你应看到 <code>tickets.csv</code> 和 <code>clean_tickets.py</code>。如果代码文件以 <code>.py.txt</code> 结尾，检查<LessonTerm term="扩展名" />并重新另存。</p>
      <div className="guide-inline">
        <button className="action small-action" type="button" onClick={() => downloadText('tickets.csv', csv, 'text/csv')}><Download size={15} />下载原表</button>
      </div>
      <details className="review-box">
        <summary>拿不到 AI 代码？用课程的参考脚本</summary>
        <p>把参考文件下载到练习文件夹。它可以替代 AI 生成的脚本，后面的运行、核对和改规则步骤相同。</p>
        <button className="action small-action" type="button" onClick={() => downloadText('clean_tickets.py', referenceScript)}><Download size={15} />下载 clean_tickets.py</button>
        <details className="review-box"><summary>看参考代码</summary><pre className="guide-code"><code>{referenceScript.trimEnd()}</code></pre></details>
      </details>
    </div>
  );
}

export function RunScript({ expectedSummary }) {
  return (
    <>
      <div className="guide-block">
        <h3>先确认电脑准备好了</h3>
        <ol className="guide-instructions">
          <li>在 Windows 文件资源管理器里打开练习文件夹。点击上方显示文件夹位置的地址栏，输入 <code>powershell</code> 并按回车。它会在这个位置打开一个可输入文字<LessonTerm term="命令" />的<LessonTerm term="终端" />。</li>
          <li>在窗口输入 <code>dir</code> 并按回车。列表应同时出现 <code>tickets.csv</code> 和 <code>clean_tickets.py</code>。如果找不到其中一个，先回到文件夹检查文件。</li>
          <li>输入 <code>python --version</code>。看到类似 <code>Python 3.14.0</code> 的版本号，就用下面的 <code>python</code> 命令。若提示找不到命令，试 <code>py --version</code>。如果它显示 Python 3 的版本号，运行时用 <code>py clean_tickets.py</code>。</li>
        </ol>
        <details className="review-box">
          <summary>还没装 Python，或者我用的是 Mac</summary>
          <p>Windows 上如果两条命令都得不到 Python 3 的版本号，按 <a href="https://docs.python.org/zh-cn/3/using/windows.html" target="_blank" rel="noreferrer">Python 官方 Windows 指南</a>安装后重新打开窗口。Mac 用户可以在终端切换到存文件的文件夹，用 <code>ls</code> 列出文件，再用 <code>python3 --version</code> 检查，成功后用 <code>python3 clean_tickets.py</code> 运行。</p>
        </details>
        <h3>看到版本号和两个文件后，再运行</h3>
        <div className="code-frame"><pre><code>python clean_tickets.py</code></pre></div>
        <p><LessonTerm term="Python" />会按脚本读取原表并生成<LessonTerm term="输出文件" />。当窗口回到可以打下一条命令的状态，回到练习文件夹，打开新出现的 <code>clean_tickets.csv</code> 核对数据。</p>
      </div>
      <details className="review-box"><summary>运行后再对照应看到的结果</summary><p>{expectedSummary}</p><p>如果窗口有报错，先处理它。检查刚生成的文件，避免把上一次运行留下来的结果当作这一次的结果。</p></details>
    </>
  );
}

export function ChangeScript() {
  return (
    <div className="guide-block">
      <ol className="guide-instructions">
        <li>先复制 <code>clean_tickets.py</code>。把副本命名为 <code>clean_tickets_by_question.py</code>，让第一版脚本继续保留。</li>
        <li>用记事本打开副本，找到脚本拿来比较的<LessonTerm term="判重键" />。参考脚本中原来是 <code>key = (question, category)</code>，把这一行改为 <code>key = question</code>。AI 写的变量名可能不同，找的是「用问题和分类共同判断重复」的那一处。</li>
        <li>在副本里找到输出文件名，把 <code>clean_tickets.csv</code> 改成 <code>clean_tickets_by_question.csv</code>。这样第一版的结果仍可打开对比。</li>
      </ol>
      <div className="code-frame"><pre><code>python clean_tickets_by_question.py</code></pre></div>
      <p>保存后，在同一个窗口运行副本。如果前一步用的是 <code>py</code> 或 <code>python3</code>，这次仍用对应命令。打开两张结果表，核对哪条记录只出现在第一版。</p>
    </div>
  );
}

const testCases = [
  { id: 'normal', title: '普通记录', csv: '问题,分类\n我要下载账单,账单\n', check: '两版都保留这一条。' },
  { id: 'empty', title: '全空记录', csv: '问题,分类\n,\n', check: '两版的输出文件都只有表头。' },
  { id: 'conflict', title: '同一问题，两种分类', csv: '问题,分类\n无法付款,账单\n无法付款,访问\n', check: '整行去重保留两条，只按问题比较保留第一条。' },
];

export function WeekPractice() {
  return (
    <details className="review-box">
      <summary>下载三组补充样本</summary>
      <p>建三个小文件夹，各复制一份两版脚本。每个文件夹放一份下方下载的 <code>tickets.csv</code>。先写下两版各应保留几条，再在对应文件夹运行对照。这样每组输出都能保留下来。</p>
      <div className="guide-test-cases">
        {testCases.map(({ id, title, csv, check }) => (
          <article key={id}>
            <h4>{title}</h4>
            <pre className="guide-code"><code>{csv.trimEnd()}</code></pre>
            <button className="action small-action" type="button" onClick={() => downloadText('tickets.csv', csv, 'text/csv')}><Download size={15} />下载这份样本</button>
            <details className="review-box"><summary>运行后核对</summary><p>{check}</p></details>
          </article>
        ))}
      </div>
      <p>每组记下「我预测的条数、实际条数、哪条记录产生了差异」。如果不同，保留输入和输出再回看脚本。</p>
    </details>
  );
}
