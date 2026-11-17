import { prototypeLab } from './prototype-lab.js';
import { researchLab } from './research-lab.js';
import { earlyGenreLabs } from './genre-labs-16-19.js';
import { lateGenreLabs } from './genre-labs-20-23.js';

const metric = (label, value) => ({ label, value });

export function calculateBudget({ opening, supply, demand, turns }) {
  let stock = opening;
  return Array.from({ length: turns }, (_, index) => {
    const available = stock + supply;
    const used = Math.min(demand, available);
    stock = available - used;
    return { round: index + 1, stock, shortage: demand - used };
  });
}

export function jumpSucceeds(delay, grace) {
  return delay <= grace;
}

const funnelData = {
  a: { new: [5, 3, 2, 1], experienced: [4, 4, 3, 3] },
  b: { new: [5, 5, 4, 3], experienced: [4, 4, 4, 3] }
};

export function funnelNumbers(version, cohort) {
  const sample = funnelData[version];
  if (cohort === 'all') return sample.new.map((count, i) => count + sample.experienced[i]);
  return sample[cohort];
}

const labs = {
  loop: { title: '给两条路线跑一遍规则', mount: loopLab },
  prototype: { title: '在最小原型里验证触发与重开', mount: prototypeLab },
  economy: { title: '六回合供电台', mount: economyLab },
  route: { title: '比较原版路口和地标版', mount: routeLab },
  funnel: { title: '用漏斗定位上手障碍', mount: funnelLab },
  'research-log': { title: '从原始日志算出独立完成率', mount: researchLab },
  ...earlyGenreLabs,
  ...lateGenreLabs
};

export const labLabels = Object.fromEntries(Object.entries(labs).map(([id, item]) => [id, item.title]));

function loopLab(root) {
  root.innerHTML = `<p>复现上一步的返程。主通道固定消耗 5 格。维修通道消耗 2 格，遇到警报再扣 4 格。实验用 50% 的警报概率让你比较两种结果。电量刚好付清也能回基地。</p>
    <div class="lab-controls"><label>返程起始电量<select data-start><option value="7">7 格</option><option value="5">5 格</option></select></label></div>
    <div class="lab-metrics" aria-live="polite"></div>
    <div class="lab-controls"><button class="primary-button" type="button" data-route="safe">走主通道</button><button class="outline-button" type="button" data-route="risk">走维修通道</button><button class="outline-button" type="button" data-next>修好灯，开始下一轮</button><button class="outline-button" type="button" data-reset>重置实验</button></div>
    <p class="lab-reading" role="status"></p>
    <p class="lab-question">以 7 格和 5 格各试一次。哪条规则改变了你对风险的判断？回到基地后，修灯这个结果怎样改变了下一轮能做的事？</p>`;
  const by = (selector) => root.querySelector(selector);
  const start = by('[data-start]');
  let energy = Number(start.value);
  let visibility = 1;
  let state = 'choosing';
  let runs = [];

  function display(message) {
    by('.lab-metrics').innerHTML = `<span>剩余电量 <strong>${energy}</strong> 格</span><span>下次可照亮 <strong>${visibility}</strong> 个区域</span>`;
    by('.lab-reading').textContent = message;
    for (const button of root.querySelectorAll('[data-route]')) button.disabled = state !== 'choosing';
    by('[data-next]').disabled = state !== 'returned';
  }

  function reset() {
    energy = Number(start.value);
    visibility = 1;
    state = 'choosing';
    runs = [];
    display('你已经拿到零件。先预测哪条路线能带你回基地。');
  }

  function move(route) {
    if (state !== 'choosing') return;
    const safe = route === 'safe';
    const alarm = !safe && Math.random() < 0.5;
    const cost = safe ? 5 : alarm ? 6 : 2;
    const arrived = energy >= cost;
    energy = Math.max(0, energy - cost);
    state = arrived ? 'returned' : 'stranded';
    runs.push({ name: safe ? '主通道' : '维修通道', alarm, cost, arrived, energy });
    display(`${safe ? '主通道' : alarm ? '维修通道触发警报' : '维修通道未触发警报'}，需要 ${cost} 格电。${arrived ? '你带着零件回到基地，可以修灯。' : '出发时的电量不够，未能返回。'}`);
  }

  root.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => move(button.dataset.route)));
  by('[data-next]').addEventListener('click', () => {
    visibility++;
    energy = Number(start.value);
    state = 'choosing';
    display('灯修好了。新一轮能照亮更多区域，又可以带着新的零件选择返程。');
  });
  by('[data-reset]').addEventListener('click', reset);
  start.addEventListener('change', reset);
  reset();
  return { snapshot: () => ({
    parameters: [metric('起始电量（格）', Number(start.value)), metric('维修通道警报概率', '50%')],
    results: runs.length ? [
      metric('返程次数', runs.length),
      metric('返回基地', runs.filter((run) => run.arrived).length),
      metric('下次照亮区域', visibility),
      metric('最近返程记录', runs.slice(-5).map((run) => run.name + '，' + (run.alarm ? '触发警报，' : '') + '耗电要求 ' + run.cost + '，余 ' + run.energy + '，' + (run.arrived ? '成功' : '中断')).join('；'))
    ] : []
  }) };
}

