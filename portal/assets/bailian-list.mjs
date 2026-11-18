/**
 * 通义千问（百炼）官方地址与只读列表。
 * 2026-11-18 只读核对公开文档，没有使用密钥，也没有发起付费推理：
 * - 模型列表：https://help.aliyun.com/zh/model-studio/list-models
 *   北京、新加坡、香港、东京的目录地址含 WorkspaceId；
 *   弗吉尼亚写为 https://dashscope-us.aliyuncs.com/api/v1/models 。
 *   该接口文案是平台目录，不是「仅返回该 Key 已授权模型」。
 * - 模型授权：https://help.aliyun.com/zh/model-studio/list-model-permissions
 *   文档只给出北京业务空间
 *   https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/models/permissions 。
 *   默认 authorization_scope=AUTHORIZABLE（可授权，不是已授权）。
 *   已授权推理须 authorization_scope=AUTHORIZED 且 action=INFERENCE。
 *   响应 output.permissions[].permissions.inference 表示调用权限标记，不是已经执行过推理。
 *   其他地域的权限地址文档没有给出，因此不套用。
 * - Base URL：https://help.aliyun.com/zh/model-studio/base-url
 *   共享域名：北京 dashscope.aliyuncs.com、新加坡 dashscope-intl.aliyuncs.com、
 *   弗吉尼亚 dashscope-us.aliyuncs.com、香港 cn-hongkong.dashscope.aliyuncs.com。
 *   东京没有共享 DashScope 域名，只有业务空间域名。
 * - 错误码：https://help.aliyun.com/zh/model-studio/error-code
 *   HTTP 401 / invalid_api_key 可能是密钥错误，也可能是密钥、地域与 Base URL 不匹配。
 *
 * 不使用 compatible-mode 下的 /models。公开列表文档没有收录该路径，
 * 无认证预检即使带有 CORS 头也不能成为采用理由。
 * 浏览器携带 Authorization 的跨域是否可用，文档没有保证。
 */

export const QWEN_PRESET_MODEL = 'qwen3.7-flash';

export const regions = Object.freeze({
  beijing: Object.freeze({
    label: '北京',
    id: 'cn-beijing',
    list: 'permissions',
    sharedHost: 'dashscope.aliyuncs.com',
  }),
  singapore: Object.freeze({
    label: '新加坡',
    id: 'ap-southeast-1',
    list: 'catalog-workspace',
    sharedHost: 'dashscope-intl.aliyuncs.com',
  }),
  hongkong: Object.freeze({
    label: '香港',
    id: 'cn-hongkong',
    list: 'catalog-workspace',
    sharedHost: 'cn-hongkong.dashscope.aliyuncs.com',
  }),
  virginia: Object.freeze({
    label: '弗吉尼亚',
    id: 'us-east-1',
    list: 'catalog-shared',
    sharedHost: 'dashscope-us.aliyuncs.com',
  }),
  tokyo: Object.freeze({
    label: '东京',
    id: 'ap-northeast-1',
    list: 'catalog-workspace',
    sharedHost: '',
  }),
});

const WORKSPACE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

export function regionKnown(region) {
  return Object.hasOwn(regions, region);
}

export function regionLabel(region) {
  return regions[region]?.label || '';
}

function workspaceHost(workspaceId, regionId) {
  return `${workspaceId}.${regionId}.maas.aliyuncs.com`;
}

export function chatUrl({ region = '', workspaceId = '', customUrl = '' } = {}) {
  if (customUrl) return customUrl;
  const spec = regions[region];
  if (!spec) return '';
  if (workspaceId && WORKSPACE_RE.test(workspaceId)) {
    return `https://${workspaceHost(workspaceId, spec.id)}/compatible-mode/v1/chat/completions`;
  }
  if (!spec.sharedHost) return '';
  return `https://${spec.sharedHost}/compatible-mode/v1/chat/completions`;
}

export function listPlan({ region = '', workspaceId = '', customUrl = '' } = {}) {
  if (customUrl) {
    return {
      ok: false,
      code: 'custom-address',
      error: '已填写自定义地址。公开文档没有给出该地址对应的模型列表接口，因此不会向它追加未记载的 /models，也不会把密钥发到多个地址做探测。',
    };
  }
  if (!region) {
    return {
      ok: false,
      code: 'region',
      error: '请补选密钥所在地区。无法根据密钥自动判断地区，不会默认北京，也不会向多个地区传递密钥。',
    };
  }
  const spec = regions[region];
  if (!spec) return { ok: false, code: 'region', error: '通义地区无效。' };
  const workspace = workspaceId.trim();
  if (workspace && !WORKSPACE_RE.test(workspace)) {
    return { ok: false, code: 'workspace', error: '工作空间标识无效。' };
  }
  if (spec.list !== 'catalog-shared' && !workspace) {
    return {
      ok: false,
      code: 'workspace',
      error: spec.sharedHost
        ? '该地区的已记载模型列表地址需要工作空间。请填写后再连接。对话仍可使用该地区的共享域名，但缺少工作空间时不会改用未记载的列表接口。'
        : '该地区需要工作空间才能生成接口，请填写后再连接。',
    };
  }
  if (spec.list === 'permissions') {
    const url = new URL(`https://${workspaceHost(workspace, spec.id)}/api/v1/models/permissions`);
    url.searchParams.set('authorization_scope', 'AUTHORIZED');
    url.searchParams.set('action', 'INFERENCE');
    url.searchParams.set('page_no', '1');
    url.searchParams.set('page_size', '100');
    return {
      ok: true,
      source: 'authorized',
      url: url.href,
      note: '来源：已授权列表（authorization_scope=AUTHORIZED 且 action=INFERENCE）。公开文档目前只给出北京业务空间的该接口。permissions.inference 只是授权标记，不是这次已经执行过推理，也不是已验证可调用。',
    };
  }
  const host = spec.list === 'catalog-shared' ? spec.sharedHost : workspaceHost(workspace, spec.id);
  const url = new URL(`https://${host}/api/v1/models`);
  url.searchParams.set('page_no', '1');
  url.searchParams.set('page_size', '100');
  return {
    ok: true,
    source: 'catalog',
    url: url.href,
    note: '来源：平台目录（GET /api/v1/models）。这不是该密钥的已授权列表。已授权查询的文档目前只写了北京业务空间，所以其他地域不套用该接口。目录也不等于推理成功，不是已验证可调用。',
  };
}

