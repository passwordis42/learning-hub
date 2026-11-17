'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('settings-page')) return;
  const names = { openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', qwen: '通义千问' };
  let saved = null;
  let active = 'openai';
  let dirty = false;
  let busy = false;
  let pending = null;
  let rebindConfirm = false;

  function requestInit(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    };
  }

  function api(path) {
    const name = location.pathname.replace(/index\.html$/, '');
    const base = name.endsWith('/') ? name : name.slice(0, name.lastIndexOf('/') + 1);
    return `${base}api/${path}`;
  }

  function record() {
    return saved?.vendors?.find((item) => item.id === active) || null;
  }

  function setBusy(next) {
    busy = next;
    $('settings-save').disabled = next;
    $('settings-test').disabled = next || dirty;
    $('settings-model-test').disabled = next || dirty;
    $('settings-clear').disabled = next;
    document.querySelectorAll('[data-settings-vendor]').forEach((button) => { button.disabled = next; });
  }

  function showFields() {
    $('settings-ai-fields').hidden = $('settings-ai-mode').value !== 'custom';
    $('settings-game-fields').hidden = $('settings-game-mode').value !== 'custom';
    const regionLabel = document.querySelector('label[for="settings-region"]');
    const workspaceLabel = document.querySelector('label[for="settings-workspace"]');
    if (regionLabel) regionLabel.hidden = active !== 'qwen';
    $('settings-region').hidden = active !== 'qwen';
    const workspace = active === 'anthropic' || active === 'qwen';
    if (workspaceLabel) workspaceLabel.hidden = !workspace;
    $('settings-workspace').hidden = !workspace;
  }

  function paint() {
    const item = record();
    $('settings-vendor').textContent = names[active];
    $('settings-address').value = item?.enteredBaseUrl || '';
    $('settings-model').value = item?.enteredModel || '';
    $('settings-key').value = '';
    $('settings-key-status').textContent = item?.apiKeyConfigured ? '已在后端保存' : '尚未保存密钥';
    const aiCustom = Boolean(item?.protocols?.ai?.enteredModel || item?.protocols?.ai?.enteredBaseUrl);
    const gameCustom = Boolean(item?.protocols?.game?.enteredModel || item?.protocols?.game?.enteredBaseUrl);
    $('settings-ai-mode').value = aiCustom ? 'custom' : 'inherit';
    $('settings-game-mode').value = gameCustom ? 'custom' : 'inherit';
    $('settings-ai-address').value = item?.protocols?.ai?.enteredBaseUrl || '';
    $('settings-ai-model').value = item?.protocols?.ai?.enteredModel || '';
    $('settings-game-address').value = item?.protocols?.game?.enteredBaseUrl || '';
    $('settings-game-model').value = item?.protocols?.game?.enteredModel || '';
    $('settings-region').value = item?.region || 'beijing';
    $('settings-workspace').value = item?.workspaceId || '';
    $('settings-token').value = '';
    $('settings-token-status').textContent = saved?.accessTokenConfigured ? '已在后端保存' : '尚未保存口令';
    showFields();
    dirty = false;
    $('settings-status').textContent = '连接尚未验证。';
    $('settings-hint').textContent = '请先保存，再测试。测试已保存配置只检查本机状态，不会调用模型。测试模型调用会向已保存的服务发送一次请求，可能产生用量。';
    setBusy(false);
    document.querySelectorAll('[data-settings-vendor]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.settingsVendor === active));
    });
  }

  function mark() {
    if (busy) return;
    dirty = true;
    $('settings-status').textContent = '有未保存的更改';
    $('settings-hint').textContent = '请先保存，再测试。';
    $('settings-test').disabled = true;
    $('settings-model-test').disabled = true;
  }

  function result(text, error) {
    const node = $('settings-result');
    node.classList.toggle('error', Boolean(error));
    node.replaceChildren();
    for (const line of String(text).split('\n')) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      node.append(paragraph);
    }
  }

  function unreachable(writing) {
    result(writing
      ? '后端不可达。配置没有写入。请确认本机入口仍在运行。课程和学习进度不受影响。'
      : '后端不可达。没有完成测试。请确认本机入口仍在运行。课程和学习进度不受影响。', true);
  }

  function payload() {
    const custom = (mode, address, model) => mode === 'custom'
      ? { baseUrl: address.trim(), model: model.trim() }
      : { baseUrl: '', model: '' };
    const body = {
      save: true,
      vendors: {
        [active]: {
          baseUrl: $('settings-address').value.trim(),
          model: $('settings-model').value.trim(),
          protocols: {
            ai: custom($('settings-ai-mode').value, $('settings-ai-address').value, $('settings-ai-model').value),
            game: custom($('settings-game-mode').value, $('settings-game-address').value, $('settings-game-model').value),
          },
        },
      },
    };
    const key = $('settings-key').value;
    if (key) body.vendors[active].apiKey = key;
    if (rebindConfirm) body.vendors[active].confirmKeyBinding = 'clear-key-for-new-upstream';
    if (active === 'qwen') body.vendors[active].region = $('settings-region').value;
    if (active === 'anthropic' || active === 'qwen') body.vendors[active].workspaceId = $('settings-workspace').value.trim();
    const token = $('settings-token').value;
    if (token) body.accessToken = token;
    return body;
  }

  async function save() {
    if (busy) return;
    const ai = payload().vendors[active].protocols.ai;
    const game = payload().vendors[active].protocols.game;
    if ($('settings-ai-mode').value === 'custom' && !ai.baseUrl && !ai.model) {
      result('AI 学伴选择了单独设置，但地址和模型都是空的。请填写覆盖项，或改回继承共用。', true);
      return;
    }
    if ($('settings-game-mode').value === 'custom' && !game.baseUrl && !game.model) {
      result('游戏助手选择了单独设置，但地址和模型都是空的。请填写覆盖项，或改回继承共用。', true);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(api('assistant-config'), requestInit('PUT', payload()));
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.code === 'admin-auth') {
        setBusy(false);
        $('settings-admin-dialog').showModal();
        $('settings-admin-token').focus();
        return;
      }
      if (response.status === 409 && data.code === 'upstream-key-rebinding') {
        setBusy(false);
        $('settings-rebind-dialog').showModal();
        $('settings-rebind-cancel').focus();
        return;
      }
      if (!response.ok) {
        result(data.error || '配置没有保存。', true);
        setBusy(false);
        if (data.field === 'accessToken') $('settings-token').focus();
        return;
      }
      saved = data;
      paint();
      $('settings-status').textContent = '配置已保存';
      result('尚未测试。保存成功只表示配置已写入，没有连接上游。', false);
      $('settings-key').value = '';
      $('settings-token').value = '';
    } catch {
      unreachable(true);
      setBusy(false);
    }
  }

  function describe(data) {
    return ['ai', 'game'].map((side) => data[side] ? `${data[side].course}：${data[side].message}` : '').filter(Boolean).join('\n');
  }

  async function runTest(scope) {
    if (busy || dirty) return;
    setBusy(true);
    try {
      const response = await fetch(api('assistant-config/test'), requestInit('POST', scope === 'model'
        ? { scope, vendor: active, confirm: 'test-model-usage' }
        : { scope: 'status', vendor: active }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        result(data.error || '测试没有完成。', true);
        setBusy(false);
        return;
      }
      const failed = ['ai', 'game'].some((side) => data[side] && !['ok', 'configured', 'unconfigured'].includes(data[side].code));
      result(describe(data), failed);
      setBusy(false);
    } catch {
      unreachable(false);
      setBusy(false);
    }
  }

  function activate(id, focusButton) {
    active = id;
    paint();
    $('settings-result').classList.remove('error');
    result('尚未测试。保存成功只表示配置已写入，没有连接上游。', false);
    if (focusButton) document.querySelector(`[data-settings-vendor="${id}"]`)?.focus();
  }

  function trapDialog(dialog) {
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const items = [...dialog.querySelectorAll('button, a, input, select, textarea')].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  trapDialog($('settings-clear-dialog'));
  trapDialog($('settings-unsaved-dialog'));
  trapDialog($('settings-rebind-dialog'));
  trapDialog($('settings-admin-dialog'));

  function confirmLeave(next) {
    if (!dirty || busy) { next(); return; }
    pending = next;
    $('settings-unsaved-dialog').showModal();
    $('settings-unsaved-keep').focus();
  }

  document.querySelectorAll('[data-settings-vendor]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.settingsVendor === active) return;
      confirmLeave(() => activate(button.dataset.settingsVendor, true));
    });
  });
  ['settings-address', 'settings-model', 'settings-key', 'settings-ai-address', 'settings-ai-model', 'settings-game-address', 'settings-game-model', 'settings-workspace', 'settings-token'].forEach((id) => {
    $(id).addEventListener('input', mark);
  });
  ['settings-ai-mode', 'settings-game-mode', 'settings-region'].forEach((id) => {
    $(id).addEventListener('change', () => { showFields(); mark(); });
  });
  $('settings-save').addEventListener('click', save);
  $('settings-test').addEventListener('click', () => runTest('status'));
  $('settings-model-test').addEventListener('click', () => runTest('model'));
  $('settings-clear').addEventListener('click', () => {
    if (busy) return;
    $('settings-clear-copy').textContent = `将清除${names[active]}的密钥、地址、模型和覆盖项。使用该配置的 AI／游戏助手将暂不可用；课程和学习进度不受影响。`;
    $('settings-clear-dialog').showModal();
    $('settings-clear-cancel').focus();
  });
  $('settings-clear-cancel').addEventListener('click', () => $('settings-clear-dialog').close());
  $('settings-clear-confirm').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(api('assistant-config/clear'), requestInit('POST', { confirm: 'clear-vendor-configuration', vendor: active }));
      const data = await response.json().catch(() => ({}));
      $('settings-clear-dialog').close();
      if (!response.ok) {
        result(data.effect || data.error || '没有清除。', true);
        setBusy(false);
        return;
      }
      const fresh = await fetch(api('assistant-config'), { cache: 'no-store', credentials: 'same-origin' });
      saved = await fresh.json();
      activate(active, true);
      result('此厂商配置已清除。课程与学习进度不受影响。', false);
    } catch {
      $('settings-clear-dialog').close();
      unreachable(true);
      setBusy(false);
    }
  });
  $('settings-rebind-cancel').addEventListener('click', () => {
    rebindConfirm = false;
    $('settings-rebind-dialog').close();
    $('settings-key').focus();
  });
  $('settings-rebind-clear').addEventListener('click', () => {
    rebindConfirm = true;
    $('settings-rebind-dialog').close();
    save().finally(() => { rebindConfirm = false; });
  });
  $('settings-admin-cancel').addEventListener('click', () => $('settings-admin-dialog').close());
  $('settings-admin-submit').addEventListener('click', async () => {
    const token = $('settings-admin-token').value;
    $('settings-admin-token').value = '';
    try {
      const response = await fetch(api('assistant-session'), requestInit('POST', { token }));
      if (!response.ok) {
        result('管理口令没有被接受。模型密钥仍然只在保存配置时提交。', true);
        return;
      }
      $('settings-admin-dialog').close();
      save();
    } catch {
      unreachable(true);
    }
  });
  $('settings-unsaved-keep').addEventListener('click', () => { pending = null; $('settings-unsaved-dialog').close(); });
  $('settings-unsaved-discard').addEventListener('click', () => {
    const next = pending;
    pending = null;
    dirty = false;
    $('settings-unsaved-dialog').close();
    paint();
    if (next) next();
  });
  window.ATLAS_SETTINGS = { confirmLeave };

  fetch(api('assistant-config'), { cache: 'no-store', credentials: 'same-origin' }).then(async (response) => {
    if (response.status === 401) {
      const data = await response.json().catch(() => ({}));
      paint();
      if (data.code === 'admin-auth') {
        $('settings-admin-dialog').showModal();
        $('settings-admin-token').focus();
        return;
      }
      result(data.error || '请从入口页面重新打开。', true);
      return;
    }
    if (!response.ok) throw new Error('status');
    saved = await response.json();
    paint();
    result('尚未测试。保存成功只表示配置已写入，没有连接上游。', false);
  }).catch(() => {
    paint();
    unreachable(false);
  });
})();
