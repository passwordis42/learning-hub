import {
  chatUrl,
  describeUpstreamFailure,
  isCurrentGeneration,
  listPlan,
  listUrlAllowed,
  NETWORK_FAILURE,
  parseListPayload,
  QWEN_PRESET_MODEL,
  regionKnown,
  regionLabel,
  regions as qwenRegionTable,
} from './bailian-list.mjs';

const vendorIds = Object.freeze(['openai', 'anthropic', 'deepseek', 'qwen']);
const protocols = Object.freeze(['ai', 'game']);
const vendors = {
  openai: { label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', paths: { ai: '/responses', game: '/chat/completions' } },
  anthropic: { label: 'Anthropic', defaultBase: 'https://api.anthropic.com/v1', paths: { ai: '/messages', game: '/messages' } },
  deepseek: { label: 'DeepSeek', defaultBase: 'https://api.deepseek.com', paths: { ai: '/chat/completions', game: '/chat/completions' } },
  qwen: { label: '通义千问', defaultBase: '', paths: { ai: '', game: '' } },
};
const KEY_REBIND = 'clear-key-for-new-upstream';

function emptyVendor() {
  return {
    apiKey: '',
    model: '',
    baseUrl: '',
    workspaceId: '',
    region: '',
    protocols: { ai: { model: '', baseUrl: '' }, game: { model: '', baseUrl: '' } },
    keyBinding: { origins: [] },
  };
}

function emptyState() {
  return { vendors: Object.fromEntries(vendorIds.map((id) => [id, emptyVendor()])) };
}

let state = emptyState();

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function modelName(value) {
  const model = text(value, 120);
  if (model && !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    throw Object.assign(new Error('模型名只能包含字母、数字和 . _ : / -。'), { field: 'model' });
  }
  return model;
}

function optionalUrl(value) {
  const raw = text(value, 300);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw Object.assign(new Error('服务地址无法解析。'), { field: 'baseUrl' }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error('服务地址只接受不带账号的 http 或 https。'), { field: 'baseUrl' });
  }
  return url.href;
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/$/, '')}/${suffix.replace(/^\//, '')}`;
}

function qwenUrl(vendor, protocol) {
  const custom = vendor.protocols[protocol].baseUrl || vendor.baseUrl;
  return chatUrl({ region: vendor.region, workspaceId: vendor.workspaceId, customUrl: custom });
}

function endpointOf(id, vendor, protocol) {
  if (id === 'qwen') return qwenUrl(vendor, protocol);
  const override = vendor.protocols[protocol].baseUrl;
  if (override) return override;
  return joinUrl(vendor.baseUrl || vendors[id].defaultBase, vendors[id].paths[protocol]);
}

function originsFor(id, vendor) {
  return [...new Set(protocols.map((protocol) => endpointOf(id, vendor, protocol)).filter(Boolean).map((url) => new URL(url).origin))].sort();
}

function sameOrigins(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeVendor(id, input = {}, previous = emptyVendor()) {
  if (!vendors[id]) throw new Error('未知的模型服务。');
  const suppliedKey = text(input.apiKey, 400);
  if (suppliedKey && /[\r\n]/.test(suppliedKey)) throw Object.assign(new Error('密钥格式无效。'), { field: 'apiKey' });
  const region = id === 'qwen'
    ? (input.region === undefined ? previous.region : text(input.region, 20))
    : '';
  if (id === 'qwen' && region && !regionKnown(region)) throw Object.assign(new Error('通义地区无效。'), { field: 'region' });
  const workspaceId = input.workspaceId === undefined ? previous.workspaceId : text(input.workspaceId, 80);
  if (workspaceId && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(workspaceId)) {
    throw Object.assign(new Error('工作空间标识无效。'), { field: 'workspaceId' });
  }
  const nextProtocols = {};
  for (const protocol of protocols) {
    const incoming = input.protocols?.[protocol] || {};
    const prior = previous.protocols[protocol];
    nextProtocols[protocol] = {
      model: incoming.model === undefined ? prior.model : modelName(incoming.model),
      baseUrl: incoming.baseUrl === undefined ? prior.baseUrl : optionalUrl(incoming.baseUrl),
    };
  }
  const draft = {
    model: input.model === undefined ? previous.model : modelName(input.model),
    baseUrl: input.baseUrl === undefined ? previous.baseUrl : optionalUrl(input.baseUrl),
    workspaceId,
    region,
    protocols: nextProtocols,
  };
  const nextOrigins = originsFor(id, draft);
  const previousOrigins = [...(previous.keyBinding?.origins || [])].sort();
  const originsChanged = Boolean(previous.apiKey) && !sameOrigins(previousOrigins, nextOrigins);
  if (originsChanged && !suppliedKey && input.confirmKeyBinding !== KEY_REBIND) {
    throw Object.assign(new Error('更换上游地址后，已填写的密钥不会继续使用。请重新输入密钥，或确认清除该厂商密钥。'), {
      code: 'upstream-key-rebinding',
      field: 'apiKey',
    });
  }
  const apiKey = suppliedKey || (originsChanged ? '' : previous.apiKey);
  return { ...draft, apiKey, keyBinding: { origins: apiKey ? nextOrigins : [] } };
}

function publicVendor(id) {
  const vendor = state.vendors[id];
  const view = {
    id,
    label: vendors[id].label,
    apiKeyConfigured: Boolean(vendor.apiKey),
    enteredModel: vendor.model,
    enteredBaseUrl: vendor.baseUrl,
    region: id === 'qwen' ? vendor.region : '',
    workspaceId: vendor.workspaceId,
    protocols: {
      ai: { ...vendor.protocols.ai },
      game: { ...vendor.protocols.game },
    },
  };
  for (const protocol of protocols) {
    const url = endpointOf(id, vendor, protocol);
    const model = vendor.protocols[protocol].model || vendor.model;
    view.protocols[protocol].configured = Boolean(vendor.apiKey && model && url && vendor.keyBinding.origins.includes(new URL(url).origin));
    view.protocols[protocol].url = url;
  }
  return view;
}

function prepare(course, vendorId) {
  if (!protocols.includes(course) || !vendors[vendorId]) return { ok: false, error: '不支持的课程或厂商。' };
  const vendor = state.vendors[vendorId];
  const url = endpointOf(vendorId, vendor, course);
  const model = vendor.protocols[course].model || vendor.model;
  if (vendorId === 'qwen' && !vendor.protocols[course].baseUrl && !vendor.baseUrl && !vendor.region) {
    return { ok: false, code: 'region', error: '请先选择通义密钥所在地区。不会默认北京，也不会向多个地区试探。' };
  }
  if (vendorId === 'qwen' && !url) {
    return { ok: false, code: 'workspace', error: '该地区需要工作空间才能生成接口，请填写后再发送。' };
  }
  if (!url || !model || !vendor.apiKey) {
    return { ok: false, code: 'unconfigured', error: '请先在助手设置里填写模型名称和 API 密钥。密钥只留在这次打开的页面内存里。' };
  }
  let origin = '';
  try { origin = new URL(url).origin; } catch { return { ok: false, error: '服务地址无法解析。' }; }
  if (!vendor.keyBinding.origins.includes(origin)) {
    return { ok: false, code: 'unbound', error: '当前地址和已填写的密钥不是同一次保存。请重新输入密钥。' };
  }
  return {
    ok: true,
    config: {
      id: vendorId,
      url,
      model,
      key: vendor.apiKey,
      workspace: vendor.workspaceId,
    },
  };
}

function installBridge() {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source === window || !event.source) return;
    const data = event.data;
    if (!data || data.type !== 'hub-assistant' || typeof data.nonce !== 'string' || data.nonce.length > 80) return;
    if (data.action === 'list' && protocols.includes(data.course)) {
      event.source.postMessage({
        type: 'hub-assistant-result',
        nonce: data.nonce,
        ok: true,
        providers: vendorIds.map((id) => {
          const item = publicVendor(id);
          return { id, label: item.label, model: item.protocols[data.course].model || item.enteredModel, configured: item.protocols[data.course].configured };
        }),
      }, event.origin);
      return;
    }
    if (data.action !== 'prepare' || !protocols.includes(data.course) || !vendors[data.vendor]) return;
    const result = prepare(data.course, data.vendor);
    event.source.postMessage({ type: 'hub-assistant-result', nonce: data.nonce, ...result }, event.origin);
  });
}

export const assistantMemory = {
  keyRebind: KEY_REBIND,
  vendorIds,
  presetModel: QWEN_PRESET_MODEL,
  regions: qwenRegionTable,
  listPlan,
  listUrlAllowed,
  parseListPayload,
  describeUpstreamFailure,
  networkFailure: NETWORK_FAILURE,
  isCurrentGeneration,
  regionLabel,
  chatUrl,
  peekKey(id) { return state.vendors[id]?.apiKey || ''; },
  reset() { state = emptyState(); },
  saveVendor(id, input) {
    state.vendors[id] = normalizeVendor(id, input, state.vendors[id]);
    return publicVendor(id);
  },
  clearVendor(id) {
    state.vendors[id] = emptyVendor();
    return publicVendor(id);
  },
  view() { return { vendors: vendorIds.map((id) => publicVendor(id)) }; },
  prepare,
  installBridge,
};

if (typeof window !== 'undefined') {
  installBridge();
  window.ATLAS_ASSISTANT = assistantMemory;
}