export function listUrlAllowed(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return false;
  const entries = [...url.searchParams.entries()];
  const exact = (pairs) => entries.length === pairs.length && pairs.every(([key, value], index) => entries[index][0] === key && entries[index][1] === value);
  const workspace = (region) => new RegExp(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.${region}\\.maas\\.aliyuncs\\.com$`).test(url.hostname);
  if (url.pathname === '/api/v1/models/permissions' && workspace('cn-beijing')) {
    return exact([
      ['authorization_scope', 'AUTHORIZED'],
      ['action', 'INFERENCE'],
      ['page_no', '1'],
      ['page_size', '100'],
    ]);
  }
  const catalogHost = url.hostname === 'dashscope-us.aliyuncs.com'
    || ['ap-southeast-1', 'cn-hongkong', 'ap-northeast-1'].some((region) => workspace(region));
  if (url.pathname === '/api/v1/models' && catalogHost) {
    return exact([['page_no', '1'], ['page_size', '100']]);
  }
  return false;
}

function modelId(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return model && MODEL_RE.test(model) && model.length <= 120 ? model : '';
}

export function parseListPayload(source, bodyText) {
  let data;
  try { data = JSON.parse(bodyText); } catch {
    return { ok: false, error: '上游返回的不是 JSON，不能当作模型列表。' };
  }
  if (!data || typeof data !== 'object' || data.success !== true) {
    const code = typeof data?.code === 'string' ? data.code : '';
    const message = typeof data?.message === 'string' ? data.message : '';
    return {
      ok: false,
      code,
      error: [code, message].filter(Boolean).join('：') || '上游没有返回成功的列表。',
    };
  }
  const output = data.output && typeof data.output === 'object' ? data.output : {};
  if (source === 'authorized') {
    if (!Array.isArray(output.permissions)) {
      return { ok: false, error: '已授权接口的响应里没有 permissions 数组，不能当作已授权列表。' };
    }
    const models = [];
    for (const row of output.permissions) {
      if (row?.permissions?.inference !== true) continue;
      const id = modelId(row.model);
      if (id && !models.includes(id)) models.push(id);
    }
    return {
      ok: true,
      source: 'authorized',
      models,
      total: Number(output.total) || output.permissions.length,
      partial: Number(output.total) > output.permissions.length,
    };
  }
  if (!Array.isArray(output.models)) {
    return { ok: false, error: '平台目录响应里没有 models 数组，不能当作目录。' };
  }
  const models = [];
  for (const row of output.models) {
    const id = modelId(row?.model);
    if (id && !models.includes(id)) models.push(id);
  }
  return {
    ok: true,
    source: 'catalog',
    models,
    total: Number(output.total) || output.models.length,
    partial: Number(output.total) > output.models.length,
  };
}

export function isCurrentGeneration(started, current) {
  return started === current;
}

export function describeUpstreamFailure(status, code, message) {
  const cleanCode = typeof code === 'string' ? code.slice(0, 80) : '';
  const cleanMessage = typeof message === 'string' ? message.replace(/\s+/g, ' ').slice(0, 180) : '';
  const detail = [cleanCode, cleanMessage].filter(Boolean).join('：');
  const authLike = status === 401 || /invalid_api_key|InvalidApiKey/i.test(cleanCode);
  if (authLike) {
    return `上游返回 HTTP ${status || '错误'}${detail ? `（${detail}）` : ''}。官方错误码说明里，401 / invalid_api_key 可能是密钥填写错误，也可能是密钥、地域和地址不匹配。这次不能断定密钥无效，不是已连接，也没有做推理。`;
  }
  return `上游返回 HTTP ${status}${detail ? `（${detail}）` : ''}。这是上游的 HTTP 响应，不是「网络或跨域访问失败」。这次没有取得可用列表，不能称为已连接，也没有做推理。`;
}

export const NETWORK_FAILURE = '网络或跨域访问失败。浏览器没有给出可读的上游 HTTP 响应，因此不能判断是网络中断还是对方拒绝跨域，也不能据此说密钥无效。这次没有取得模型列表，不能称为已连接，也没有做推理。';