function economyLab(root) {
  root.innerHTML = `<p>站内系统每回合先供电，再用电。先猜现有库存能撑几回合，再调供电和需求，观察短缺何时出现。</p>
    <div class="lab-sliders"><label>初始库存 <output data-read="opening"></output><input type="range" min="0" max="12" value="5" data-value="opening"></label><label>每回合供电 <output data-read="supply"></output><input type="range" min="0" max="8" value="2" data-value="supply"></label><label>每回合需电 <output data-read="demand"></output><input type="range" min="0" max="8" value="3" data-value="demand"></label></div>
    <div class="lab-controls"><button type="button" class="primary-button" data-run>试算六轮供电</button></div>
    <div class="lab-table" data-result hidden><table><caption>六回合库存和短缺</caption><thead><tr><th scope="col">回合</th><th scope="col">期末库存</th><th scope="col">本回合缺口</th></tr></thead><tbody></tbody></table></div><p class="lab-reading" aria-live="polite">设定初始库存、供电和需求，随后试算。</p>
    <p class="lab-question">把需求调高 1 点。补初始库存和提高每回合供电，分别能解决哪个时间尺度的问题？写下你会把哪一种选择交给玩家。</p>`;
  const inputs = [...root.querySelectorAll('[data-value]')];
  let last;
  const settings = () => Object.fromEntries(inputs.map((input) => [input.dataset.value, Number(input.value)]));
  function calculate() {
    const values = settings();
    for (const [key, value] of Object.entries(values)) root.querySelector(`[data-read="${key}"]`).value = value;
    const budget = calculateBudget({ ...values, turns: 6 });
    const scale = Math.max(1, ...budget.map(({ stock }) => stock));
    root.querySelector('tbody').innerHTML = budget.map(({ round, stock, shortage }) => `<tr><th scope="row">${round}</th><td><div class="stock-meter"><span style="--stock:${stock / scale * 100}%"></span><span>${stock}</span></div></td><td class="${shortage ? 'lab-shortage' : ''}">${shortage}</td></tr>`).join('');
    const first = budget.find(({ shortage }) => shortage > 0);
    root.querySelector('.lab-reading').textContent = first ? `第 ${first.round} 回合第一次缺电，缺 ${first.shortage} 点。库存为 0 时仍可能刚好供足当回合。` : '目前六回合内都能满足用电需求。';
    const firstShortage = first ? '第 ' + first.round + ' 回合，缺 ' + first.shortage : '无缺口';
    last = {
      parameters: [metric('初始库存', values.opening), metric('每回合供电', values.supply), metric('每回合需电', values.demand)],
      results: [
        metric('首次缺电', firstShortage),
        metric('各回合期末库存', budget.map((row) => row.stock).join(' → ')),
        metric('各回合用电缺口', budget.map((row) => row.shortage).join(' → '))
      ]
    };
    root.querySelector('[data-result]').hidden = false;
  }
  function showSettings() {
    inputs.forEach((input) => { input.previousElementSibling.value = input.value; });
  }
  for (const input of inputs) input.addEventListener('input', () => {
    showSettings();
    if (last) root.querySelector('.lab-reading').textContent = '表格和可保存数据仍为上一次试算。再次运行可查看新设置。';
  });
  root.querySelector('[data-run]').addEventListener('click', calculate);
  showSettings();
  return { snapshot: () => last ?? { parameters: [], results: [] } };
}

function routeLab(root) {
  const choices = [
    { name: '第一处路口', options: ['通道 A：储藏区', '通道 B：设备走廊', '通道 C：生活区'], answer: 1 },
    { name: '第二处路口', options: ['舱门 A：泵室', '舱门 B：维修间', '舱门 C：控制室'], answer: 2 }
  ];
  root.innerHTML = `<p>任务是到控制室启动装置。先走原版布局，再启用地标版。房间、路线和任务都一样，地标版只增加站内指引。</p>
    <fieldset class="lab-switch"><legend>路口版本</legend><label><input type="radio" name="route-variant" value="plain" checked> 原版</label><label><input type="radio" name="route-variant" value="cue"> 地标版</label></fieldset>
    <div class="route-demo"><h4></h4><div class="lab-controls" data-doors></div></div><p class="lab-reading" role="status"></p>
    <button class="outline-button" type="button" data-reset>从入口重走</button>
    <p class="lab-question">如果你第二次走得更快，记忆也可能帮了忙。想验证地标的效果，可以怎样安排两批第一次来的人？</p>`;
  let current = 0;
  let errors = 0;
  let variant = 'plain';
  let attempts = [];
  const options = root.querySelector('[data-doors]');
  const headline = root.querySelector('h4');
  const status = root.querySelector('.lab-reading');

  function display(message = '') {
    if (current === choices.length) {
      headline.textContent = '到达控制室';
      options.replaceChildren();
      status.textContent = `路线完成，走错 ${errors} 次。`;
      root.querySelector('[data-reset]').focus();
      return;
    }
    const location = choices[current];
    headline.textContent = location.name;
    options.innerHTML = location.options.map((label, index) => {
      const cue = variant === 'cue' && index === location.answer;
      return `<button class="outline-button${cue ? ' lab-cue' : ''}" type="button" data-door="${index}">${label}${cue ? ' · 控制室方向 →' : ''}</button>`;
    }).join('');
    status.textContent = `${message ? `${message} ` : ''}已走错 ${errors} 次。`;
  }

  options.addEventListener('click', (event) => {
    const button = event.target.closest('[data-door]');
    if (!button) return;
    const index = Number(button.dataset.door);
    const location = choices[current];
    const success = index === location.answer;
    attempts.push(location.name + '选' + location.options[index] + '（' + (success ? '走通' : '折返') + '）');
    if (success) current++;
    else errors++;
    display(success ? '沿主路继续。' : '这条路到不了控制室，回到路口。');
    options.querySelector('button')?.focus();
  });
  function reset() { current = 0; errors = 0; attempts = []; display('从入口出发。'); }
  root.querySelectorAll('[name="route-variant"]').forEach((radio) => radio.addEventListener('change', () => { variant = radio.value; reset(); }));
  root.querySelector('[data-reset]').addEventListener('click', reset);
  reset();
  return { snapshot: () => ({
    parameters: [metric('路口指引', variant === 'plain' ? '原版' : '地标版')],
    results: attempts.length ? [
      metric('到达控制室', current === choices.length ? '已到达' : '未到达'),
      metric('走错次数', errors), metric('尝试次数', attempts.length),
      metric('最近路径', attempts.slice(-6).join(' → '))
    ] : []
  }) };
}

