'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('settings-page')) return;
  const assistant = window.ATLAS_ASSISTANT;
  const names = { openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', qwen: '通义千问（百炼）' };
  const RECONNECT = '密钥、地区、地址、工作空间或厂商已更改，上次连接结果和列表已取消。请重新连接。';
  let saved = null;
  let active = 'qwen';
  let dirty = false;
  let pending = null;
  let rebindConfirm = false;
  let phase = 'idle';
  let models = [];
  let listNote = '';
  let generation = 0;
  let inflight = null;
  let advancedHeld = false;
  let routeSignature = '';
  let publication = null;
  let publicHeld = null;
  let source = 'manual';

  function record() {
    return saved?.vendors?.find((item) => item.id === active) || null;
  }

  function setResult(kind, text) {
    const node = $('settings-result');
    node.className = 'settings-result' + (kind && kind !== 'idle' ? ' is-' + kind : '');
    node.replaceChildren();
    for (const line of String(text).split('\n')) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      node.append(paragraph);
    }
  }

  function setPermission(kind, text, show) {
    const node = $('model-permission');
    if (!show) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.className = 'settings-result model-permission' + (kind ? ' is-' + kind : '');
    node.textContent = text;
  }

  function typedKey() {
    return $('settings-key').value || '';
  }

  function keyForRequest() {
    return typedKey() || assistant.peekKey(active);
  }

  function regionValue() {
    return $('settings-region').value || '';
  }

  function workspaceValue() {
    return $('settings-workspace').value.trim();
  }

  function addressValue() {
    return $('settings-address').value.trim();
  }

  function currentRouteSignature() {
    const shared = addressValue();
    const region = active === 'qwen' ? regionValue() : '';
    const workspace = active === 'qwen' ? workspaceValue() : '';
    const official = active === 'qwen'
      ? assistant.chatUrl({ region, workspaceId: workspace, customUrl: shared })
      : shared;
    const target = (modeId, addressId) => {
      const typed = $(addressId).value.trim();
      return $(modeId).value === 'custom' && typed ? typed : official;
    };
    const plan = active === 'qwen'
      ? assistant.listPlan({ region, workspaceId: workspace, customUrl: shared })
      : { ok: false, code: 'other' };
    return `${plan.ok ? plan.url : plan.code}\n${target('settings-ai-mode', 'settings-ai-address')}\n${target('settings-game-mode', 'settings-game-address')}`;
  }

  function moveNode(node, slot) {
    if (node && slot && node.parentElement !== slot) slot.appendChild(node);
  }

  function workspaceRequired(region) {
    if (active !== 'qwen' || !region) return false;
    const plan = assistant.listPlan({ region, workspaceId: '', customUrl: '' });
    return plan.code === 'workspace';
  }

  function cancelInflight(message) {
    generation += 1;
    if (inflight) {
      inflight.abort();
      inflight = null;
    }
    const drop = phase === 'loading' || phase === 'list' || phase === 'fallback';
    models = [];
    listNote = '';
    if (drop) phase = 'idle';
    if (drop && message) setResult('ready', message);
    setPermission('', '', false);
  }

  function fillModelSelect() {
    const select = $('settings-model-select');
    const previous = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择模型';
    select.append(placeholder);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.append(option);
    }
    if (models.includes(previous)) select.value = previous;
  }

  function render() {
    const item = record();
    const qwen = active === 'qwen';
    const region = qwen ? regionValue() : '';
    const panel = qwen && (phase === 'region' || phase === 'workspace');
    const needWorkspace = panel && workspaceRequired(region);
    const official = qwen
      ? assistant.chatUrl({ region, workspaceId: workspaceValue(), customUrl: '' })
      : (item?.protocols?.ai?.url || '');
    $('settings-page').dataset.phase = phase;
    $('settings-vendor').textContent = names[active];
    document.querySelectorAll('[data-settings-vendor]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.settingsVendor === active));
    });
    $('region-panel').hidden = !panel;
    $('connect-actions').hidden = panel;
    moveNode($('workspace-field'), needWorkspace ? $('workspace-required-slot') : $('workspace-advanced-slot'));
    $('workspace-required-note').hidden = !needWorkspace;
    const customField = $('custom-model-field');
    if (qwen && phase === 'fallback') moveNode(customField, $('custom-model-fallback-slot'));
    else if (qwen) moveNode(customField, $('custom-model-advanced-slot'));
    else moveNode(customField, $('manual-model-slot'));
    const savedModel = item?.enteredModel || '';
    const savedConfig = Boolean(savedModel || item?.enteredBaseUrl || item?.apiKeyConfigured);
    const baseTools = (qwen && (phase === 'list' || phase === 'fallback')) || (!qwen && phase === 'manual') || savedConfig;
    if (baseTools) advancedHeld = false;
    const showTools = baseTools || advancedHeld;
    customField.hidden = !qwen && !(phase === 'manual' || savedModel);
    $('settings-model-label').textContent = qwen ? '自定义模型名' : '模型名称';
    const advanced = $('settings-advanced');
    if (!showTools) advanced.open = false;
    advanced.hidden = !showTools;
    $('apply-actions').hidden = !showTools;
    $('settings-hint').hidden = !showTools;
    $('model-panel').hidden = !(qwen && phase === 'list');
    $('fallback-pending').hidden = !(qwen && phase === 'fallback');
    $('preset-model').textContent = assistant.presetModel;
    const savedNote = $('saved-model-note');
    if (savedModel) {
      savedNote.hidden = false;
      savedNote.textContent = qwen
        ? `已保存模型：${savedModel}。打开或切换时不会改成预设，预设只在列表读取失败后出现。`
        : `已保存模型：${savedModel}。不会写入千问模型。`;
    } else {
      savedNote.hidden = true;
      savedNote.textContent = '';
    }
    const inherited = $('inherited-region-hint');
    const changeRegion = $('settings-change-region');
    if (qwen && region && !panel) {
      inherited.hidden = false;
      inherited.textContent = `将沿用您已选择的地区：${assistant.regionLabel(region) || region}。这不是凭密钥自动识别。`;
      changeRegion.hidden = false;
    } else {
      inherited.hidden = true;
      inherited.textContent = '';
      changeRegion.hidden = true;
    }
    const addressHint = $('address-auto-hint');
    const addressDetail = $('official-address-detail');
    if (qwen && region && !panel) {
      addressHint.hidden = false;
      addressHint.textContent = official
        ? '官方地址已按通义千问和已选择的地区自动配置，无需手填。完整地址在高级设置里。'
        : '这个地区还不能生成不带工作空间的官方地址。请填写工作空间后再连接和发送。';
    } else if (!qwen) {
      addressHint.hidden = false;
      addressHint.textContent = '官方地址已按该厂商自动配置，无需手填。完整地址在高级设置里。';
    } else {
      addressHint.hidden = true;
      addressHint.textContent = '';
    }
    if (qwen && official) {
      addressDetail.hidden = false;
      addressDetail.textContent = `当前自动配置的对话地址：${official}`;
    } else if (!qwen && item?.protocols?.ai?.url) {
      addressDetail.hidden = false;
      addressDetail.textContent = `AI 学伴：${item.protocols.ai.url}。游戏助手：${item.protocols.game.url || ''}。`;
    } else {
      addressDetail.hidden = true;
      addressDetail.textContent = '';
    }
    if (phase === 'list') fillModelSelect();
    $('model-source-hint').textContent = phase === 'list' ? listNote : '';
    $('settings-connect').disabled = phase === 'loading';
    $('settings-continue').disabled = phase === 'loading';
    $('settings-ai-fields').hidden = $('settings-ai-mode').value !== 'custom';
    $('settings-game-fields').hidden = $('settings-game-mode').value !== 'custom';
    routeSignature = currentRouteSignature();
    const configured = Boolean(item?.apiKeyConfigured);
    const publicActive = qwen && source === 'public' && configured && !typedKey();
    const publicCleared = qwen && source === 'cleared' && !configured && sitePublishesKey();
    $('settings-lede').textContent = publicActive
      ? '站点已放入公开的百炼默认配置。它还没有连接。AI 学伴和游戏助手共用这份内存配置；核磁仍使用复制提问。'
      : '填写密钥并连接，成功获取列表后选择模型。AI 学伴和游戏助手共用配置；核磁仍使用复制提问。';
    $('settings-key').placeholder = publicActive
      ? '留空沿用站点公开默认密钥'
      : '在此页填写，刷新或关闭后需重填';
    $('settings-key-hint').textContent = publicActive
      ? '留空表示继续使用站点公开默认密钥。另填的密钥只留在这次页面内存，不写入浏览器存储。不会向多个地区传递密钥。'
      : '你另填的密钥只留在这次打开的页面内存。刷新或关闭后消失。不写入浏览器存储，也不送到本站服务器。不会向多个地区传递密钥。';
    $('settings-key-status').textContent = publicActive
      ? '正在使用站点公开的默认密钥。输入框不回显。另填一把密钥会代替它，只在这次打开的页面里有效。'
      : publicCleared
        ? '这次页面里的百炼配置已清掉。刷新会重新载入站点公开的默认密钥。'
        : configured && !typedKey()
          ? '已留在这次打开的页面内存里。刷新或关闭后消失。输入框保持空白，不回显密钥。'
          : '尚未填写密钥';
    $('settings-status').textContent = publicActive
      ? '正在使用站点发布时写入的公开百炼默认密钥。它在页面源码里，任何人都能读到，不是保密。刷新会重新载入这份默认值。你在本页另填的密钥只留在这次内存，不写入浏览器存储。'
      : publicCleared
        ? '这次页面里的百炼配置已清掉。刷新会重新载入站点公开的默认密钥。你另填的密钥不会写入浏览器存储。'
        : qwen
          ? '你另填的密钥只留在这次打开的页面内存。刷新或关闭后消失。不写入浏览器存储，也不送到本站。'
          : '密钥只留在这次打开的页面内存。其他厂商不预填千问模型。';
    if (savedModel && publicActive) {
      savedNote.hidden = false;
      savedNote.textContent = `站点默认模型：${savedModel}。标识校验通过，预设（未验证权限），不是已连接。`;
    }
    $('settings-continue').textContent = publicHeld
      ? (phase === 'workspace' ? '使用这个工作空间' : '使用这个地区')
      : '继续连接';
    $('connect-hint').textContent = publicActive
      ? '默认密钥已在这次页面内存。点连接才会请求模型列表。打开页面时不会自动连接，也不会调用模型。'
      : '请先填写密钥，再点连接。成功取得列表后才出现可选模型。无法根据密钥自动判断地区：曾明确选择过的地区会沿用，否则请补选。不会默认北京，也不会先出现「识别中」。';
    $('settings-token-status').textContent = '纯静态页面不使用访问口令，也不会把口令发给本站。';
  }

  function paint() {
    saved = assistant.view();
    const item = record();
    $('settings-key').value = '';
    $('settings-address').value = item?.enteredBaseUrl || '';
    $('settings-model').value = active === 'qwen' ? '' : (item?.enteredModel || '');
    if (active === 'qwen') $('settings-model').value = '';
    $('settings-region').value = active === 'qwen' ? (item?.region || '') : '';
    $('settings-workspace').value = active === 'qwen' ? (item?.workspaceId || '') : '';
    const aiCustom = Boolean(item?.protocols?.ai?.model || item?.protocols?.ai?.baseUrl);
    const gameCustom = Boolean(item?.protocols?.game?.model || item?.protocols?.game?.baseUrl);
    $('settings-ai-mode').value = aiCustom ? 'custom' : 'inherit';
    $('settings-game-mode').value = gameCustom ? 'custom' : 'inherit';
    $('settings-ai-address').value = item?.protocols?.ai?.baseUrl || '';
    $('settings-ai-model').value = item?.protocols?.ai?.model || '';
    $('settings-game-address').value = item?.protocols?.game?.baseUrl || '';
    $('settings-game-model').value = item?.protocols?.game?.model || '';
    $('settings-token').value = '';
    if (active === 'qwen' && item?.enteredModel && phase !== 'list' && phase !== 'fallback') {
      $('settings-model').value = '';
    }
    render();
  }

  function mark() {
    dirty = true;
  }

  function onSecretChanged() {
    const hadList = phase === 'loading' || phase === 'list' || phase === 'fallback';
    cancelInflight(hadList ? RECONNECT : '');
    mark();
    render();
  }

  function onRouteChanged(event) {
    const advanced = $('settings-advanced');
    if (event?.target && advanced.contains(event.target) && advanced.open && !advanced.hidden) advancedHeld = true;
    const hadList = phase === 'loading' || phase === 'list' || phase === 'fallback';
    cancelInflight(hadList ? RECONNECT : '');
    mark();
    render();
  }

  function onProtocolModeChanged(event) {
    if (currentRouteSignature() !== routeSignature) onRouteChanged(event);
    else {
      mark();
      render();
    }
  }

  function chosenModel() {
    const custom = $('settings-model').value.trim();
    if (active !== 'qwen') return custom;
    if (custom) return custom;
    if (phase === 'list') return $('settings-model-select').value.trim();
    if (phase === 'fallback') return assistant.presetModel;
    return record()?.enteredModel || '';
  }

  function draft(model) {
    const custom = (mode, address, modelName) => mode === 'custom'
      ? { baseUrl: address.trim(), model: modelName.trim() }
      : { baseUrl: '', model: '' };
    const body = {
      baseUrl: addressValue(),
      model,
      protocols: {
        ai: custom($('settings-ai-mode').value, $('settings-ai-address').value, $('settings-ai-model').value),
        game: custom($('settings-game-mode').value, $('settings-game-address').value, $('settings-game-model').value),
      },
    };
    const key = typedKey();
    if (key) body.apiKey = key;
    if (rebindConfirm) body.confirmKeyBinding = assistant.keyRebind;
    if (active === 'qwen') {
      body.region = regionValue();
      body.workspaceId = workspaceValue();
    }
    return body;
  }

  function enterFallback(message, permission) {
    phase = 'fallback';
    models = [];
    listNote = '';
    $('settings-advanced').open = false;
    setResult('ready', message);
    setPermission('ready', permission, true);
    render();
  }

  function blockPlan(plan) {
    if (plan.code === 'region') {
      phase = 'region';
      setResult('ready', plan.error);
      setPermission('', '', false);
      render();
      $('settings-region').focus();
      return;
    }
    if (plan.code === 'workspace') {
      phase = 'workspace';
      $('workspace-error').hidden = false;
      $('workspace-error').textContent = plan.error;
      setResult('error', plan.error);
      setPermission('', '', false);
      render();
      $('settings-workspace').focus();
      return;
    }
    if (active === 'qwen') {
      enterFallback(
        `${plan.error} 可以使用预设 ${assistant.presetModel}（未验证权限），或填写自定义模型名。这不是连接成功，也不证明该模型可调用。`,
        `回退：预设 ${assistant.presetModel}（未验证权限）。自定义模型入口可见；地址等高级项保持折叠。不是已连接，不是已验证可调用。`,
      );
      return;
    }
    phase = 'idle';
    setResult('error', plan.error);
    render();
  }

  async function startFetch(plan) {
    if (!assistant.listUrlAllowed(plan.url)) {
      enterFallback(
        '列表地址不在已记载的模型列表接口中，已拒绝请求。不会改用未记载的 /models。',
        `回退：预设 ${assistant.presetModel}（未验证权限）。不是已连接。`,
      );
      return;
    }
    generation += 1;
    const seq = generation;
    if (inflight) inflight.abort();
    inflight = new AbortController();
    const advanced = $('settings-advanced');
    if (advanced.open && !advanced.hidden) advancedHeld = true;
    phase = 'loading';
    models = [];
    listNote = '';
    setPermission('', '', false);
    setResult('pending', '正在只读请求已记载的模型列表。不会发起推理，也不会向多个地区传递密钥。');
    render();
    const key = keyForRequest();
    try {
      const response = await fetch(plan.url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: inflight.signal,
      });
      const body = await response.text();
      if (!assistant.isCurrentGeneration(seq, generation)) return;
      inflight = null;
      const redacted = body.split(key).join('[密钥已省略]');
      if (!response.ok) {
        let code = '';
        let message = '';
        try {
          const data = JSON.parse(redacted);
          code = data.code || data.error?.code || data.error?.type || '';
          message = data.message || data.error?.message || '';
        } catch { /* 非 JSON 时只报告状态码 */ }
        enterFallback(
          assistant.describeUpstreamFailure(response.status, String(code), String(message)),
          `列表未取得。预设 ${assistant.presetModel}（未验证权限）不是已连接，也不是已验证可调用。`,
        );
        return;
      }
      const parsed = assistant.parseListPayload(plan.source, redacted);
      if (!assistant.isCurrentGeneration(seq, generation)) return;
      if (!parsed.ok) {
        const authLike = /invalid_api_key|InvalidApiKey/i.test(parsed.code || '');
        enterFallback(
          authLike
            ? assistant.describeUpstreamFailure(response.status, parsed.code || '', parsed.error || '')
            : `列表响应无法按文档使用：${parsed.error} 不能称为已连接，也没有做推理。`,
          `列表未取得。预设 ${assistant.presetModel}（未验证权限）不是已连接。`,
        );
        return;
      }
      phase = 'list';
      models = parsed.models;
      const pageNote = parsed.partial ? ' 本次只读取了第一页，没有自动翻页。' : '';
      const emptyNote = parsed.models.length
        ? ''
        : ' 这次响应里没有可展示的模型。空列表不是预设，也不证明密钥没有权限。';
      listNote = `${plan.note}${pageNote}${emptyNote}`;
      setResult('ok', '已取得这次的模型列表。这只说明列表接口返回了记录，不是已经做过推理，也不能称为已验证可调用。');
      setPermission('ok', listNote, true);
      render();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (!assistant.isCurrentGeneration(seq, generation)) return;
      inflight = null;
      enterFallback(
        assistant.networkFailure,
        `列表未取得。预设 ${assistant.presetModel}（未验证权限）不是已连接，也不是已验证可调用。`,
      );
    }
  }

  function connectFromForm() {
    if (!keyForRequest()) {
      $('settings-key').setAttribute('aria-invalid', 'true');
      setResult('error', '请填写 API 密钥后再连接。本页不回显、不保存到浏览器存储，也不会把密钥发到本站。');
      $('settings-key').focus();
      return;
    }
    $('settings-key').setAttribute('aria-invalid', 'false');
    if (active !== 'qwen') {
      phase = 'manual';
      setResult('ready', '此厂商没有已纳入本次实现的官方模型列表请求，因此不会编造列表，也不会把密钥发出。请自行填写模型名称。这不是已连接，也没有验证权限。');
      setPermission('', '', false);
      render();
      $('settings-model').focus();
      return;
    }
    if (!regionValue()) {
      phase = 'region';
      $('region-error').hidden = true;
      setResult('ready', '请补选密钥所在地区。无法根据密钥自动判断地区，不会默认北京，也不会向多个地区传递密钥。');
      setPermission('', '', false);
      render();
      $('settings-region').focus();
      return;
    }
    const plan = assistant.listPlan({
      region: regionValue(),
      workspaceId: workspaceValue(),
      customUrl: addressValue(),
    });
    if (!plan.ok) {
      blockPlan(plan);
      return;
    }
    $('workspace-error').hidden = true;
    $('region-error').hidden = true;
    startFetch(plan);
  }

  function sitePublishesKey() {
    return Boolean(publication && publication.state !== 'absent' && publication.state !== 'invalid');
  }

  function applyPublicSelection() {
    const region = regionValue();
    const workspace = workspaceValue();
    const url = assistant.chatUrl({ region, workspaceId: workspace, customUrl: '' });
    if (!url) {
      phase = 'workspace';
      $('workspace-error').hidden = false;
      $('workspace-error').textContent = '这个地区还要工作空间才能生成地址。请只填写工作空间，不会改试其他地区。';
      setResult('error', '这个地区还要工作空间才能生成地址。请只填写工作空间，不会改试其他地区。');
      render();
      $('settings-workspace').focus();
      return;
    }
    try {
      assistant.saveVendor('qwen', {
        apiKey: publicHeld.key,
        region,
        workspaceId: workspace,
        model: publicHeld.model,
      });
      publicHeld = null;
      source = 'public';
      phase = 'idle';
      dirty = false;
      paint();
      const model = record()?.enteredModel || '';
      setResult('ok', `已按你选择的地区把站点公开密钥放进这次页面内存。模型 ${model} 是预设（未验证权限）。尚未连接，没有读取列表，也没有调用模型。`);
    } catch (error) {
      setResult('error', error.message || '公开配置没有放进页面内存。');
    }
  }

  function continueConnect() {
    if (!regionValue()) {
      $('region-error').hidden = false;
      $('region-error').textContent = '请补选密钥所在地区后再继续。';
      $('settings-region').focus();
      setResult('error', '请补选密钥所在地区后再继续。');
      return;
    }
    $('region-error').hidden = true;
    if (publicHeld) {
      applyPublicSelection();
      return;
    }
    connectFromForm();
  }

  function save() {
    const aiMode = $('settings-ai-mode').value;
    const gameMode = $('settings-game-mode').value;
    const ai = draft('').protocols.ai;
    const game = draft('').protocols.game;
    if (aiMode === 'custom' && !ai.baseUrl && !ai.model) {
      setResult('error', 'AI 学伴选择了单独设置，但地址和模型都是空的。请填写覆盖项，或改回继承共用。');
      return;
    }
    if (gameMode === 'custom' && !game.baseUrl && !game.model) {
      setResult('error', '游戏助手选择了单独设置，但地址和模型都是空的。请填写覆盖项，或改回继承共用。');
      return;
    }
    const model = chosenModel();
    if (active === 'qwen' && phase === 'list' && !model) {
      setResult('error', '请先从这次取得的列表中选择模型，或在高级设置里填写自定义模型名。');
      return;
    }
    try {
      const typed = Boolean(typedKey());
      const rebound = rebindConfirm;
      assistant.saveVendor(active, draft(model));
      const usedPreset = active === 'qwen' && phase === 'fallback' && model === assistant.presetModel && !$('settings-model').value.trim();
      dirty = false;
      if (rebound) source = 'cleared';
      else if (typed) source = 'personal';
      const keptPhase = phase;
      paint();
      phase = keptPhase;
      render();
      $('settings-key').value = '';
      const presetNote = usedPreset
        ? `已把预设 ${assistant.presetModel} 留在这次页面内存。它是预设（未验证权限），不是已连接，也没有验证密钥权限。`
        : '没有连接供应商，不能当作已经连通。';
      const refreshNote = rebound
        ? '已按新地址留下配置，原来的密钥没有带到新地址。'
        : source === 'public' && !typed
          ? '刷新会重新载入站点公开的默认密钥。'
          : '你另填的密钥只留在这次页面内存，刷新或关闭后消失，不写入浏览器存储。';
      setResult('ok', `只保存在这次打开的页面内存里。${presetNote} ${refreshNote}`);
      render();
    } catch (error) {
      if (error.code === 'upstream-key-rebinding') {
        $('settings-rebind-dialog').showModal();
        $('settings-rebind-cancel').focus();
        return;
      }
      setResult('error', error.message || '配置没有留在页面内存里。');
    }
  }

  function activate(id, focusButton) {
    advancedHeld = false;
    generation += 1;
    if (inflight) inflight.abort();
    inflight = null;
    phase = 'idle';
    models = [];
    listNote = '';
    active = id;
    dirty = false;
    paint();
    if (id === 'qwen' && publicHeld) {
      phase = publicHeld.state === 'needs-workspace' ? 'workspace' : 'region';
      if (publicHeld.region) $('settings-region').value = publicHeld.region;
      render();
    }
    setResult('idle', id === 'qwen' && publicHeld
      ? '站点公开密钥还没有放进页面内存。请先补全地区或工作空间。不会向多个地区试探，也不会现在连接。'
      : id === 'qwen'
      ? '尚未连接。填写密钥并连接，成功获取列表后选择模型。'
      : '已切换厂商，上次连接与列表已取消。不会写入千问模型。请填写该厂商的模型名称和密钥。');
    setPermission('', '', false);
    if (focusButton) document.querySelector(`[data-settings-vendor="${id}"]`)?.focus();
  }

  function trapDialog(dialog) {
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !dialog.open) return;
      const items = [...dialog.querySelectorAll('button, a, input, select, textarea')].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !dialog.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) {
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
    if (!dirty) { next(); return; }
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
  $('settings-key').addEventListener('input', onSecretChanged);
  ['settings-region'].forEach((id) => $(id).addEventListener('change', onRouteChanged));
  ['settings-workspace', 'settings-address', 'settings-ai-address', 'settings-game-address'].forEach((id) => {
    $(id).addEventListener('input', onRouteChanged);
    $(id).addEventListener('change', onRouteChanged);
  });
  ['settings-model', 'settings-model-select', 'settings-ai-model', 'settings-game-model', 'settings-token'].forEach((id) => {
    $(id).addEventListener('input', () => { mark(); render(); });
  });
  ['settings-ai-mode', 'settings-game-mode'].forEach((id) => {
    $(id).addEventListener('change', onProtocolModeChanged);
  });
  $('settings-connect').addEventListener('click', connectFromForm);
  $('settings-continue').addEventListener('click', continueConnect);
  $('settings-change-region').addEventListener('click', () => {
    onRouteChanged();
    phase = 'region';
    setResult('ready', '请重新选择密钥所在地区。这不是凭密钥自动识别，也不会默认北京。');
    render();
    $('settings-region').focus();
  });
  $('settings-save').addEventListener('click', save);
  $('settings-clear').addEventListener('click', () => {
    $('settings-clear-copy').textContent = `将清除${names[active]}在这次页面内存中的密钥、地址、模型和覆盖项。使用该配置的 AI／游戏助手将暂不可用；课程和学习进度不受影响。`;
    $('settings-clear-dialog').showModal();
    $('settings-clear-cancel').focus();
  });
  $('settings-clear-cancel').addEventListener('click', () => $('settings-clear-dialog').close());
  $('settings-clear-confirm').addEventListener('click', () => {
    $('settings-clear-dialog').close();
    generation += 1;
    if (inflight) inflight.abort();
    inflight = null;
    assistant.clearVendor(active);
    phase = 'idle';
    models = [];
    publicHeld = null;
    const clearedPublic = active === 'qwen' && sitePublishesKey();
    source = clearedPublic ? 'cleared' : 'manual';
    activate(active, true);
    setResult('ok', clearedPublic
      ? '这次页面里的百炼配置已清除，助手暂不可用。刷新会重新载入站点公开的默认密钥；这次清除不会把它从发布页面里删掉。你另填的密钥不会写入浏览器存储。课程和学习进度不受影响。'
      : '此厂商配置已清除。它只从这次页面内存消失，没有读取或迁移旧的后端密钥。课程和学习进度不受影响。');
  });
  $('settings-rebind-cancel').addEventListener('click', () => {
    rebindConfirm = false;
    $('settings-rebind-dialog').close();
    $('settings-key').focus();
  });
  $('settings-rebind-clear').addEventListener('click', () => {
    rebindConfirm = true;
    $('settings-rebind-dialog').close();
    save();
    rebindConfirm = false;
  });
  $('settings-admin-cancel').addEventListener('click', () => $('settings-admin-dialog').close());
  $('settings-admin-submit').addEventListener('click', () => {
    $('settings-admin-token').value = '';
    $('settings-admin-dialog').close();
    setResult('error', '纯静态页面不使用管理口令。请直接在本页填写供应商密钥。');
  });
  $('settings-unsaved-keep').addEventListener('click', () => { pending = null; $('settings-unsaved-dialog').close(); });
  $('settings-unsaved-discard').addEventListener('click', () => {
    const next = pending;
    pending = null;
    dirty = false;
    advancedHeld = false;
    $('settings-unsaved-dialog').close();
    paint();
    if (next) next();
  });
  window.ATLAS_SETTINGS = {
    confirmLeave,
    reload() { paint(); },
  };

  function bootPublic() {
    publication = assistant.publicBailian();
    paint();
    if (!publication || publication.state === 'absent' || publication.state === 'invalid') {
      setResult('idle', '尚未连接。填写密钥并连接，成功获取列表后选择模型。密钥只留在这次打开的页面内存里，没有连接供应商。');
      return;
    }
    active = 'qwen';
    if (publication.state === 'ready') {
      assistant.saveVendor('qwen', {
        apiKey: publication.key,
        region: publication.region,
        workspaceId: publication.workspaceId,
        model: publication.model,
      });
      source = 'public';
      phase = 'idle';
      paint();
      setResult('ok', `已把站点公开的默认配置放进这次页面内存，AI 学伴和游戏助手会使用它。模型 ${publication.model} 通过了标识校验，状态是预设（未验证权限）。尚未连接，没有读取模型列表，也没有调用模型。`);
      return;
    }
    publicHeld = publication;
    phase = publication.state === 'needs-workspace' ? 'workspace' : 'region';
    paint();
    if (publication.region) $('settings-region').value = publication.region;
    render();
    setResult('ready', publication.state === 'needs-workspace'
      ? '站点公开配置写了地区，但还要工作空间才能生成地址。请只填写工作空间。不会改试其他地区，也不会现在连接。'
      : '站点带了公开密钥，但没有写明地区。请只选择一个地区。不会默认北京，也不会向多个地区试探。选好后点「使用这个地区」，才会放进页面内存；这不会连接，也不会读取列表。');
  }

  bootPublic();
})();
