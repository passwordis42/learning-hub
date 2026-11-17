import { credentialMode } from './credential-mode.js';
import { weeks } from './data/curriculum.js';
import { weekLabel } from './graph.js';
import { checkpointReady, completeRules, downloadFile, ruledLines } from './records.js?v=guided-3';

const providers = [['openai', 'OpenAI'], ['anthropic', 'Claude'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen']];
const fields = [
  ['draft', '我的设计草案', '写出玩家要做的选择，以及你决定的玩法规则。'],
  ['rationale', '我的取舍理由', '这条规则在服务哪个体验？它的代价是什么？'],
  ['evidence', '我的观察或待验假设', '写具体的玩家行为，或你下一轮准备验证的行为。请先去除身份信息。']
];
const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const localUrl = 'http://127.0.0.1:4173';
const repository = 'https://github.com/passwordis42/game-design-atlas';
let apiRoot = localHost ? location.origin : '';
let apiProviders = null;

function textArea(field, label, placeholder, entry, editable, esc) {
  return `<div class="field"><label for="coach-${field}">${label}</label><textarea id="coach-${field}" name="${field}" maxlength="4000" placeholder="${placeholder}" ${editable ? 'required' : 'readonly'}>${esc(entry[field])}</textarea></div>`;
}

function items(label, values, esc) {
  if (!Array.isArray(values) || !values.length) return '';
  return `<h3>${label}</h3><ul>${values.map((value) => `<li>${esc(value)}</li>`).join('')}</ul>`;
}

function requestError(error) {
  if (error.name === 'TimeoutError') return '等待超时，请稍后重试。';
  if (error instanceof TypeError) return '无法连接本地助手。请检查本地课程是否在运行。';
  return error.message;
}

function implementationBrief(week, approved) {
  return `# 第 ${week.id} 周 · ${week.title}\n\n## 本次已由学习者确认的规则\n\n${approved.map((rule) => `- ${rule}`).join('\n')}\n\n## 交给开发助手的要求\n\n- 先列修改计划，每个玩法改动逐条对应上面的规则。提交计划后等待我确认。\n- 遇到未决定的状态、数值、碰撞、重置、奖励或边界，问我怎么处理，保留缺项供我补写。\n- 检查模板与引擎的默认行为。发现会影响玩法的代码、组件或默认值，先报告，再由我决定。\n- 交付改动说明和可手动复现的测试步骤。我会亲自在原版和改版里检查边界、观察玩家，再写下取舍依据。\n`;
}

export function mountCoach(container, week, initial, { save, notice, selectWeek, esc }) {
  let record = { ...initial };
  let revision = null;
  let result = null;
  let mode = 'coach';
  let selectedProvider = '';
  let busy = false;
  let connectionMessage = '';
  let approvalSet = new Set();

  const active = () => container.firstElementChild === root;
  const root = document.createElement('div');
  root.className = 'coach-grid';
  container.replaceChildren(root);

  function providerOptions() {
    return `<option value="">选择 AI 服务</option>${providers.map(([id, label]) => {
      const info = apiProviders?.find((provider) => provider.id === id);
      return `<option value="${id}" ${info?.configured ? '' : 'disabled'} ${id === selectedProvider ? 'selected' : ''}>${esc(label)}${info?.configured ? ` · ${esc(info.model)}` : ' · 待连接'}</option>`;
    }).join('')}`;
  }

  function canUseAI() {
    return record.locked && !revision && !busy;
  }

  function canExport() {
    return canUseAI() && completeRules([...approvalSet]) && (selectedProvider ? result?.status === 'ready' : result?.status !== 'blocked');
  }

  function checkpointActions() {
    if (revision) return '<button class="primary-button" type="submit">保存本次修改</button><button class="outline-button" type="button" id="cancel-revision">取消修改</button>';
    if (record.locked) return `<button class="outline-button" type="button" id="revise-draft" ${busy ? 'disabled' : ''}>修改检查点</button><span class="quiet">✓ 当前版本已保存</span>`;
    return '<button class="primary-button" type="submit">确认是我的设计并保存</button>';
  }

  function render() {
    if (!active()) return;
    const formatted = ruledLines(record.draft);
    const connection = apiProviders?.some((item) => item.configured)
      ? '已连接本地助手。可用服务显示在下方。'
      : '可先记下设计和验收。连接本地助手后，再选择启用的 AI 服务。';
    root.innerHTML = `
      <div class="coach-column">
        <section class="panel coach-card">
          <h2>我的设计检查点</h2>
          <div class="field"><label for="coach-week">学习周次</label><select id="coach-week">${weeks.map((item) => `<option value="${item.id}" ${item.id === week.id ? 'selected' : ''}>${weekLabel(item.id)} · ${esc(item.title)}</option>`).join('')}</select></div>
          <p class="quiet">${esc(week.evidence)}</p>
          <form id="checkpoint-form">${fields.map((field) => textArea(...field, revision ?? record, !record.locked || Boolean(revision), esc)).join('')}
            <p class="form-hint quiet">需要委托实现时，将每条规则单独写一行，按「触发：…；条件：…；结果：…；例外：…」填写。明确没有条件或例外时可写「无」。</p>
            ${revision ? '<p class="quiet">保存修改后，现有验收会保留为上次验收记录。请为这版设计重新验证。离开本页会舍弃尚未保存的修改。</p>' : ''}
            <div class="form-actions">${checkpointActions()}</div>
            <p id="checkpoint-error" class="form-error quiet" role="status"></p>
          </form>
        </section>
        <section class="panel coach-card">
          <h2>我的验收与复盘</h2>
          <p class="quiet">按本周项目标准亲自完成练习，记下你执行了什么、实际观察到什么，以及你的判断。保存检查点和复盘后，可在课末「本周项目与验收」里标记项目已验收。</p>
          <div class="field"><label for="verification">亲自验证的结果</label><textarea id="verification" maxlength="4000" placeholder="第几版、怎么试、观察到什么、下一步怎么判断" ${revision ? 'readonly' : ''}>${esc(record.verification)}</textarea></div>
          ${record.previousVerification ? `<details class="study-details"><summary>查看上次验收记录</summary><div class="sample-answer"><p>${esc(record.previousVerification)}</p></div></details>` : ''}
          <div class="form-actions"><a class="outline-button" href="#plan/${weekLabel(week.id)}">返回本周课程</a></div>
        </section>
      </div>
      <div class="coach-column">
        <section class="panel coach-card">
          <h2>选择 AI 如何协助</h2>
          <p class="quiet">${esc(connection)}</p>
          <div class="form-actions"><button class="outline-button" type="button" id="connect-ai" ${busy || revision ? 'disabled' : ''}>${apiProviders ? '检查连接' : '连接本地助手'}</button><a class="text-link" href="${repository}#本地启动与-ai-服务" target="_blank" rel="noopener noreferrer">设置说明 ↗</a></div>
          <p class="quiet" role="status">${esc(connectionMessage)} ${connectionMessage && !localHost ? `<a class="text-link" href="${localUrl}/#coach/${weekLabel(week.id)}" target="_blank" rel="noopener noreferrer">打开本地课程 ↗</a>` : ''}</p>
          <div class="field"><label for="coach-mode">协助方式</label><select ${canUseAI() ? '' : 'disabled'} id="coach-mode"><option value="coach" ${mode === 'coach' ? 'selected' : ''}>提问 · 澄清我的想法</option><option value="review" ${mode === 'review' ? 'selected' : ''}>评审 · 检查证据与规格</option><option value="implementation" ${mode === 'implementation' ? 'selected' : ''}>委托实现 · 确认规则范围</option></select></div>
          <div class="field"><label for="coach-provider">模型服务</label><select ${canUseAI() ? '' : 'disabled'} id="coach-provider">${providerOptions()}</select></div>
          ${mode === 'implementation' ? `<fieldset class="field-group" ${canUseAI() ? '' : 'disabled'}><legend>本次允许实现的规则</legend>${formatted.length ? formatted.map((rule, index) => `<label><input type="checkbox" value="${index}" ${approvalSet.has(rule) ? 'checked' : ''}><span>${esc(rule)}</span></label>`).join('') : '<p class="quiet">先修改检查点，按四个字段写出规则，再回来逐条确认。</p>'}</fieldset>` : ''}
          ${revision ? '<p class="quiet">请保存或取消本次修改，再请求 AI 协助。</p>' : record.locked ? '<p class="quiet">点击提交时，当前模式所需的内容会发送给你选择的服务商。委托实现模式只发送本次确认的规则和课程信息。</p>' : '<p class="quiet">保存你自己的草案、理由和证据后，才能请求协助。</p>'}
          <div class="form-actions"><button class="primary-button" id="ask-ai" type="button" ${canUseAI() && selectedProvider ? '' : 'disabled'}>${busy ? '正在连接…' : '提交给所选 AI'}</button>${mode === 'implementation' ? `<button class="outline-button" id="export-rules" type="button" ${canExport() ? '' : 'disabled'}>导出确认范围</button>` : ''}</div>
          <p class="quiet">AI 返回追问和核对项。导出的实现范围逐字来自你确认的草案。</p>
        </section>
        ${result && !revision ? `<section class="panel coach-card coach-output" aria-live="polite"><h2>${result.status === 'blocked' ? '等你补充的决定' : result.status === 'ready' ? '已确认的实现范围' : '供你核对的反馈'}</h2>${items('先回答的问题', result.questions, esc)}${items('可检查的地方', result.checks, esc)}${items('本次确认的规则', result.specification, esc)}${result.error ? `<p class="form-error">${esc(result.error)}</p>` : ''}</section>` : ''}
      </div>`;
    bind();
  }

  async function connect(manual) {
    if (busy || revision) return;
    busy = true;
    if (manual) { connectionMessage = '正在查找本地助手…'; render(); }
    const endpoint = localHost ? location.origin : localUrl;
    try {
      const response = await fetch(`${endpoint}/api/status`, { signal: AbortSignal.timeout(2500), credentials: credentialMode(`${endpoint}/api/status`, location.origin) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data?.providers)) throw new Error();
      apiRoot = endpoint;
      apiProviders = data.providers;
      if (!apiProviders.some((item) => item.configured && item.id === selectedProvider)) selectedProvider = '';
      connectionMessage = apiProviders.some((item) => item.configured) ? '' : '本地助手在线。请配置至少一个 API 密钥，再重启助手。';
    } catch {
      apiProviders = null;
      selectedProvider = '';
      connectionMessage = manual ? '连接未建立。请按设置说明启动课程，或直接在本地版使用。' : '';
    } finally {
      busy = false;
      render();
    }
  }

  async function requestAssist() {
    if (!canUseAI() || !selectedProvider || !apiRoot) return;
    const approvedRules = [...approvalSet];
    const { draft, rationale, evidence } = record;
    busy = true;
    result = null;
    render();
    try {
      const response = await fetch(`${apiRoot}/api/assist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: credentialMode(`${apiRoot}/api/assist`, location.origin), signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ provider: selectedProvider, mode, week: week.id, title: week.title, draft, rationale, evidence, approvedRules })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求没有完成。');
      result = data;
    } catch (error) { result = { error: requestError(error) }; }
    finally { busy = false; render(); }
  }

  function bind() {
    const find = (selector) => root.querySelector(selector);
    function closeRevision() {
      revision = null;
      render();
      find('#revise-draft').focus();
    }

    find('#coach-week').addEventListener('change', (event) => selectWeek(Number(event.target.value)));
    find('#checkpoint-form').addEventListener('input', (event) => {
      if (!fields.some(([field]) => field === event.target.name)) return;
      if (revision) {
        revision[event.target.name] = event.target.value;
        return;
      }
      record = { ...record, [event.target.name]: event.target.value };
      save(record);
    });
    find('#checkpoint-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (record.locked && !revision) return;
      if (!checkpointReady(revision ?? record)) {
        find('#checkpoint-error').textContent = '请先具体写出三个字段，每项至少四个有效字符。';
        return;
      }
      if (revision) {
        const changed = fields.some(([field]) => revision[field].trim() !== record[field].trim());
        if (changed) {
          record = {
            ...record, ...revision,
            previousVerification: record.verification.trim() ? record.verification : (record.previousVerification ?? ''),
            verification: '', complete: false
          };
          approvalSet.clear();
          result = null;
          save(record);
        }
        closeRevision();
        notice(changed ? '已保存新版本。请为本版记录验收结果。' : '检查点保持不变，现有验收已保留。');
        return;
      }
      record = { ...record, locked: true };
      save(record);
      render();
      find('#revise-draft').focus();
      notice('检查点已保存，可以选择 AI 协助。');
    });
    find('#revise-draft')?.addEventListener('click', () => {
      if (busy) return;
      revision = Object.fromEntries(fields.map(([field]) => [field, record[field]]));
      render();
      find('#coach-draft').focus();
    });
    find('#cancel-revision')?.addEventListener('click', closeRevision);
    find('#verification').addEventListener('input', (event) => {
      record = { ...record, verification: event.target.value, complete: false };
      save(record);
    });
    find('#connect-ai').addEventListener('click', () => { void connect(true); });
    find('#coach-mode').addEventListener('change', (event) => {
      mode = event.target.value;
      result = null;
      render();
      find('#coach-mode').focus();
    });
    find('#coach-provider').addEventListener('change', (event) => {
      selectedProvider = event.target.value;
      result = null;
      render();
      find('#coach-provider').focus();
    });
    find('.field-group')?.addEventListener('change', (event) => {
      const rule = ruledLines(record.draft)[Number(event.target.value)];
      if (event.target.checked) approvalSet.add(rule);
      else approvalSet.delete(rule);
      result = null;
      render();
      find(`.field-group input[value="${event.target.value}"]`)?.focus();
    });
    find('#ask-ai').addEventListener('click', () => { void requestAssist(); });
    find('#export-rules')?.addEventListener('click', () => {
      const lines = [...approvalSet];
      if (canExport()) {
        downloadFile(implementationBrief(week, lines), `week-${weekLabel(week.id)}-approved-rules.md`, 'text/markdown;charset=utf-8');
      }
    });
  }

  render();
  if (localHost && !apiProviders) void connect(false);
}
