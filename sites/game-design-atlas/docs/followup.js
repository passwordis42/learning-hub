import { directFailure, listAssistant } from './parent-config.js';
import { askGameVendor } from './coach-direct.js';

const hubEmbed = new URLSearchParams(location.search).get('embed') === '1';
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
      if (!hubEmbed) throw new Error('standalone');
      const models = (await listAssistant('game')).filter((item) => item.configured);
      provider.replaceChildren(new Option('选择服务商', '', true, true), ...models.map((item) => new Option(item.label + ' · ' + item.model, item.id)));
      form.hidden = !models.length;
      status.textContent = models.length ? '选好服务商，再确认发送。' : '入口页面还没有填写可用的密钥和模型。没有连接供应商。';
    } catch {
      status.textContent = '助手暂不可用。请从统一入口打开本课。本页不会连接本地 4173，也不会打开配置页。';
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
      const body = await askGameVendor({ ...submission, provider: provider.value, mode: 'coach' });
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
