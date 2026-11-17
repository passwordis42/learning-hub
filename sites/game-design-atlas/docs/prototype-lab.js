const phaseLabels = { playing: '游玩中', failed: '失败', complete: '已完成' };
const metric = (label, value) => ({ label, value });

export function initialPrototypeState() {
  return { phase: 'playing', distance: 80, box: true, count: 0, doorOpen: false };
}

export function runPrototypeEvent(state, rules, event) {
  const reply = (message, patch = {}) => ({ state: { ...state, ...patch }, message });
  switch (event.type) {
    case 'fail':
      return state.phase === 'playing' ? reply('进入失效区，场景进入失败状态。', { phase: 'failed' }) : reply('当前状态不响应新的失败事件。');
    case 'restart':
      return reply('回到游玩状态和起点。请对照盒子、计数和门是否各自恢复。', {
        phase: 'playing', distance: 80, box: rules.resetBox ? true : state.box,
        count: rules.resetCount ? 0 : state.count, doorOpen: rules.resetDoor ? false : state.doorOpen,
      });
    case 'door':
      if (state.phase !== 'playing') return reply('门只在游玩状态响应。');
      if (rules.doorCondition === 'requires-box' && !state.count) return reply('门仍关闭。当前计数尚未达到 1。');
      return rules.doorAction === 'open' ? reply('开门动作修改了门的状态。', { doorOpen: true }) : reply('显示了开门提示。门的状态保持不变。');
    case 'exit':
      return state.phase === 'playing' && state.doorOpen ? reply('穿过了打开的门，本轮完成。', { phase: 'complete' }) : reply('需要在游玩状态下穿过打开的门。');
    case 'approach':
    case 'interact': {
      const moved = event.type === 'approach';
      if (moved && state.phase !== 'playing') return reply('当前状态下不能移动，距离保持不变。');
      const distance = moved ? event.distance : state.distance;
      const position = { distance };
      if (event.type !== rules.pickupTrigger) return reply('事件已发生，拾取规则的触发方式不匹配。', position);
      if (rules.pickupPhase === 'playing' && state.phase !== 'playing') return reply('状态条件未通过，盒子和计数保持不变。', position);
      const inRange = rules.distanceComparison === 'inclusive' ? distance <= rules.pickupDistance : distance < rules.pickupDistance;
      if (!inRange) return reply('距离条件未通过，盒子和计数保持不变。', position);
      if (!state.box) return reply('没有可拾取的盒子。', position);
      return reply('触发和条件均已匹配。比较动作前后的盒子与计数。', {
        ...position,
        box: rules.pickupAction === 'count-only',
        count: state.count + (rules.pickupAction === 'remove-only' ? 0 : 1),
      });
    }
    default:
      return reply('当前没有发生已知事件。');
  }
}

