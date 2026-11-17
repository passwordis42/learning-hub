const sessions = [
  { id: 'A01', player: 'P01', version: 'A', events: [[0, 'start'], [31, 'pickup'], [31, 'pickup'], [49, 'complete']] },
  { id: 'A02', player: 'P02', version: 'A', events: [[0, 'start'], [38, 'help'], [42, 'pickup'], [57, 'complete']] },
  { id: 'A03', player: 'P03', version: 'A', events: [[0, 'start'], [45, 'exit']] },
  { id: 'A04', player: 'P04', version: 'A', events: [[0, 'start'], [21, 'pickup']] },
  { id: 'A05', player: 'P03', version: 'A', events: [[0, 'start'], [12, 'pickup'], [24, 'complete']] },
  { id: 'B01', player: 'P01', version: 'B', events: [[0, 'start'], [15, 'pickup'], [23, 'complete']] }
];

const eventLabels = { start: '开始', pickup: '拾取', help: '求助后得到提示', complete: '完成', exit: '主动退出' };
const metric = (label, value) => ({ label, value });

function eventId(session, time, event) {
  return `${session}-${time}-${event}`;
}

export function analyzePracticeLog({ version, unit, deduplicate }) {
  const selected = sessions.filter((session) => session.version === version);
  const firstByPlayer = new Map();
  for (const session of selected) {
    if (!firstByPlayer.has(session.player)) firstByPlayer.set(session.player, session);
  }
  const attempts = unit === 'first' ? [...firstByPlayer.values()] : selected;
  const report = { starts: attempts.length, independent: 0, assisted: 0, exited: 0, unknown: 0, pickups: 0 };
  for (const { id, events } of attempts) {
    const kinds = events.map(([, kind]) => kind);
    if (kinds.includes('complete')) report[kinds.includes('help') ? 'assisted' : 'independent']++;
    else if (kinds.includes('exit')) report.exited++;
    else report.unknown++;
    const pickups = events.filter(([, kind]) => kind === 'pickup').map(([time, kind]) => eventId(id, time, kind));
    report.pickups += deduplicate ? new Set(pickups).size : pickups.length;
  }
  return report;
}

export function researchLab(root) {
  root.innerHTML = `<p>这是虚构试玩日志。A05 是 P03 的重试，B01 是 P01 玩了另一个版本。有一条拾取事件发了两次，也有一名玩家在日志里没留下结局。先在原始表里找到它们。</p>
    <details class="study-details"><summary>查看原始事件表</summary><div class="lab-table log-events"><table><caption>时点为本次游玩开始后的秒数</caption><thead><tr><th scope="col">版本</th><th scope="col">玩家</th><th scope="col">会话</th><th scope="col">秒</th><th scope="col">事件</th><th scope="col">事件 ID</th></tr></thead><tbody></tbody></table></div></details>
    <div class="lab-controls"><label>版本<select data-filter="version"><option value="a">A · 基线</option><option value="b">B · 改版</option></select></label><label>计算单位<select data-filter="unit"><option value="session">所有会话</option><option value="first">每人首次游玩</option></select></label><label class="lab-check-option"><input type="checkbox" data-filter="deduplicate"> 按事件 ID 去重</label></div>
    <div class="lab-metrics" aria-live="polite"></div><p class="lab-reading">主指标用该版本的起始人数或会话数作分母。缺失结局单列。按首次游玩计算时，重试中的进步用于另作解释。</p>
    <p class="lab-question">先在 A 版比较去重前后的拾取数，再切到每人首次游玩。哪一种操作只清除了重复上报？哪一种换了统计单位？写下结局未知的玩家应该如何处理。</p>`;
  root.querySelector('tbody').innerHTML = sessions.flatMap(({ id, player, version, events }) => events.map(([time, kind]) => `<tr><td>${version}</td><td>${player}</td><td>${id}</td><td>${time}</td><td>${eventLabels[kind]}</td><td>${eventId(id, time, kind)}</td></tr>`)).join('');
  const version = root.querySelector('[data-filter="version"]');
  const unit = root.querySelector('[data-filter="unit"]');
  const deduplicate = root.querySelector('[data-filter="deduplicate"]');
  let last;
  const run = document.createElement('button');
  run.className = 'primary-button';
  run.type = 'button';
  run.textContent = '分析这组日志';
  root.querySelector('.lab-controls').append(run);

  function display() {
    const report = analyzePracticeLog({ version: version.value.toUpperCase(), unit: unit.value, deduplicate: deduplicate.checked });
    last = {
      parameters: [
        metric('版本', version.selectedOptions[0].textContent.trim()),
        metric('计算单位', unit.selectedOptions[0].textContent.trim()),
        metric('按事件 ID 去重', deduplicate.checked ? '是' : '否')
      ],
      results: [
        metric('独立完成', report.independent + ' / ' + report.starts),
        metric('提示后完成', report.assisted), metric('主动退出', report.exited),
        metric('结局未知', report.unknown), metric('拾取事件', report.pickups)
      ]
    };
    root.querySelector('.lab-metrics').innerHTML = `<span>独立完成 <strong>${report.independent} / ${report.starts}</strong></span><span>提示后完成 <strong>${report.assisted}</strong></span><span>主动退出 <strong>${report.exited}</strong></span><span>结局未知 <strong>${report.unknown}</strong></span><span>拾取事件 <strong>${report.pickups}</strong></span>`;
  }
  for (const control of [version, unit, deduplicate]) control.addEventListener('change', display);
  run.addEventListener('click', display);
  return { snapshot: () => last ?? { parameters: [], results: [] } };
}
