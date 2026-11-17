const metric = (label, value) => ({ label, value });
const esc = (value) => String(value).replace(/[&<>"']/gu, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function metrics(element, values) {
  element.innerHTML = values.map(({ label, value }) => '<span>' + esc(label) + ' <strong>' + esc(value) + '</strong></span>').join('');
}

function tableRows(tbody, rows) {
  tbody.innerHTML = rows.map((cells) => '<tr>' + cells.map((cell, index) => index
    ? '<td>' + esc(cell) + '</td>'
    : '<th scope="row">' + esc(cell) + '</th>').join('') + '</tr>').join('');
}

const managementActions = {
  harvest: { title: '储料', cost: 0, material: 2, capacity: 0, upkeep: 0 },
  expand: { title: '扩充产能', cost: 3, material: 0, capacity: 2, upkeep: 0 },
  repair: { title: '提前维护', cost: 2, material: 0, capacity: 0, upkeep: 2 }
};
const demandProfiles = {
  steady: { title: '稳定订单', demand: [3, 3, 4, 4, 4, 4] },
  spike: { title: '中期急单', demand: [2, 3, 7, 6, 4, 4] }
};
const breakdownRound = 4;

export function runManagement(profile, schedule) {
  let material = 4;
  let capacity = 3;
  let upkeep = 0;
  return demandProfiles[profile].demand.map((demand, index) => {
    const round = index + 1;
    const action = managementActions[schedule[index]];
    const paid = material >= action.cost;
    if (paid) {
      material += action.material - action.cost;
      capacity += action.capacity;
      upkeep += action.upkeep;
    }
    const disrupted = round === breakdownRound && upkeep === 0;
    const available = Math.max(0, capacity - (disrupted ? 3 : 0));
    const serviced = Math.min(available, demand);
    return {
      round, demand, serviced, available, material, disrupted,
      action: paid ? action.title : action.title + '（材料不足，未执行）'
    };
  });
}

function mountManagement(root) {
  let last;
  root.innerHTML = '<p>经营一间维修铺。起始有 4 份材料、每轮产能 3。每轮先执行你安排的一项行动，再服务订单。第 4 轮有停机风险，未提前维护会使该轮产能减少 3。</p>' +
    '<p>储料增加 2 份材料。扩充花 3 份材料，立刻并永久增加 2 产能。提前维护花 2 份材料，可以免除第 4 轮停机。服务订单本身不影响材料。对比急单和稳定订单时，尽量锁住另一个变量。</p>' +
    '<form data-management><div class="lab-controls"><label>订单曲线<select name="profile"><option value="steady">稳定订单</option><option value="spike">中期急单</option></select></label></div>' +
    '<div class="lab-sliders">' + Array.from({ length: 6 }, (_, i) => '<label>第 ' + (i + 1) + ' 轮行动<select name="round' + i + '" required><option value="">请选择</option>' +
      Object.entries(managementActions).map(([key, action]) => '<option value="' + key + '">' + action.title + '</option>').join('') + '</select></label>').join('') +
    '</div><button class="primary-button" type="submit">模拟六轮经营</button></form>' +
    '<div class="lab-metrics" data-metrics aria-live="polite"></div><p class="lab-reading" data-status role="status">计划好六轮，再开始模拟。</p>' +
    '<div class="lab-table" data-table hidden><table><caption>实际经营结果</caption><thead><tr><th scope="col">回合</th><th scope="col">实际行动</th><th scope="col">产能</th><th scope="col">服务／订单</th><th scope="col">剩余材料</th></tr></thead><tbody></tbody></table></div>' +
    '<p class="lab-question">第一份扩建和一次提前维护，你各会放在哪轮？用未满足订单量、停机和库存说明代价。一个总量相同的方案，可能在急单那一轮表现更差。</p>';
  const form = root.querySelector('[data-management]');
  const status = root.querySelector('[data-status]');
  form.addEventListener('input', () => {
    if (last) status.textContent = '表格仍显示上次运行。重新模拟可比较新计划。';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const profile = fields.get('profile');
    const schedule = Array.from({ length: 6 }, (_, i) => fields.get('round' + i));
    if (!schedule.every((action) => Object.hasOwn(managementActions, action))) return;
    const rounds = runManagement(profile, schedule);
    const unmet = rounds.reduce((total, round) => total + round.demand - round.serviced, 0);
    const firstUnmet = rounds.find((round) => round.serviced < round.demand);
    last = {
      parameters: [
        metric('订单曲线', demandProfiles[profile].title),
        metric('各轮计划', schedule.map((action) => managementActions[action].title).join(' → ')),
        metric('订单需求', demandProfiles[profile].demand.join('／'))
      ],
      results: [
        metric('未满足订单', unmet),
        metric('首次出现缺口', firstUnmet ? '第 ' + firstUnmet.round + ' 轮' : '无'),
        metric('第 4 轮停机', rounds[3].disrupted ? '是' : '否'),
        metric('期末材料', rounds.at(-1).material),
        metric('各轮实际服务', rounds.map((round) => round.serviced + '/' + round.demand).join(' → '))
      ]
    };
    metrics(root.querySelector('[data-metrics]'), last.results.slice(0, 4));
    tableRows(root.querySelector('tbody'), rounds.map((round) => [
      round.round, round.action, round.available, round.serviced + '／' + round.demand, round.material
    ]));
    root.querySelector('[data-table]').hidden = false;
    status.textContent = '六轮执行结束。结果按当时的计划保留。';
  });
  return { snapshot: () => last ?? { parameters: [], results: [] } };
}

const toolNames = { scanner: '扫描器', cutter: '切割器', tank: '气囊' };
const caveActionNames = { scan: '扫描岩层', cut: '切开矿壁', wade: '涉过水道', surface: '返回地面' };

export function startCave(tools, battery) {
  return { tools, battery, scanned: false, ore: 0, log: [], status: '探查中', finished: false };
}

export function caveAction(state, action) {
  if (state.finished) return state;
  const has = (tool) => state.tools.includes(tool);
  let cost;
  let result;
  let patch = {};
  if (action === 'scan') {
    if (!has('scanner') || state.scanned) return state;
    cost = 1;
    result = has('cutter') ? '找到了富矿脉的薄弱处' : '找到一块露在外面的矿石';
    patch = { scanned: true, ore: state.ore + (has('cutter') ? 0 : 1) };
  } else if (action === 'cut') {
    if (!has('cutter') || state.log.some((row) => row.action === 'cut')) return state;
    cost = state.scanned ? 2 : 4;
    const yieldCount = state.scanned ? 4 : 3;
    result = '获得 ' + yieldCount + ' 块矿石';
    patch = { ore: state.ore + yieldCount };
  } else if (action === 'wade') {
    if (state.log.some((row) => row.action === 'wade')) return state;
    cost = has('tank') ? 1 : 3;
    result = '在水道捡到 2 块矿石';
    patch = { ore: state.ore + 2 };
  } else if (action === 'surface') {
    cost = has('tank') ? 1 : 2;
    result = '带矿石返程';
    patch = { finished: true, status: '成功返回' };
  } else return state;

  const charged = Math.min(state.battery, cost);
  const battery = state.battery - charged;
  if (charged < cost) {
    result = '电量不足，行动中断，未撤离';
    patch = { finished: true, status: '搁浅' };
  }
  return { ...state, ...patch, battery, log: [...state.log, { action, cost, charged, battery, result }] };
}

function mountSandbox(root) {
  let state;
  let initialBattery;
  root.innerHTML = '<p>下洞采集再返回。选两件工具。直接切割耗 4 电，得到 3 块矿石。先花 1 电扫描，切割改为耗 2 电并得到 4 块；没带切割器则通过扫描找到 1 块。水道可采 2 块，耗 3 电，有气囊只耗 1 电。返程耗 2 电，有气囊只耗 1 电。电量不足时会搁浅。</p>' +
    '<form data-expedition><fieldset class="lab-switch"><legend>装备两件工具</legend>' +
      Object.entries(toolNames).map(([key, label]) => '<label><input type="checkbox" name="tools" value="' + key + '"> ' + label + '</label>').join('') +
    '</fieldset><div class="lab-controls"><label>出发电量<select name="battery"><option value="5">5 格</option><option value="6">6 格</option><option value="8">8 格</option></select></label><button class="primary-button" type="submit">按当前装备出发</button></div></form>' +
    '<p class="lab-reading" data-status role="status">先选两件装备，再出发。出发后可以决定行动顺序。</p>' +
    '<fieldset class="lab-switch" data-cave-controls disabled><legend>洞中行动</legend><div class="lab-controls">' +
      Object.entries(caveActionNames).map(([action, name]) => '<button class="outline-button" type="button" data-cave-action="' + action + '">' + name + '</button>').join('') +
    '</div></fieldset><div class="lab-metrics" data-metrics aria-live="polite"></div>' +
    '<div class="lab-table" data-table hidden><table><caption>本次探查</caption><thead><tr><th scope="col">行动</th><th scope="col">计划耗电</th><th scope="col">实耗电量</th><th scope="col">余电</th><th scope="col">结果</th></tr></thead><tbody></tbody></table></div>' +
    '<p class="lab-question">有的工具降低单项成本，有的改变组合空间。试着找一个「看起来收获更多、最后带不回来」的选择。设计者希望玩家事先看清哪条规则？</p>';
  const form = root.querySelector('[data-expedition]');
  const status = root.querySelector('[data-status]');
  const controls = root.querySelector('[data-cave-controls]');
  const actions = [...root.querySelectorAll('[data-cave-action]')];
  function display() {
    controls.disabled = state.finished;
    actions.forEach((button) => {
      const kind = button.dataset.caveAction;
      const used = state.log.some((entry) => entry.action === kind);
      button.disabled = used || (kind === 'scan' && !state.tools.includes('scanner')) || (kind === 'cut' && !state.tools.includes('cutter'));
    });
    metrics(root.querySelector('[data-metrics]'), [metric('余电', state.battery), metric('手中矿石', state.ore), metric('状态', state.status)]);
    root.querySelector('[data-table]').hidden = state.log.length === 0;
    tableRows(root.querySelector('tbody'), state.log.map(({ action, cost, charged, battery, result }) => [caveActionNames[action], cost, charged, battery, result]));
    status.textContent = state.log.at(-1)?.result ?? '已出发。先想清楚用电和掉头的条件。';
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const tools = fields.getAll('tools');
    if (tools.length !== 2) {
      status.textContent = '需要选择两件工具。当前探查结果未改变。';
      return;
    }
    initialBattery = Number(fields.get('battery'));
    state = startCave(tools, initialBattery);
    display();
  });
  actions.forEach((button) => button.addEventListener('click', () => {
    state = caveAction(state, button.dataset.caveAction);
    display();
  }));
  return { snapshot: () => state ? {
    parameters: [metric('工具', state.tools.map((tool) => toolNames[tool]).join('、')), metric('起始电量', initialBattery)],
    results: state.log.length ? [
      metric('行动顺序', state.log.map((row) => caveActionNames[row.action]).join(' → ')),
      metric('状态', state.status),
      metric('返程带回', state.status === '成功返回' ? state.ore : state.finished ? 0 : '仍在洞中'),
      metric('余电', state.battery),
      metric('逐步结果', state.log.map((row) => caveActionNames[row.action] + '：' + row.result + '（余电 ' + row.battery + '）').join('；'))
    ] : []
  } : { parameters: [], results: [] } };
}