function funnelLab(root) {
  root.innerHTML = `<p>这是教学示例数据。两版玩家人数相同，B 版加入了机制线索。先找掉人最多的一步，再切换玩家经验组，看看两组变化是否相近。</p>
    <div class="lab-controls"><label>试玩版本<select data-filter="version"><option value="a">A · 原版</option><option value="b">B · 加线索</option></select></label><label>玩家经验<select data-filter="cohort"><option value="all">所有玩家</option><option value="new">初次接触品类</option><option value="experienced">熟悉品类</option></select></label></div>
    <div class="lab-controls"><button type="button" class="primary-button" data-run>计算这组漏斗</button></div>
    <div class="lab-table" data-result hidden><table><caption>关键步骤漏斗</caption><thead><tr><th scope="col">步骤</th><th scope="col">到达人数</th><th scope="col">占上一环节</th></tr></thead><tbody></tbody></table></div>
    <p class="lab-reading" aria-live="polite"></p><p class="lab-question">选一个最值得回看录像或追问玩家的环节。人数告诉你在哪里看，现场行为和玩家原话帮你分析为什么。</p>`;
  const version = root.querySelector('[data-filter="version"]');
  const cohort = root.querySelector('[data-filter="cohort"]');
  const titles = ['进入关卡', '独立识别线索', '独立用出机制', '独立完成关卡'];
  let last;
  function display() {
    const counts = funnelNumbers(version.value, cohort.value);
    root.querySelector('tbody').innerHTML = counts.map((count, index) => `<tr><th scope="row">${titles[index]}</th><td><div class="stock-meter"><span style="--stock:${count / counts[0] * 100}%"></span><span>${count}</span></div></td><td>${index ? `${count} / ${counts[index - 1]}` : '起始人数'}</td></tr>`).join('');
    const drops = counts.slice(1).map((count, index) => counts[index] - count);
    const largest = Math.max(...drops);
    const transitions = drops.map((count, index) => ({ count, from: counts[index], label: `${titles[index]} → ${titles[index + 1]}` }));
    const byPeople = transitions.filter(({ count }) => count === largest).map(({ label }) => label);
    const byRate = transitions.reduce((best, item) => item.count / item.from > best.count / best.from ? item : best);
    root.querySelector('.lab-reading').textContent = largest ? `按人数看，${byPeople.join('、')}减少最多，各少 ${largest} 人。按各步的上一步人数比较，${byRate.label}减少比例最高，少了 ${byRate.count} / ${byRate.from}。` : '当前组示例中，每个环节都走到了下一步。';
    last = {
      parameters: [metric('试玩版本', version.selectedOptions[0].textContent.trim()), metric('玩家经验', cohort.selectedOptions[0].textContent.trim())],
      results: [
        ...titles.map((title, index) => metric(title, index ? counts[index] + ' / ' + counts[index - 1] : counts[index])),
        metric('最大人数损失', largest ? byPeople.join('、') + '，各少 ' + largest + ' 人' : '无损失'),
        metric('最高掉队比例', largest ? byRate.label + '，' + byRate.count + ' / ' + byRate.from : '无损失')
      ]
    };
    root.querySelector('[data-result]').hidden = false;
  }
  root.querySelector('.lab-reading').textContent = '选择版本和玩家经验，再计算漏斗。';
  root.querySelector('[data-run]').addEventListener('click', display);
  version.addEventListener('change', display);
  cohort.addEventListener('change', display);
  return { snapshot: () => last ?? { parameters: [], results: [] } };
}

export function mountLab(id, root) {
  return labs[id]?.mount(root);
}
