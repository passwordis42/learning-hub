const readout = (label, value) => ({ label, value });

const jumpSamples = {
  beginner: {
    label: '新手节奏',
    trials: [[-20, true], [15, true], [35, true], [65, true], [45, false], [95, false]],
  },
  practiced: {
    label: '熟练节奏',
    trials: [[-30, true], [-10, true], [10, true], [30, true], [35, false], [80, false]],
  },
};

export function compareJumpWindows(trials, first, second) {
  const outcomes = (delay, intended, grace) => {
    if (delay <= grace) return intended ? '按意图跳出' : '意外起跳';
    return intended ? '想跳却落空' : '按意图离台';
  };
  const rows = trials.map(([delay, intended]) => ({
    delay, intended, a: outcomes(delay, intended, first), b: outcomes(delay, intended, second),
  }));
  const summarize = (key) => ({
    expected: rows.filter((row) => row[key] === '按意图跳出').length,
    missed: rows.filter((row) => row[key] === '想跳却落空').length,
    unexpected: rows.filter((row) => row[key] === '意外起跳').length,
  });
  return { rows, a: summarize('a'), b: summarize('b') };
}

function mountPlatform(root) {
  root.innerHTML = `<p>同一组按键时点分别送进两套跳跃容错。离开地面为 0 ms。记录有的来自想过沟的玩家，有的来自刻意走向下层、却在离台后误按的人。比较成功和误跳，就能看到提高容错的收益与代价。</p>
    <div class="lab-controls">
      <label>固定样本<select data-trials><option value="beginner">新手节奏</option><option value="practiced">熟练节奏</option></select></label>
      <label>A 版容错 <output data-a-label>25 ms</output><input data-a type="range" min="0" max="120" step="5" value="25"></label>
      <label>B 版容错 <output data-b-label>70 ms</output><input data-b type="range" min="0" max="120" step="5" value="70"></label>
    </div>
    <button type="button" class="primary-button" data-run>回放同一组输入</button>
    <p class="lab-reading" role="status">先预测哪个版本会减少落空，又在哪种输入下可能误跳。</p>
    <div data-trial-table class="lab-table"></div>
    <p class="lab-question">保留同一组输入，微调 B 版。能否减少落空并保持误跳数？你会用这个数值训练谁，又会为哪类玩家保留较短窗口？</p>`;
  const select = root.querySelector('[data-trials]');
  const first = root.querySelector('[data-a]');
  const second = root.querySelector('[data-b]');
  const status = root.querySelector('.lab-reading');
  let captured;
  const parameters = () => [
    readout('固定输入样本', jumpSamples[select.value].label),
    readout('A 版容错（ms）', Number(first.value)),
    readout('B 版容错（ms）', Number(second.value)),
  ];
  for (const [input, output] of [[first, '[data-a-label]'], [second, '[data-b-label]']]) {
    input.addEventListener('input', () => {
      root.querySelector(output).value = `${input.value} ms`;
      if (captured) status.textContent = '显示的是上一次回放。重新回放可测量当前设置。';
    });
  }
  select.addEventListener('change', () => {
    if (captured) status.textContent = '显示的是上一次回放。重新回放可测量当前样本。';
  });
  const summary = ({ expected, missed, unexpected }) => `按意图跳出 ${expected}，想跳却落空 ${missed}，意外起跳 ${unexpected}`;
  root.querySelector('[data-run]').addEventListener('click', () => {
    const { rows, a, b } = compareJumpWindows(jumpSamples[select.value].trials, Number(first.value), Number(second.value));
    const results = [readout('A 版结果', summary(a)), readout('B 版结果', summary(b)),
      readout('两版结果不同的输入时点', rows.filter((row) => row.a !== row.b).map((row) => `${row.delay} ms`).join('、') || '无')];
    captured = { parameters: parameters(), results };
    status.textContent = `A 版：${summary(a)}。B 版：${summary(b)}。`;
    root.querySelector('[data-trial-table]').innerHTML = `<table><caption>同一输入的结果对照</caption><thead><tr><th scope="col">输入（ms）</th><th scope="col">意图</th><th scope="col">A 版</th><th scope="col">B 版</th></tr></thead><tbody>${rows.map(({ delay, intended, a, b }) => `<tr><th scope="row">${delay}</th><td>${intended ? '过沟' : '离台去下层'}</td><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>`;
  });
  return { snapshot: () => captured ?? { parameters: parameters(), results: [] } };
}

const arena = {
  width: 7,
  height: 5,
  beacons: [[1, 4], [2, 0], [4, 4], [6, 0]],
  shields: { a: [[1, 1], [6, 1]], b: [[2, 3], [6, 1]] },
  routes: {
    upper: { label: '上方绕行', row: 1 },
    middle: { label: '中间直走', row: 2 },
    lower: { label: '下方绕行', row: 3 },
  },
};

function cellKey(x, y) {
  return `${x},${y}`;
}

export function analyzeLightRoute(layout, route) {
  const row = arena.routes[route].row;
  const horizontal = Array.from({ length: arena.width }, (_, x) => [x, row]);
  const path = row === 2 ? horizontal : [[0, 2], ...horizontal, [6, 2]];
  const shields = new Set(arena.shields[layout].map(([x, y]) => cellKey(x, y)));
  const cells = path.map(([x, y]) => {
    const visible = arena.beacons.filter(([bx, by]) => {
      if (x !== bx && y !== by) return false;
      const dx = Math.sign(x - bx);
      const dy = Math.sign(y - by);
      for (let i = 1; i <= Math.max(Math.abs(x - bx), Math.abs(y - by)); i++) {
        if (shields.has(cellKey(bx + dx * i, by + dy * i))) return false;
      }
      return true;
    }).length;
    return { x, y, visible };
  });
  return { cells, exposed: cells.filter(({ visible }) => visible > 0).length, turns: cells.length - 1 };
}

function renderLightBoard(layout, result) {
  const beacons = new Set(arena.beacons.map(([x, y]) => cellKey(x, y)));
  const shields = new Set(arena.shields[layout].map(([x, y]) => cellKey(x, y)));
  const path = new Map(result?.cells.map((cell) => [cellKey(cell.x, cell.y), cell.visible]) ?? []);
  const rows = Array.from({ length: arena.height }, (_, y) => {
    const cells = Array.from({ length: arena.width }, (_, x) => {
      const cell = cellKey(x, y);
      const terrain = [beacons.has(cell) ? '灯塔' : '', shields.has(cell) ? '屏蔽格' : '',
        cell === '0,2' ? '起点' : '', cell === '6,2' ? '终点' : ''].filter(Boolean);
      const flow = path.has(cell) ? (path.get(cell) ? '亮灯' : '通过') : '';
      return `<td>${[...terrain, flow].filter(Boolean).join(' · ') || '—'}</td>`;
    });
    return `<tr><th scope="row">${y + 1}</th>${cells.join('')}</tr>`;
  });
  return `<table><caption>布局 ${layout.toUpperCase()} · 光标路线图</caption><thead><tr><th scope="col">行／列</th>${Array.from({ length: arena.width }, (_, x) => `<th scope="col">${x + 1}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function mountShooter(root) {
  root.innerHTML = `<p>这是一个虚构的光标夺旗灰盒。四个灯塔只照同一行或列，屏蔽格只断光，三条路线始终可通行。B 相对 A 只移动一格屏蔽物。经过能看到灯塔的位置会亮一次，多个灯塔照到同一格也只算一次。</p>
    <div class="lab-controls">
      <label>路线<select data-route><option value="upper">上方绕行</option><option value="middle">中间直走</option><option value="lower">下方绕行</option></select></label>
      <label>当前查看的地图<select data-layout><option value="a">布局 A</option><option value="b">布局 B</option></select></label>
      <label>允许亮灯格数<select data-budget><option value="1">1 格</option><option value="2" selected>2 格</option><option value="3">3 格</option><option value="4">4 格</option></select></label>
    </div>
    <button type="button" class="primary-button" data-run>用相同路线走两张地图</button>
    <p class="lab-reading" role="status">先选一条路线，预测移动屏蔽物是否会改变到达条件。</p>
    <div class="lab-table" data-arena></div>
    <p class="lab-question">换一条路线，用相同的亮灯上限再试。比较亮灯格数与行动步数。你会把提高可读性或改变走位作为下一版目标？</p>`;
  const route = root.querySelector('[data-route]');
  const layout = root.querySelector('[data-layout]');
  const budget = root.querySelector('[data-budget]');
  const status = root.querySelector('.lab-reading');
  const board = root.querySelector('[data-arena]');
  let captured;
  let runs;
  const parameters = () => [readout('固定路线', arena.routes[route.value].label), readout('允许亮灯格数', Number(budget.value)),
    readout('唯一改动', '布局 B 移动一个屏蔽格，灯塔、起终点和路线规则保持一致')];
  const draw = () => { board.innerHTML = renderLightBoard(layout.value, runs?.[layout.value]); };
  layout.addEventListener('change', draw);
  for (const control of [route, budget]) {
    control.addEventListener('change', () => {
      if (captured) status.textContent = '地图显示的是上一次路线。重新试走可测量当前设置。';
    });
  }
  root.querySelector('[data-run]').addEventListener('click', () => {
    runs = { a: analyzeLightRoute('a', route.value), b: analyzeLightRoute('b', route.value) };
    const limit = Number(budget.value);
    const summarize = ({ exposed, turns }) => `${turns} 步，亮灯 ${exposed} 格，${exposed <= limit ? '符合限制' : '超出限制'}`;
    captured = {
      parameters: parameters(),
      results: [
        readout('布局 A', summarize(runs.a)), readout('布局 B', summarize(runs.b)),
        readout('亮灯数变化（B − A）', runs.b.exposed - runs.a.exposed),
      ],
    };
    status.textContent = `布局 A：${summarize(runs.a)}。布局 B：${summarize(runs.b)}。地图里的「亮灯」标出路线上的具体差异。`;
    draw();
  });
  draw();
  return { snapshot: () => captured ?? { parameters: parameters(), results: [] } };
}

const puzzleMaps = {
  left: [{ name: '星形', marks: 3 }, { name: '圆形', marks: 1 }, { name: '方形', marks: 2 }],
  right: [{ name: '圆形', marks: 2 }, { name: '方形', marks: 1 }, { name: '星形', marks: 3 }],
};
const puzzleEditions = { a: '只显示刻痕关系', b: '加上读取方向' };
const puzzleMapLabels = { left: '星、圆、方排列', right: '圆、方、星排列' };

export function checkPuzzleAttempt(layout, attempted) {
  const order = [...puzzleMaps[layout]].sort((a, b) => a.marks - b.marks).map(({ name }) => name);
  const mismatch = order.findIndex((name, index) => name !== attempted[index]);
  const success = attempted.length === order.length && mismatch < 0;
  return { success, firstMismatch: success ? 0 : (mismatch < 0 ? order.length + 1 : mismatch + 1) };
}

function mountPuzzle(root) {
  root.innerHTML = `<p>一扇石门要按下三块面板。你要比较同一道谜题的两种提示版本。每次换版本或排列会清空当前试走。记住答案后，可以换另一种排列，用新面板验证你是否掌握了读取规则。</p>
    <div class="lab-controls">
      <label>刻痕提示<select data-edition><option value="a">A · 只显示刻痕关系</option><option value="b">B · 加上读取方向</option></select></label>
      <label>面板排列<select data-puzzle-map><option value="left">排列一</option><option value="right">排列二</option></select></label>
    </div>
    <div class="lab-reading" data-clue></div>
    <div class="lab-controls" data-panel-buttons></div>
    <p data-sequence aria-live="polite"></p>
    <div class="lab-controls"><button type="button" class="primary-button" data-try disabled>验证这个顺序</button><button type="button" class="outline-button" data-clear>清空输入</button><button type="button" class="outline-button" data-hint>请求一层提示</button></div>
    <p class="lab-reading" data-message role="status">先预测你可能会在哪里误读提示，再试着按面板。</p>
    <ol data-attempts aria-label="尝试记录"></ol>
    <p class="lab-question">同一版本里，你第一次错误是由错误方向、按摆放顺序，还是其他解释造成的？改提示版本后，哪些反馈让你能区分这几种情况？</p>`;
  const edition = root.querySelector('[data-edition]');
  const layout = root.querySelector('[data-puzzle-map]');
  const buttons = root.querySelector('[data-panel-buttons]');
  const message = root.querySelector('[data-message]');
  const sequence = root.querySelector('[data-sequence]');
  const attemptButton = root.querySelector('[data-try]');
  const hintButton = root.querySelector('[data-hint]');
  const attemptList = root.querySelector('[data-attempts]');
  let current = [];
  let attempts = [];
  let hints = 0;
  const parameters = () => [
    readout('当前版本', puzzleEditions[edition.value]),
    readout('当前布置', puzzleMapLabels[layout.value]),
    readout('请求提示次数', hints),
  ];
  function displayInput() {
    sequence.textContent = current.length ? `已按：${current.join(' → ')}` : '尚未按下面板';
    attemptButton.disabled = current.length !== 3;
    for (const button of buttons.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(current.includes(button.dataset.shape)));
    }
  }
  function reset() {
    current = [];
    attempts = [];
    hints = 0;
    hintButton.disabled = false;
    attemptList.replaceChildren();
    root.querySelector('[data-clue]').textContent = edition.value === 'b'
      ? '石碑上的三组刻痕围成一圈，箭头从一道刻痕指向三道刻痕。'
      : '石碑上的三组刻痕围成一圈，箭头已经磨损。';
    buttons.innerHTML = puzzleMaps[layout.value].map(({ name, marks }) => `<button type="button" class="outline-button" data-shape="${name}">${name}（${marks} 道刻痕）</button>`).join('');
    message.textContent = '先比较石碑和三块面板，再验证你的顺序。';
    displayInput();
  }
  buttons.addEventListener('click', (event) => {
    const name = event.target.closest('[data-shape]')?.dataset.shape;
    if (!name) return;
    current = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    displayInput();
  });
  root.querySelector('[data-clear]').addEventListener('click', () => { current = []; displayInput(); });
  hintButton.addEventListener('click', () => {
    hints++;
    hintButton.disabled = true;
    message.textContent = '提示：先找到刻痕最少的面板。颜色、亮度和摆放位置都不会改变顺序。';
  });
  attemptButton.addEventListener('click', () => {
    const verdict = checkPuzzleAttempt(layout.value, current);
    const item = `${current.join(' → ')}：${verdict.success ? '石门打开' : `第 ${verdict.firstMismatch} 步起与读取规则不符`}${hints ? '（已看提示）' : ''}`;
    attempts.push({ item, success: verdict.success, assisted: hints > 0 });
    const row = document.createElement('li');
    row.textContent = item;
    attemptList.append(row);
    message.textContent = item;
    current = [];
    displayInput();
  });
  edition.addEventListener('change', reset);
  layout.addEventListener('change', reset);
  reset();
  return { snapshot: () => ({
    parameters: parameters(),
    results: attempts.length ? [
      readout('验证次数', attempts.length),
      readout('未用提示解开', attempts.filter(({ success, assisted }) => success && !assisted).length),
      readout('最近的尝试', attempts.slice(-4).map(({ item }) => item).join('；')),
    ] : [],
  }) };
}

const rpgBuilds = {
  tech: { label: '技术员', repair: 2, bypass: 3, rescue: 1 },
  scout: { label: '侦察员', repair: 4, bypass: 1, rescue: 3 },
};
const questPlans = { records: '带回档案', rescue: '带回档案且启动救援灯' };

export function makeQuestState(stamina) {
  return { stamina, zone: '入口', route: '', records: false, rescue: false, done: false, moves: 0 };
}

export function applyQuestAction(state, build, action) {
  const next = { ...state, moves: state.moves + 1 };
  const no = (message) => ({ state: next, message });
  const apply = (cost, patch, message) => state.stamina >= cost
    ? { state: { ...next, stamina: state.stamina - cost, ...patch }, message: `${message}，消耗 ${cost} 点。` }
    : no(`需要 ${cost} 点体力，当前不足。`);
  if (state.done) return { state, message: '本轮已返程。' };
  if (action === 'repair' || action === 'bypass') {
    if (state.zone !== '入口') return no('本轮已经从入口进站。');
    const route = action === 'repair' ? '修门' : '侧廊';
    return apply(build[action], { zone: '档案室', route }, `经${route}到达档案室`);
  }
  if (state.zone !== '档案室') return no('需要先进入档案室。');
  if (action === 'retrieve') return state.records
    ? no('档案已经取到。')
    : apply(1, { records: true }, '取到档案');
  if (action === 'rescue') return state.rescue
    ? no('救援灯已经启动。')
    : apply(build.rescue, { rescue: true }, '启动救援灯');
  if (action === 'return') return state.records
    ? apply(1, { zone: '出口', done: true }, '带着档案撤离')
    : no('返程门需要档案钥匙，先取档案。');
  return { state, message: '这一步没有发生。' };
}

function mountRpg(root) {
  root.innerHTML = `<p>两种构筑有同一个主任务：进站、取档案、带回出口。你可以把启动救援灯加入本轮目标。档案和返程各消耗 1 点，进站和救援的消耗取决于能力。手动选择动作，检查你留下的体力能不能满足自己定的目标。</p>
    <div class="lab-controls">
      <label>角色构筑<select data-build><option value="tech">技术员</option><option value="scout">侦察员</option></select></label>
      <label>初始体力<select data-stamina><option value="4">4 点</option><option value="5" selected>5 点</option><option value="6">6 点</option><option value="7">7 点</option></select></label>
      <label>本轮目标<select data-quest><option value="records">带回档案</option><option value="rescue">带回档案且启动救援灯</option></select></label>
      <button type="button" class="primary-button" data-start>开始这轮构筑</button>
    </div>
    <p data-cost></p>
    <div class="lab-metrics" data-state aria-live="polite"></div>
    <fieldset class="lab-switch" data-actions disabled><legend>档案站行动</legend><div class="lab-controls">
      <button type="button" class="outline-button" data-action="repair">修好入口门</button>
      <button type="button" class="outline-button" data-action="bypass">走侧廊</button>
      <button type="button" class="outline-button" data-action="retrieve">取档案</button>
      <button type="button" class="outline-button" data-action="rescue">启动救援灯</button>
      <button type="button" class="outline-button" data-action="return">返回出口</button>
    </div></fieldset>
    <p class="lab-reading" role="status">预测哪种构筑更容易完成你的目标，再开始。</p>
    <p class="lab-question">用另一构筑跑相同的体力预算和目标。两种角色分别应该把资源留给哪一步？如果一条路径总占优，你会先改哪个条件？</p>`;
  const build = root.querySelector('[data-build]');
  const stamina = root.querySelector('[data-stamina]');
  const goal = root.querySelector('[data-quest]');
  const actions = root.querySelector('[data-actions]');
  const status = root.querySelector('.lab-reading');
  const cost = root.querySelector('[data-cost]');
  let run;
  const goalMet = () => run.state.done && (run.goal === 'records' || run.state.rescue);
  const parameters = () => [
    readout('角色构筑', rpgBuilds[run?.build ?? build.value].label),
    readout('初始体力', run?.initial ?? Number(stamina.value)),
    readout('本轮目标', questPlans[run?.goal ?? goal.value]),
  ];
  const displayCost = () => {
    const setup = rpgBuilds[build.value];
    cost.textContent = `待用构筑的成本：修门 ${setup.repair}，侧廊 ${setup.bypass}，救援 ${setup.rescue}，取档案及撤离各 1。`;
  };
  function displayState() {
    const { zone, stamina, records, rescue, moves } = run.state;
    root.querySelector('[data-state]').textContent = `${zone} · 剩余体力 ${stamina} · 档案${records ? '已取' : '未取'} · 救援灯${rescue ? '已开' : '未开'} · 行动 ${moves} 次`;
    actions.disabled = run.state.done;
  }
  root.querySelector('[data-start]').addEventListener('click', () => {
    const initial = Number(stamina.value);
    run = { build: build.value, initial, goal: goal.value, state: makeQuestState(initial), events: [] };
    status.textContent = '已到入口，选择一种进入方式。';
    displayState();
  });
  actions.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || !run) return;
    const result = applyQuestAction(run.state, rpgBuilds[run.build], action);
    run.state = result.state;
    run.events.push(result.message);
    status.textContent = `${result.message}${run.state.done ? (goalMet() ? ' 本轮目标达成。' : ' 主任务已完成，救援目标未达成。') : ''}`;
    displayState();
  });
  build.addEventListener('change', displayCost);
  displayCost();
  return { snapshot: () => ({
    parameters: parameters(),
    results: run?.events.length ? [
      readout('进站方式', run.state.route || '尚未进站'),
      readout('剩余体力', run.state.stamina),
      readout('本轮达成', run.state.done ? (goalMet() ? '已达成自定目标' : '仅完成主任务') : '尚未完成'),
      readout('行动记录', run.events.slice(-5).join('；')),
    ] : [],
  }) };
}

export const earlyGenreLabs = {
  'genre-platform': { title: '在两套容错窗口里回放相同跳跃输入', mount: mountPlatform },
  'genre-shooter': { title: '移动一格屏蔽物，重走同一条灰盒路线', mount: mountShooter },
  'genre-puzzle': { title: '用两版线索验证石门的读取顺序', mount: mountPuzzle },
  'genre-rpg': { title: '换一套角色构筑，看看同一任务的资源账', mount: mountRpg },
};