const rewards = [
  { title: '锋刃', stat: 'attack', amount: 2 }, { title: '大锋刃', stat: 'attack', amount: 3 },
  { title: '甲片', stat: 'guard', amount: 1 }, { title: '重甲片', stat: 'guard', amount: 2 },
  { title: '补给', stat: 'heal', amount: 4 }, { title: '大补给', stat: 'heal', amount: 6 }
];
const strategyNames = { offence: '优先攻击', defence: '优先生存', balance: '按状态调整' };

function takeRewardOffer(next) {
  const pool = [...rewards];
  return Array.from({ length: 3 }, () => pool.splice(next(pool.length), 1)[0]);
}

export function createRogueRooms(seed) {
  let value = seed >>> 0;
  function next(max) {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return Math.floor((value / 4294967296) * max);
  }
  return Array.from({ length: 5 }, (_, index) => ({
    pressure: 5 + index + next(5), swarm: next(2) === 0, offer: takeRewardOffer(next)
  }));
}

function rewardPriority(strategy, hp) {
  if (strategy === 'balance') return hp <= 7 ? ['heal', 'guard', 'attack'] : ['attack', 'guard', 'heal'];
  if (strategy === 'offence') return ['attack', 'guard', 'heal'];
  return ['guard', 'heal', 'attack'];
}

