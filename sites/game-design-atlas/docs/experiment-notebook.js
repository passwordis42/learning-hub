import { appendReading, archiveReadings, canArchiveExperiment, cleanReading, makeExperiment, readExperiments, saveExperiment } from './experiments.js';
import { mountFollowup } from './followup.js';
import { labBriefs, labGuides } from './lab-briefs.js';

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
  const guide = labGuides[lab];

  function write(message) {
    const saved = saveExperiment(current);
    root.querySelector('[data-save-status]').textContent = saved ? message : '当前浏览器空间不足。请先导出学习记录，避免丢失这次结果。';
    return saved;
  }

  function history(openLatest = false) {
    const entries = thisLab().filter((item) => item.complete).reverse();
    const target = root.querySelector('[data-history]');
    target.innerHTML = entries.length ? '<h4>已保存的实验记录（会自动同步到下一步「自己做一遍」）</h4>' + entries.map((entry, i) =>
      '<details class="study-details"' + (openLatest && i === 0 ? ' open' : '') + '><summary>第 ' + (entries.length - i) + ' 次 · ' + escape(dateLabel(entry.createdAt)) + '</summary>'
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
    write('最近一次实测已暂存。点下方「记录这组参数与结果」可留作对照。');
    recorded();
  }

  function startControls() {
    const body = root.querySelector('[data-experiment-controls]');
    handle = mount(body);
    for (const event of ['click', 'change', 'input', 'submit']) {
      body.addEventListener(event, () => queueMicrotask(preserveRun));
    }
  }

  function render(justSaved = false) {
    handle = null;
    if (!current) {
      const previewCard = guide ? '<div class="experiment-preview">'
        + '<div class="experiment-preview-why"><strong>为什么要做这个实验？</strong><span>' + escape(guide.why) + '</span></div>'
        + '<dl class="experiment-preview-grid">'
        + '<div><dt>实验台里能调什么</dt><dd>' + escape(guide.controls) + '</dd></div>'
        + '<div><dt>重点观察什么指标</dt><dd>' + escape(guide.observe) + '</dd></div>'
        + '</dl></div>' : '';
      const savedBanner = justSaved ? '<div class="experiment-saved-banner"><strong>✓ 本次实验已保存！</strong><span>你的实测读数已自动同步到下一步「自己做一遍」供对照参考。你可以直接点页面下方进入下一步，也可以在下面开启新一轮预测。</span></div>' : '';
      root.innerHTML = savedBanner + previewCard
        + '<p class="experiment-brief">' + escape(labBriefs[lab]) + '</p>'
        + '<form data-predict class="reasoning-form"><div class="experiment-label-row"><label for="lab-prediction">先写一句你的预测，再解锁实验台（避免只看结果马后炮）</label>'
        + (guide?.template ? '<button class="outline-button small-btn" type="button" data-fill-template>填入预测句式模板</button>' : '')
        + '</div>'
        + '<textarea id="lab-prediction" maxlength="2000" rows="3" required placeholder="我打算比较……与……。我预测……，因为……。"></textarea>'
        + '<div class="form-actions"><button class="primary-button" type="submit">锁定预测，开始实验</button></div></form><p class="quiet" role="status" data-save-status></p><div data-history></div>';
      root.querySelector('[data-fill-template]')?.addEventListener('click', () => {
        const box = root.querySelector('#lab-prediction');
        if (!box.value.trim()) box.value = guide.template;
        box.focus();
      });
      root.querySelector('[data-predict]').addEventListener('submit', (event) => {
        event.preventDefault();
        const prediction = root.querySelector('#lab-prediction').value;
        if (prediction.replace(/\s/gu, '').length < 8 || !/[\p{L}\p{N}]/u.test(prediction)) {
          root.querySelector('[data-save-status]').textContent = '先写一项可观察的预测（至少 8 个字），例如你计划比较什么、预计哪一组结果更高。';
          return;
        }
        current = makeExperiment(week.id, lab, prediction);
        render();
        write('预测已锁定。试跑后可保存一组或多组读数。');
        root.querySelector('[data-experiment-controls]').focus();
      });
      history(justSaved);
      return;
    }

    root.innerHTML = '<div class="experiment-steps-bar"><span><b>① 试跑观察</b> 在下方实验台操作一次</span><span><b>② 记录对照</b> 存下参数再改一项重跑</span><span><b>③ 复盘存档</b> 对照预测写结论并保存</span></div>'
      + '<p class="experiment-prediction"><strong>已锁定的预测</strong> ' + escape(current.prediction) + '</p>'
      + '<div data-experiment-controls tabindex="-1"></div><p class="quiet" role="status" data-save-status></p>'
      + '<details class="study-details" data-latest-reading hidden open><summary>查看最近一次实测读数</summary><div></div></details>'
      + '<div class="form-actions"><button class="outline-button" type="button" data-capture>记录这组参数与结果</button></div><div data-readings></div>'
      + '<label for="lab-reflection" class="study-input-label">我的实验复盘</label><textarea id="lab-reflection" rows="3" maxlength="3000" placeholder="实测结果和你的预测相符吗？暴露了什么设计取舍？下一轮只改哪一项？">' + escape(current.reflection) + '</textarea>'
      + '<div class="form-actions"><button class="primary-button" type="button" data-archive>保存本次实验</button></div>'
      + '<p class="quiet">完成至少一次实测并写下复盘（不少于 8 个字）即可保存。保存后读数会自动同步到下一步「自己做一遍」。</p><div data-history></div>';
    if (current.latest) {
      root.querySelector('[data-save-status]').textContent = '已恢复上次的读数和笔记。下面的实验可以重新操作，已记录的读数保持原样。';
    }
    root.querySelector('[data-capture]').addEventListener('click', () => {
      const next = appendReading(current, current.latest);
      if (next === current) return;
      current = next;
      write('这组参数和结果已记录。现在只改一个参数再试跑一次作对照。');
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
      render(saved);
      root.querySelector('[data-save-status]').textContent = saved ? '本次实验已保存，可前往下一步「自己做一遍」或展开下方历史记录。' : '本次实验留在当前页面，请导出学习记录。';
    });
    startControls();
    recorded();
    history();
  }

  render();
}