export function prototypeLab(root) {
  root.innerHTML = `<p>下面的实验把引擎事件表缩成一个房间。先写下你想让按键、距离和重开怎样相互作用，再配置规则并试跑。每次修改后重新应用规则，会从一个干净的房间开始。</p>
    <form class="prototype-rules">
      <fieldset class="lab-switch"><legend>拾取规则</legend>
        <label>触发 <select name="pickupTrigger" required><option value="">选择</option><option value="interact">按交互键</option><option value="approach">走到新位置</option></select></label>
        <label>距离比较 <select name="distanceComparison" required><option value="">选择</option><option value="inclusive">小于或等于</option><option value="exclusive">严格小于</option></select></label>
        <label>距离上限（像素） <input type="number" name="pickupDistance" min="1" max="100" step="1" required></label>
        <label>允许的状态 <select name="pickupPhase" required><option value="">选择</option><option value="playing">仅游玩中</option><option value="any">所有状态</option></select></label>
        <label>拾取动作 <select name="pickupAction" required><option value="">选择</option><option value="collect">计数 +1 并移除盒子</option><option value="count-only">仅计数 +1</option><option value="remove-only">仅移除盒子</option></select></label>
      </fieldset>
      <fieldset class="lab-switch"><legend>按开门键时</legend>
        <label>门的条件 <select name="doorCondition" required><option value="">选择</option><option value="requires-box">计数至少为 1</option><option value="always">无额外条件</option></select></label>
        <label>门的动作 <select name="doorAction" required><option value="">选择</option><option value="open">改变为开门状态</option><option value="signal">只显示提示</option></select></label>
      </fieldset>
      <fieldset class="lab-switch"><legend>按重开键时恢复哪些对象或变量？</legend>
        <label><input type="checkbox" name="resetBox"> 盒子</label><label><input type="checkbox" name="resetCount"> 计数</label><label><input type="checkbox" name="resetDoor"> 门</label>
      </fieldset>
      <button class="primary-button" type="submit">应用这些规则</button>
      <p class="lab-reading" data-rule-status role="status">重开总是回到起点和游玩状态，物品与门按你勾选的规则处理。</p>
    </form>
    <fieldset class="prototype-controls lab-switch" disabled><legend>试跑房间</legend>
      <label>目标距离 <select data-distance><option value="39">39 像素</option><option value="40">40 像素</option><option value="41">41 像素</option></select></label>
      <div class="lab-controls">
        <button class="outline-button" type="button" data-event="approach">走到目标距离</button><button class="outline-button" type="button" data-event="interact">按交互键</button><button class="outline-button" type="button" data-event="door">按开门键</button><button class="outline-button" type="button" data-event="exit">尝试出门</button><button class="outline-button" type="button" data-event="fail">进入失效区</button><button class="outline-button" type="button" data-event="restart">按重开键</button>
      </div>
    </fieldset>
    <div class="lab-metrics" data-prototype-state></div>
    <p class="lab-reading" data-event-status role="status">规则应用后，你可以逐个触发事件。</p>
    <ol class="prototype-log" aria-label="最近六次试跑记录"></ol>
    <p class="lab-question">比较 39、40、41 像素处的结果。再检查只靠近时会不会误拾取，失败时是否还响应按键，重开两次后盒子、计数和门能否一起复原。</p>`;

  const form = root.querySelector('.prototype-rules');
  const controls = root.querySelector('.prototype-controls');
  const ruleStatus = root.querySelector('[data-rule-status]');
  const eventStatus = root.querySelector('[data-event-status]');
  const summary = root.querySelector('[data-prototype-state]');
  const log = root.querySelector('.prototype-log');
  let rules;
  let state = initialPrototypeState();
  let parameters = [];
  let attempts = [];

  function display() {
    summary.innerHTML = `<span>状态 <strong>${phaseLabels[state.phase]}</strong></span><span>距离 <strong>${state.distance} px</strong></span><span>盒子 <strong>${state.box ? '在场' : '已移除'}</strong></span><span>计数 <strong>${state.count}</strong></span><span>门 <strong>${state.doorOpen ? '开' : '关'}</strong></span>`;
  }

  form.addEventListener('input', () => {
    controls.disabled = true;
    ruleStatus.textContent = '规则已修改。重新应用后再试跑。';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    rules = { ...Object.fromEntries(fields), pickupDistance: Number(fields.get('pickupDistance')),
      resetBox: fields.has('resetBox'), resetCount: fields.has('resetCount'), resetDoor: fields.has('resetDoor') };
    const selectedLabel = (name) => form.elements[name].selectedOptions[0].textContent.trim();
    parameters = [
      metric('拾取触发', selectedLabel('pickupTrigger')),
      metric('距离界线', selectedLabel('distanceComparison') + ' ' + rules.pickupDistance + ' px'),
      metric('拾取允许状态', selectedLabel('pickupPhase')),
      metric('拾取动作', selectedLabel('pickupAction')),
      metric('开门条件', selectedLabel('doorCondition')),
      metric('门的动作', selectedLabel('doorAction')),
      metric('重开恢复对象', [rules.resetBox && '盒子', rules.resetCount && '计数', rules.resetDoor && '门'].filter(Boolean).join('、') || '只恢复起点和游玩状态')
    ];
    attempts = [];
    state = initialPrototypeState();
    controls.disabled = false;
    ruleStatus.textContent = '规则已应用，房间已恢复初始状态。';
    eventStatus.textContent = '先预测第一个事件的结果，再试跑。';
    log.replaceChildren();
    display();
  });

  controls.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-event]');
    if (!button || controls.disabled) return;
    const distance = Number(controls.querySelector('[data-distance]').value);
    const result = runPrototypeEvent(state, rules, { type: button.dataset.event, distance });
    state = result.state;
    attempts.push({ action: button.textContent, distance: state.distance, result: result.message, count: state.count });
    eventStatus.textContent = result.message;
    const entry = document.createElement('li');
    entry.textContent = `${button.textContent}。${result.message} 计数 ${state.count}，盒子${state.box ? '在场' : '已移除'}，门${state.doorOpen ? '开' : '关'}。`;
    log.prepend(entry);
    if (log.children.length > 6) log.lastElementChild.remove();
    display();
  });
  display();
  return { snapshot: () => ({
    parameters,
    results: attempts.length ? [
      metric('试跑事件数', attempts.length),
      metric('当前房间状态', phaseLabels[state.phase]),
      metric('当前距离（像素）', state.distance),
      metric('当前计数', state.count),
      metric('盒子', state.box ? '在场' : '已移除'),
      metric('门', state.doorOpen ? '开' : '关'),
      metric('最近动作轨迹', attempts.slice(-5).map((attempt) => attempt.action + '（' + attempt.distance + ' px，计数 ' + attempt.count + '）' + attempt.result).join('；'))
    ] : []
  }) };
}
