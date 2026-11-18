import { chatUrl, QWEN_PRESET_MODEL, regionKnown } from './bailian-list.mjs';

const DEFAULT_PUBLIC_REGION = 'beijing';
const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
const WORKSPACE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function clean(value, limit) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > limit || /[\r\n]/.test(text)) return '';
  return text;
}

export function readPublicBailian(raw) {
  if (!raw || typeof raw !== 'object') return { state: 'absent' };
  const key = clean(raw.key, 400);
  if (!key) return { state: 'absent' };
  const regionText = clean(raw.region, 20);
  if (regionText && !regionKnown(regionText)) return { state: 'invalid' };
  const region = regionText || DEFAULT_PUBLIC_REGION;
  const modelText = clean(raw.model, 120);
  const modelValid = !modelText || (MODEL_RE.test(modelText) && modelText.length <= 120);
  if (!modelValid) return { state: 'invalid' };
  const model = modelText || QWEN_PRESET_MODEL;
  const workspaceText = clean(raw.workspaceId, 80);
  if (workspaceText && !WORKSPACE_RE.test(workspaceText)) return { state: 'invalid' };
  const url = chatUrl({ region, workspaceId: workspaceText, customUrl: '' });
  if (!url) return { state: 'needs-workspace', key, region, model };
  return {
    state: 'ready',
    key,
    region,
    model,
    workspaceId: workspaceText,
    url,
    verified: false,
  };
}

export function publicBailianFromEnv(env = {}) {
  const key = typeof env.LEARNING_HUB_PUBLIC_BAILIAN_KEY === 'string'
    ? env.LEARNING_HUB_PUBLIC_BAILIAN_KEY.trim()
    : '';
  if (!key || /[\r\n]/.test(key)) return null;
  return {
    key,
    region: (typeof env.LEARNING_HUB_PUBLIC_BAILIAN_REGION === 'string' ? env.LEARNING_HUB_PUBLIC_BAILIAN_REGION.trim() : '') || DEFAULT_PUBLIC_REGION,
    model: typeof env.LEARNING_HUB_PUBLIC_BAILIAN_MODEL === 'string' ? env.LEARNING_HUB_PUBLIC_BAILIAN_MODEL.trim() : '',
    workspaceId: typeof env.LEARNING_HUB_PUBLIC_BAILIAN_WORKSPACE === 'string' ? env.LEARNING_HUB_PUBLIC_BAILIAN_WORKSPACE.trim() : '',
  };
}

export function renderPublicBailianScript(env = {}) {
  const value = publicBailianFromEnv(env);
  return `globalThis.LEARNING_HUB_PUBLIC_BAILIAN = ${value ? JSON.stringify(value) : 'null'};\n`;
}
