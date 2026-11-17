import { appendReading, archiveReadings, canArchiveExperiment, cleanReading, makeExperiment, readExperiments, saveExperiment } from './experiments.js';
import { mountFollowup } from './followup.js';
import { labBriefs } from './lab-briefs.js';

function readingText(reading) {
  const line = (entry) => entry.label + '：' + entry.value;
  return [...reading.parameters.map(line), ...reading.results.map(line)].join('；');
}

function renderReading(reading, escape) {
  const cells = (items) => items.map(({ label, value }) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join('');
  return '<div class="experiment-reading"><div><h5>参数</h5><dl>' + cells(reading.parameters) + '</dl></div>'
    + '<div><h5>实测结果</h5><dl>' + cells(reading.results) + '</dl></div></div>';
}

function dateLabel(date) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.valueOf()) ? '较早的记录' : parsed.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

export function mountExperiment(root, week, lab, title, mount, escape) {
  const thisLab = () => readExperiments().filter((item) => item.week === week.id && item.lab === lab);
  let current = thisLab().findLast((item) => !item.complete);
  let handle;

  function write(message) {
    const saved = saveExperiment(current);
    root.querySelector('[data-save-status]').textContent = saved ? message : '当前浏览器空间不足。请先导出学习记录，避免丢失这次结果。';
    return saved;
  }

  function history() {
    const entries = thisLab().filter((item) => item.complete).reverse();
    const target = root.querySelector('[data-history]');
    target.innerHTML = entries.length ? '<h4>以前的实验</h4>' + entries.map((entry, i) =>
      '<details class="study-details"><summary>第 ' + (entries.length - i) + ' 次 · ' + escape(dateLabel(entry.createdAt)) + '</summary>'
      + '<div><p><strong>预测</strong> ' + escape(entry.prediction) + '</p>'
      + archiveReadings(entry).map((value, number) => '<h5>记录 ' + (number + 1) + '</h5>' + renderReading(value, escape)).join('')
      + '<p class="sample-answer"><strong>复盘</strong> ' + escape(entry.reflection) + '</p><details class="study-details"><summary>用这次实验请 AI 追问</summary><div data-log-ai></div></details></div></details>'
    ).join('') : '';
    target.querySelectorAll('[data-log-ai]').forEach((element, i) => {
      const record = entries[i];
      mountFollowup(element, {
        week: week.id,
        title: '实验复盘 · ' + title,
        draft: record.prediction,
        rationale: record.reflection,
        evidence: archiveReadings(record).map(readingText).join('\n').slice(0, 3900),
        context: '预测和复盘由学习者提交。参数与实测结果由课程实验生成。'
      });
    });
  }

  function recorded() {
    const latest = root.querySelector('[data-latest-reading]');
    latest.hidden = !current.latest;
    latest.querySelector(':scope > div').innerHTML = current.latest ? renderReading(current.latest, escape) : '';
    root.querySelector('[data-readings]').innerHTML = current.readings.map((value, number) =>
      '<details class="study-details"><summary>已记录第 ' + (number + 1) + ' 组参数与结果</summary><div>' + renderReading(value, escape) + '</div></details>'
    ).join('');
    root.querySelector('[data-archive]').disabled = !canArchiveExperiment(current);
    root.querySelector('[data-capture]').disabled = !current.latest || current.readings.length >= 8
      || JSON.stringify(current.latest) === JSON.stringify(current.readings.at(-1));
  }

  function preserveRun() {
    if (!handle || !current || current.complete || !root.isConnected) return;
    const reading = cleanReading(handle.snapshot());
    if (!reading || JSON.stringify(reading) === JSON.stringify(current.latest)) return;
    current = { ...current, latest: reading };
    write('最近一次实测已暂存。可把这组读数加入本次实验。');
    recorded();
  }

  function startControls() {
    const body = root.querySelector('[data-experiment-controls]');
    handle = mount(body);
    for (const event of ['click', 'change', 'input', 'submit']) {
      body.addEventListener(event, () => queueMicrotask(preserveRun));
    }
  }

  function render() {
    handle = null;
    if (!current) {
      root.innerHTML = '<p class="experiment-brief">' + escape(labBriefs[lab]) + '</p><form data-predict class="reasoning-form"><label for="lab-prediction">运行前，你预计会发生什么？</label>'
        + '<textarea id="lab-prediction" maxlength="2000" rows="3" required placeholder="我打算比较……与……。我预测……，因为……。"></textarea>'
        + '<div class="form-actions"><button class="primary-button" type="submit">锁定预测，开始实验</button></div></form><p class="quiet" role="status" data-save-status></p><div data-history></div>';
      root.querySelector('[data-predict]').addEventListener('submit', (event) => {
        event.preventDefault();
        const prediction = root.querySelector('#lab-prediction').value;
        if (prediction.replace(/\s/gu, '').length < 8 || !/[\p{L}\p{N}]/u.test(prediction)) {
          root.querySelector('[data-save-status]').textContent = '先写一项可观察的预测，例如你计划比较什么、预计哪一组结果更高。';
          return;
        }
        current = makeExperiment(week.id, lab, prediction);
        render();
        write('预测已锁定。试跑后可保存一组或多组读数。');
        root.querySelector('[data-experiment-controls]').focus();
      });
      history();
      return;
    }

    root.innerHTML = '<p class="experiment-prediction"><strong>已锁定的预测</strong> ' + escape(current.prediction) + '</p>'
      + '<div data-experiment-controls tabindex="-1"></div><p class="quiet" role="status" data-save-status></p>'
      + '<details class="study-details" data-latest-reading hidden><summary>查看最近一次实测</summary><div></div></details>'
      + '<div class="form-actions"><button class="outline-button" type="button" data-capture>记录这组参数与结果</button></div><div data-readings></div>'
      + '<label for="lab-reflection" class="study-input-label">我的复盘</label><textarea id="lab-reflection" rows="3" maxlength="3000" placeholder="结果和预测相符吗？有什么取舍？下一轮只改哪一项？">' + escape(current.reflection) + '</textarea>'
      + '<div class="form-actions"><button class="primary-button" type="button" data-archive>保存本次实验</button></div>'
      + '<p class="quiet">至少完成一次实测，再写自己的复盘。存档会带上最近一次实测，之前加入的各组读数也会保留。</p><div data-history></div>';
    if (current.latest) {
      root.querySelector('[data-save-status]').textContent = '已恢复上次的读数和笔记。下面的实验可以重新操作，已记录的读数保持原样。';
    }
    root.querySelector('[data-capture]').addEventListener('click', () => {
      const next = appendReading(current, current.latest);
      if (next === current) return;
      current = next;
      write('这组参数和结果已记录。你可以更改一个参数再运行。');
      recorded();
    });
    root.querySelector('#lab-reflection').addEventListener('input', (event) => {
      current = { ...current, reflection: event.target.value };
      write('复盘草稿已保存。');
      recorded();
    });
    root.querySelector('[data-archive]').addEventListener('click', () => {
      if (!canArchiveExperiment(current)) return;
      current = { ...appendReading(current, current.latest), complete: true };
      const saved = write('');
      current = null;
      render();
      root.querySelector('[data-save-status]').textContent = saved ? '本次实验已保存，可展开历史记录或开始下一次预测。' : '本次实验留在当前页面，请导出学习记录。';
    });
    startControls();
    recorded();
    history();
  }

  render();
}
