import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertResolvedUpstream, assertSafeUpstream } from './safe-upstream.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLEAR_CONFIRMATION = 'clear-assistant-configuration';
export const CLEAR_EFFECT = '已删除保存在本机的助手配置和密钥。AI 学伴与游戏助手在重新保存配置前都不能调用模型。核磁课程不受影响。此操作不会读取或迁移旧的 .env。';

const vendors = {
  openai: {
    label: 'OpenAI',
    defaultBase: 'https://api.openai.com/v1',
    paths: { ai: '/responses', game: '/chat/completions' },
  },
  anthropic: {
    label: 'Claude',
    defaultBase: 'https://api.anthropic.com/v1',
    paths: { ai: '/messages', game: '/messages' },
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBase: 'https://api.deepseek.com',
    paths: { ai: '/chat/completions', game: '/chat/completions' },
  },
  qwen: {
    label: 'Qwen',
    defaultBase: '',
    paths: { ai: '', game: '' },
  },
};

const qwenRegions = {
  beijing: 'cn-beijing',
  singapore: 'ap-southeast-1',
  hongkong: 'cn-hongkong',
  virginia: 'us-east-1',
  tokyo: 'ap-northeast-1',
};

const emptyVendor = () => ({
  apiKey: '',
  model: '',
  baseUrl: '',
  workspaceId: '',
  region: '',
  protocols: { ai: { model: '', baseUrl: '' }, game: { model: '', baseUrl: '' } },
});

export function emptyConfig() {
  return {
    version: 1,
    revision: 0,
    accessToken: '',
    vendors: Object.fromEntries(Object.keys(vendors).map((id) => [id, emptyVendor()])),
  };
}