export function runRogue(rooms, strategy) {
  let hp = 17;
  let attack = 3;
  let guard = 0;
  const log = [];
  for (const [index, { pressure, swarm, offer }] of rooms.entries()) {
    const reduction = swarm ? Math.floor(attack / 2) + guard * 2 : attack + guard;
    const damage = Math.max(1, pressure - reduction);
    hp = Math.max(0, hp - damage);
    if (!hp) {
      log.push({ room: index + 1, damage, reward: '撤退', hp });
      break;
    }
    const priority = rewardPriority(strategy, hp);
    const reward = [...offer].sort((a, b) => priority.indexOf(a.stat) - priority.indexOf(b.stat) || b.amount - a.amount)[0];
    if (reward.stat === 'attack') attack += reward.amount;
    else if (reward.stat === 'guard') guard += reward.amount;
    else hp = Math.min(17, hp + reward.amount);
    log.push({ room: index + 1, damage, reward: reward.title, hp });
  }
  return { hp, rooms: log.filter((row) => row.hp > 0).length, attack, guard, log };
}

function mountRogue(root) {
  let last;
  const options = Object.entries(strategyNames).map(([id, title]) => '<option value="' + id + '">' + title + '</option>').join('');
  root.innerHTML = '<p>种子决定五间房的压力、房型和奖励候选。两套策略读取同一份候选。初始生命 17、攻击 3、护甲 0。每房按压力扣血，最低失血 1，存活后领一项奖励。单一敌人的房间按攻击和护甲各减一次压力。群袭房的攻击只抵掉一半（向下取整），护甲的减压翻倍。</p>' +
    '<div class="lab-sliders"><form data-rogue><div class="lab-controls"><label>种子<input type="number" name="seed" value="17" min="0" max="99999" step="1" required></label><label>策略 A<select name="a">' + options + '</select></label><label>策略 B<select name="b">' + options + '</select></label><button class="primary-button" type="submit">在同一种子上试跑</button></div></form></div>' +
    '<p class="lab-reading" data-status role="status">可先挑一对策略，再尝试预判前后房间的生命差异。</p><div class="lab-metrics" data-metrics aria-live="polite"></div>' +
    '<div class="lab-table" data-table hidden><table><caption>两套策略面对的五间房</caption><thead><tr><th scope="col">房间</th><th scope="col">压力</th><th scope="col">共同候选</th><th scope="col">策略 A</th><th scope="col">策略 B</th></tr></thead><tbody></tbody></table></div>' +
    '<p class="lab-question">某一种子输赢可能来自发牌顺序。只保留策略差异，再换种子验证。对照哪项关键奖励发生在失败之前，而不是只看最后剩多少生命。</p>';
  const form = root.querySelector('[data-rogue]');
  form.elements.b.value = 'defence';
  const status = root.querySelector('[data-status]');
  form.addEventListener('input', () => {
    if (last) status.textContent = '表格仍显示上次试跑。再次运行可比较新的设定。';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const seed = Number(fields.get('seed'));
    const firstStrategy = fields.get('a');
    const secondStrategy = fields.get('b');
    const rooms = createRogueRooms(seed);
    const a = runRogue(rooms, firstStrategy);
    const b = runRogue(rooms, secondStrategy);
    const cell = (row) => row ? '失血 ' + row.damage + '，' + row.reward + '，余 ' + row.hp : '未到达';
    last = {
      parameters: [
        metric('种子', seed), metric('策略 A', strategyNames[firstStrategy]), metric('策略 B', strategyNames[secondStrategy]),
        metric('共同候选', rooms.map((room, index) => '第 ' + (index + 1) + ' 房 ' + room.offer.map((item) => item.title).join('／')).join('；'))
      ],
      results: [
        metric('A 通关房数', a.rooms), metric('B 通关房数', b.rooms), metric('A 剩余生命', a.hp), metric('B 剩余生命', b.hp),
        metric('A 逐房结果', rooms.map((_, index) => cell(a.log[index])).join(' → ')),
        metric('B 逐房结果', rooms.map((_, index) => cell(b.log[index])).join(' → '))
      ]
    };
    tableRows(root.querySelector('tbody'), rooms.map(({ pressure, swarm, offer }, index) => [
      index + 1, (swarm ? '群袭' : '单敌') + ' ' + pressure, offer.map((item) => item.title).join('、'), cell(a.log[index]), cell(b.log[index])
    ]));
    root.querySelector('[data-table]').hidden = false;
    metrics(root.querySelector('[data-metrics]'), last.results.slice(0, 4));
    status.textContent = firstStrategy === secondStrategy ? '同一策略两次得到相同结果，可以改一侧作为对照。' : '两套策略的候选顺序相同，差异只来自取舍。';
  });
  return { snapshot: () => last ?? { parameters: [], results: [] } };
}

