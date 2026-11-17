import { assistantRoot, credentialMode } from './credential-mode.js';

const configuredLocal = () => assistantRoot(location);
const setup = 'https://github.com/passwordis42/game-design-atlas#本地启动与-ai-服务';

export function mountFollowup(root, submission) {
  root.innerHTML = '<h4>请 AI 追问我的判断</h4><p class="quiet">提交时，只发送这里所选案例或实验及你已保存的记录。AI 返回核对问题。</p>';
  const connect = document.createElement('button');
  connect.type = 'button';
  connect.className = 'outline-button';
  connect.textContent = '检查本地模型连接';
  const settings = document.createElement('a');
  settings.href = setup;
  settings.target = '_blank';
  settings.rel = 'noopener noreferrer';
  settings.className = 'text-link';
  settings.textContent = '模型配置说明 ↗';
  const toolbar = document.createElement('div');
  toolbar.className = 'form-actions';
  toolbar.append(connect, settings);

  const form = document.createElement('form');
  form.className = 'followup-form';
  form.hidden = true;
  const label = document.createElement('label');
  label.textContent = '模型服务';
  const provider = document.createElement('select');
  provider.required = true;
  label.append(provider);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'primary-button';
  send.textContent = '发送我的记录，请 AI 追问';
  form.append(label, send);
  const status = document.createElement('p');
  status.className = 'quiet';
  status.setAttribute('role', 'status');
  const questions = document.createElement('ol');
  questions.className = 'followup-questions';
  questions.setAttribute('aria-label', 'AI 的追问');
  root.append(toolbar, form, status, questions);

  connect.addEventListener('click', async () => {
    connect.disabled = true;
    form.hidden = true;
    status.textContent = '正在检查本地助手…';
    try {
      const result = await fetch(configuredLocal() + '/api/status', { credentials: credentialMode(configuredLocal() + '/api/status', location.origin), signal: AbortSignal.timeout(2500) });
      if (!result.ok) throw new Error();
      const body = await result.json();
      const models = body.providers.filter((item) => item.configured);
      provider.replaceChildren(new Option('选择服务商', '', true, true), ...models.map((item) => new Option(item.label + ' · ' + item.model, item.id)));
      form.hidden = !models.length;
      status.textContent = models.length ? '选好服务商，再确认发送。' : '本地助手在线。配置一个模型密钥后重启即可使用。';
    } catch {
      status.textContent = '当前无法连接本地助手。可按设置说明打开本地课程，并导入这份学习记录。';
    } finally {
      connect.disabled = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (send.disabled || !provider.value) return;
    send.disabled = true;
    connect.disabled = true;
    provider.disabled = true;
    questions.replaceChildren();
    status.textContent = '正在生成追问…';
    try {
      const result = await fetch(configuredLocal() + '/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: credentialMode(configuredLocal() + '/api/assist', location.origin),
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ ...submission, provider: provider.value, mode: 'coach' })
      });
      const body = await result.json();
      if (!result.ok) throw new Error(body.error || '暂时无法获得追问。');
      if (!Array.isArray(body.questions) || !body.questions.length) throw new Error('这次未获得追问，可稍后重试。');
      for (const text of body.questions) {
        const item = document.createElement('li');
        item.textContent = text;
        questions.append(item);
      }
      status.textContent = '先选一个问题，把你的补充判断写进复盘。';
    } catch (error) {
      status.textContent = error instanceof TypeError ? '连接中断，可稍后重试。你的学习记录仍已保存。' : error.message;
    } finally {
      send.disabled = false;
      connect.disabled = false;
      provider.disabled = false;
    }
  });
}