export function configFilePath() {
  return process.env.ASSISTANT_CONFIG_PATH || path.join(root, 'server/secrets/assistant-config.json');
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function modelName(value) {
  const model = text(value, 120);
  if (model && !/^[A-Za-z0-9._:/-]+$/.test(model)) throw new Error('模型名只能包含字母、数字和 . _ : / -。');
  return model;
}

function optionalUrl(value) {
  const raw = text(value, 300);
  return raw ? assertSafeUpstream(raw) : '';
}

function normalizeVendor(id, input = {}, previous = emptyVendor()) {
  const spec = vendors[id];
  if (!spec) throw new Error('未知的模型服务。');
  const apiKey = text(input.apiKey, 400) || previous.apiKey;
  if (apiKey && /[\r\n]/.test(apiKey)) throw new Error('密钥格式无效。');
  const region = text(input.region, 20) || previous.region || (id === 'qwen' ? 'beijing' : '');
  if (id === 'qwen' && !Object.hasOwn(qwenRegions, region)) throw new Error('通义地区无效。');
  const workspaceId = text(input.workspaceId, 80) || previous.workspaceId;
  if (workspaceId && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(workspaceId)) throw new Error('工作空间标识无效。');
  const protocols = {};
  for (const protocol of ['ai', 'game']) {
    const incoming = input.protocols?.[protocol] || {};
    const prior = previous.protocols?.[protocol] || { model: '', baseUrl: '' };
    protocols[protocol] = {
      model: incoming.model === undefined ? prior.model : modelName(incoming.model),
      baseUrl: incoming.baseUrl === undefined ? prior.baseUrl : optionalUrl(incoming.baseUrl),
    };
  }
  return {
    apiKey,
    model: input.model === undefined ? previous.model : modelName(input.model),
    baseUrl: input.baseUrl === undefined ? previous.baseUrl : optionalUrl(input.baseUrl),
    workspaceId,
    region,
    protocols,
  };
}

export function normalizeConfig(input, previous = emptyConfig()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象。');
  const next = emptyConfig();
  next.revision = previous.revision + 1;
  const token = text(input.accessToken, 200);
  next.accessToken = token || previous.accessToken;
  if (next.accessToken && next.accessToken.length < 32) throw new Error('访问口令至少需要 32 个字符。');
  for (const id of Object.keys(vendors)) {
    next.vendors[id] = normalizeVendor(id, input.vendors?.[id] || {}, previous.vendors[id]);
  }
  return next;
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/$/, '')}/${suffix.replace(/^\//, '')}`;
}

export function resolvedEndpoint(config, vendorId, protocol) {
  const vendor = config.vendors[vendorId];
  const spec = vendors[vendorId];
  const override = vendor.protocols[protocol].baseUrl;
  if (override) return assertSafeUpstream(override);
  if (vendorId === 'qwen') return '';
  const base = vendor.baseUrl || spec.defaultBase;
  return assertSafeUpstream(joinUrl(base, spec.paths[protocol]));
}

export function resolvedModel(config, vendorId, protocol) {
  return config.vendors[vendorId].protocols[protocol].model || config.vendors[vendorId].model;
}

function vendorReady(config, vendorId, protocol) {
  const vendor = config.vendors[vendorId];
  return Boolean(vendor.apiKey && resolvedModel(config, vendorId, protocol));
}

export function publicConfig(config) {
  return {
    save: 'PUT /api/assistant-config，且请求体必须包含 save: true。密钥只写入本机，响应和状态接口都不返回密钥。',
    clear: `POST /api/assistant-config/clear，请求体必须包含 confirm: "${CLEAR_CONFIRMATION}"。${CLEAR_EFFECT}`,
    vendors: Object.entries(vendors).map(([id, spec]) => ({
      id,
      label: spec.label,
      model: config.vendors[id].model,
      baseUrl: config.vendors[id].baseUrl || spec.defaultBase,
      region: id === 'qwen' ? config.vendors[id].region || 'beijing' : '',
      apiKeyConfigured: Boolean(config.vendors[id].apiKey),
      workspaceConfigured: Boolean(config.vendors[id].workspaceId),
      protocols: {
        ai: {
          runtimeId: id === 'anthropic' ? 'claude' : id,
          model: resolvedModel(config, id, 'ai'),
          baseUrl: resolvedEndpoint(config, id, 'ai'),
          configured: vendorReady(config, id, 'ai'),
        },
        game: {
          runtimeId: id,
          model: resolvedModel(config, id, 'game'),
          baseUrl: id === 'qwen' ? '' : resolvedEndpoint(config, id, 'game'),
          configured: vendorReady(config, id, 'game'),
        },
      },
    })),
    accessTokenConfigured: Boolean(config.accessToken),
  };
}

export function toAiEnv(config) {
  const env = { TUTOR_HOST: '127.0.0.1' };
  const use = (id, keyName, modelName, baseName) => {
    if (!vendorReady(config, id, 'ai')) return;
    env[keyName] = config.vendors[id].apiKey;
    env[modelName] = resolvedModel(config, id, 'ai');
    const endpoint = resolvedEndpoint(config, id, 'ai');
    if (endpoint) env[baseName] = endpoint;
  };
  use('openai', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL');
  use('anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL');
  use('deepseek', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL');
  if (vendorReady(config, 'qwen', 'ai')) {
    env.DASHSCOPE_API_KEY = config.vendors.qwen.apiKey;
    env.QWEN_MODEL = resolvedModel(config, 'qwen', 'ai');
    env.DASHSCOPE_REGION = qwenRegions[config.vendors.qwen.region || 'beijing'];
    if (config.vendors.qwen.workspaceId) env.DASHSCOPE_WORKSPACE_ID = config.vendors.qwen.workspaceId;
    const endpoint = config.vendors.qwen.protocols.ai.baseUrl || config.vendors.qwen.baseUrl;
    if (endpoint) env.DASHSCOPE_BASE_URL = endpoint;
  }
  if (config.vendors.anthropic.workspaceId) env.ANTHROPIC_WORKSPACE_ID = config.vendors.anthropic.workspaceId;
  if (config.accessToken) env.TUTOR_ACCESS_TOKEN = config.accessToken;
  return env;
}

export function toGameEnv(config) {
  const env = {};
  const use = (id, keyName, modelName, baseName) => {
    if (!vendorReady(config, id, 'game')) return;
    env[keyName] = config.vendors[id].apiKey;
    env[modelName] = resolvedModel(config, id, 'game');
    const endpoint = resolvedEndpoint(config, id, 'game');
    if (endpoint) env[baseName] = endpoint;
  };
  use('openai', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL');
  use('anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL');
  use('deepseek', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL');
  if (vendorReady(config, 'qwen', 'game')) {
    env.DASHSCOPE_API_KEY = config.vendors.qwen.apiKey;
    env.QWEN_MODEL = resolvedModel(config, 'qwen', 'game');
    env.QWEN_REGION = config.vendors.qwen.region || 'beijing';
    if (config.vendors.qwen.workspaceId) env.QWEN_WORKSPACE_ID = config.vendors.qwen.workspaceId;
    const endpoint = config.vendors.qwen.protocols.game.baseUrl || config.vendors.qwen.baseUrl;
    if (endpoint) env.QWEN_BASE_URL = endpoint;
  }
  return env;
}

async function confirmUpstreams(config) {
  for (const vendor of Object.values(config.vendors)) {
    if (vendor.baseUrl) await assertResolvedUpstream(vendor.baseUrl);
    for (const protocol of Object.values(vendor.protocols)) {
      if (protocol.baseUrl) await assertResolvedUpstream(protocol.baseUrl);
    }
  }
}

export async function loadConfig() {
  try {
    const parsed = JSON.parse(await readFile(configFilePath(), 'utf8'));
    const config = normalizeConfig(parsed, emptyConfig());
    config.revision = Number.isInteger(parsed.revision) ? parsed.revision : 1;
    await confirmUpstreams(config);
    return config;
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyConfig();
    if (error instanceof SyntaxError) return emptyConfig();
    throw error;
  }
}

async function writeConfig(config) {
  const file = configFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
  await rename(temporary, file);
}

export async function saveConfig(input) {
  if (input?.save !== true) throw Object.assign(new Error('保存配置必须显式传入 save: true。未写入任何密钥。'), { status: 400 });
  const next = normalizeConfig(input, await loadConfig());
  await confirmUpstreams(next);
  await writeConfig(next);
  return publicConfig(next);
}

export async function clearConfig(input) {
  if (input?.confirm !== CLEAR_CONFIRMATION) {
    throw Object.assign(new Error(`清除尚未执行。确认时请传入 confirm: "${CLEAR_CONFIRMATION}"。`), { status: 400, effect: CLEAR_EFFECT });
  }
  await rm(configFilePath(), { force: true });
  return { cleared: true, effect: CLEAR_EFFECT };
}