const controls = ['左阀', '中阀', '右阀'];
const signals = ['△', '○', '□'];
const mappingPlans = {
  alpha: [
    { target: 2, mapping: [1, 2, 0] }, { target: 0, mapping: [2, 0, 1] }, { target: 1, mapping: [2, 1, 0] }
  ],
  beta: [
    { target: 1, mapping: [1, 0, 2] }, { target: 2, mapping: [2, 1, 0] }, { target: 0, mapping: [0, 2, 1] }
  ]
};
const modeNames = { split: '信息分开', shared: '双方共享' };
const playNames = { solo: '单人轮换练规则', pair: '双人同机' };
const planNames = { alpha: '管线甲', beta: '管线乙' };

export function judgeCoopAction(round, control) {
  return { pass: round.mapping[control] === round.target, correctControl: round.mapping.indexOf(round.target) };
}

function mountCoop(root) {
  let config;
  let phase;
  let message;
  let results = [];
  root.innerHTML = '<p>修好三段管线。观察员知道目标符号，操作员用换算表寻找阀门。信息分开时，请轮流看屏，另一位背对屏幕。每轮由观察员交给操作员一条消息。双人模式可观察沟通失误，单人轮换适合检查规则。</p>' +
    '<form data-coop-start><div class="lab-controls"><label>参与方式<select name="play"><option value="solo">单人轮换练规则</option><option value="pair">双人同机</option></select></label>' +
    '<label>信息条件<select name="mode"><option value="split">信息分开</option><option value="shared">双方共享</option></select></label><label>管线<select name="plan"><option value="alpha">管线甲</option><option value="beta">管线乙</option></select></label>' +
    '<button class="primary-button" type="submit">开始新一组</button></div></form><div data-private></div><p class="lab-reading" data-status role="status">选择参与方式和信息条件，开始后按提示交接。</p>' +
    '<div class="lab-metrics" data-metrics aria-live="polite"></div>' +
    '<p class="lab-question">观察员发对符号，操作员仍开错，可能是读表问题。观察员没法传递所需信息，可能是交流规则问题。比较两种信息条件时，单人熟悉顺序与双人协作能力需要分开记录。</p>';
  const start = root.querySelector('[data-coop-start]');
  const pane = root.querySelector('[data-private]');
  const status = root.querySelector('[data-status]');
  const counts = root.querySelector('[data-metrics]');
  const options = (entries) => entries.map(([id, text]) => '<option value="' + id + '">' + esc(text) + '</option>').join('');
  const routing = (round) => controls.map((control, index) => control + ' → ' + signals[round.mapping[index]]).join('　');

  function render() {
    const round = mappingPlans[config.plan][results.length];
    const step = results.length + 1;
    if (phase === 'finished') {
      pane.replaceChildren();
      status.textContent = '已完成三轮。先记下哪种失误最值得下一次观察。';
      start.querySelector('button').focus();
    } else if (phase === 'scout-pass' || phase === 'operator-pass') {
      const role = phase === 'scout-pass' ? '观察员' : '操作员';
      pane.innerHTML = '<p>第 ' + step + ' 轮。当前屏幕没有私人信息。请把设备交给' + role + '。</p><button class="outline-button" type="button" data-show>我是' + role + '，显示我的线索</button>';
      status.textContent = '交接完成后再揭晓。';
      pane.querySelector('button').focus();
    } else if (phase === 'scout') {
      pane.innerHTML = '<p><strong>仅观察员查看</strong>　目标信号为 ' + signals[round.target] + '。' +
        (config.mode === 'shared' ? ' 共享换算表：' + routing(round) + '。' : ' 操作员有阀门换算表。') +
        '</p><form data-private-submit class="lab-controls"><label>给操作员的消息<select required name="message"><option value="">选择一条消息</option>' +
        options([...signals.map((signal) => [signal, '信号 ' + signal]), ...controls.map((control) => [control, control])]) +
        '</select></label><button class="outline-button" type="submit">隐藏线索并交给操作员</button></form>';
      pane.querySelector('select').focus();
    } else {
      pane.innerHTML = '<p><strong>仅操作员查看</strong>　收到的消息：' + esc(message) + '。换算表：' + routing(round) + '。' +
        (config.mode === 'shared' ? ' 共享目标信号：' + signals[round.target] + '。' : '') +
        '</p><form data-private-submit class="lab-controls"><label>开启哪一个阀门<select required name="control"><option value="">选择阀门</option>' +
        options(controls.map((control, index) => [index, control])) +
        '</select></label><button class="primary-button" type="submit">执行并记录结果</button></form>';
      pane.querySelector('select').focus();
    }
  }
  start.addEventListener('submit', (event) => {
    event.preventDefault();
    config = Object.fromEntries(new FormData(start));
    phase = 'scout-pass';
    message = '';
    results = [];
    counts.replaceChildren();
    render();
  });
  pane.addEventListener('click', (event) => {
    if (!event.target.closest('[data-show]')) return;
    phase = phase === 'scout-pass' ? 'scout' : 'operator';
    render();
  });
  pane.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(event.target);
    if (phase === 'scout') {
      message = fields.get('message');
      phase = 'operator-pass';
      render();
      return;
    }
    const control = Number(fields.get('control'));
    const round = mappingPlans[config.plan][results.length];
    const outcome = judgeCoopAction(round, control);
    results.push({ pass: outcome.pass, evidence: '目标 ' + signals[round.target] + '，消息 ' + message + '，操作 ' + controls[control] + '，应开 ' + controls[outcome.correctControl] });
    phase = results.length === 3 ? 'finished' : 'scout-pass';
    metrics(counts, [
      metric('正确', results.filter((item) => item.pass).length + '／' + results.length),
      metric('刚才一轮', results.at(-1).evidence)
    ]);
    render();
  });
  return { snapshot: () => config ? {
    parameters: [metric('参与方式', playNames[config.play]), metric('信息条件', modeNames[config.mode]), metric('管线路线', planNames[config.plan])],
    results: results.length ? [
      metric('正确轮数', results.filter((item) => item.pass).length + '／' + results.length),
      metric('未完成轮数', 3 - results.length),
      metric('逐轮证据', results.map((item, index) => '第 ' + (index + 1) + ' 轮 ' + item.evidence).join('；'))
    ] : []
  } : { parameters: [], results: [] } };
}

export const lateGenreLabs = {
  'genre-management': { title: '六轮维修铺：扩产还是先维护', mount: mountManagement },
  'genre-sandbox': { title: '带哪两件工具下洞', mount: mountSandbox },
  'genre-rogue': { title: '同一种子下比较两套奖励策略', mount: mountRogue },
  'genre-coop': { title: '两人交接：谁知道哪条信息', mount: mountCoop }
};
