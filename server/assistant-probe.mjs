import { createTutorServer } from '../sites/ai-learning-atlas/server/index.mjs';
import { CoachError, assist } from '../sites/game-design-atlas/server/coach.mjs';
import { toAiEnv, toGameEnv, vendorIds } from './assistant-config.mjs';
import { pinnedFetch } from './safe-upstream.mjs';

const messages = {
  ok: '模型调用成功。',
  configured: '只核对已保存的密钥和模型。没有向上游发送请求，不能当作服务可达。',
  unconfiguredAi: '尚未配置此厂商的密钥和模型。保存后可再测试；这不影响课程浏览。',
  unconfiguredGame: '尚未配置此厂商的密钥和模型。保存后可再测试；课程与学习进度不受影响。',
  auth: '认证失败。请检查已保存的密钥和访问权限，保存后重试。',
  rate: '请求受限。请稍后重试，课程浏览不受影响。',
  timeout: '请求超时。请稍后重试。',
  protocol: '模型或协议未被接受。请检查模型名，以及按课程覆盖里的地址。',
  network: '服务不可达。请检查地址，或确认本机入口仍在运行。',
};

const sample = {
  mode: 'coach',
  week: 1,
  title: '连接测试',
  draft: '玩家选择一条路线。',
  rationale: '用来确认已保存的配置能否调用模型。',
  evidence: '这次由用户明确发起。',
};

function vendorReady(config, vendorId, protocol) {
  const env = protocol === 'ai' ? toAiEnv(config) : toGameEnv(config);
  const key = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY', qwen: 'DASHSCOPE_API_KEY' }[vendorId];
  const model = { openai: 'OPENAI_MODEL', anthropic: 'ANTHROPIC_MODEL', deepseek: 'DEEPSEEK_MODEL', qwen: 'QWEN_MODEL' }[vendorId];
  return Boolean(env[key] && env[model]);
}

function hidden(config, text) {
  const values = Object.values({ ...toAiEnv(config), ...toGameEnv(config) }).filter((value) => typeof value === 'string' && value.length >= 8);
  return values.some((value) => text.includes(value));
}

function fromHint(config, hint, status) {
  const text = hidden(config, hint) ? '' : hint;
  if (status === 401 || status === 403 || text.includes('拒绝') || text.includes('授权') || text.includes('口令')) return 'auth';
  if (status === 429 || text.includes('限流') || text.includes('用量')) return 'rate';
  if (status === 408 || status === 504 || text.includes('超时')) return 'timeout';
  if (status === 400 || status === 404 || text.includes('模型') || text.includes('协议') || text.includes('评审')) return 'protocol';
  if (status === 503 || text.includes('尚未') || text.includes('还未')) return 'unconfigured';
  return 'network';
}

export function statusReport(config, vendorId, fetcher = null) {
  void fetcher;
  if (!vendorIds.includes(vendorId)) throw Object.assign(new Error('请选择一个厂商。'), { status: 400 });
  return {
    scope: 'status',
    vendor: vendorId,
    ai: { course: 'AI 学伴', code: vendorReady(config, vendorId, 'ai') ? 'configured' : 'unconfigured', message: vendorReady(config, vendorId, 'ai') ? messages.configured : messages.unconfiguredAi },
    game: { course: '游戏助手', code: vendorReady(config, vendorId, 'game') ? 'configured' : 'unconfigured', message: vendorReady(config, vendorId, 'game') ? messages.configured : messages.unconfiguredGame },
  };
}

async function probeAi(config, vendorId, fetcher) {
  if (!vendorReady(config, vendorId, 'ai')) return { course: 'AI 学伴', code: 'unconfigured', message: messages.unconfiguredAi };
  const created = createTutorServer({ env: toAiEnv(config), fetcher });
  const port = await new Promise((resolve, reject) => {
    created.server.once('error', reject);
    created.server.listen(0, '127.0.0.1', () => resolve(created.server.address().port));
  });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/tutor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: vendorId === 'anthropic' ? 'claude' : vendorId, question: '请只回复连接测试。', context: '连接测试' }),
    });
    const data = await response.json().catch(() => ({}));
    const code = response.status === 200 && typeof data.reply === 'string' ? 'ok' : fromHint(config, String(data.error || ''), response.status);
    const key = code === 'unconfigured' ? 'unconfiguredAi' : code;
    return { course: 'AI 学伴', code: code === 'unconfigured' ? 'unconfigured' : code, message: messages[key] };
  } catch (error) {
    const code = error?.name === 'TimeoutError' ? 'timeout' : 'network';
    return { course: 'AI 学伴', code, message: messages[code] };
  } finally {
    created.server.close();
  }
}

async function probeGame(config, vendorId, fetcher) {
  if (!vendorReady(config, vendorId, 'game')) return { course: '游戏助手', code: 'unconfigured', message: messages.unconfiguredGame };
  try {
    await assist({ ...sample, provider: vendorId }, { env: toGameEnv(config), fetcher });
    return { course: '游戏助手', code: 'ok', message: messages.ok };
  } catch (error) {
    const code = error?.name === 'TimeoutError' ? 'timeout' : fromHint(config, String(error?.message || ''), error instanceof CoachError ? error.status : 502);
    const key = code === 'unconfigured' ? 'unconfiguredGame' : code;
    return { course: '游戏助手', code: code === 'unconfigured' ? 'unconfigured' : code, message: messages[key] || messages.network };
  }
}

export async function probeVendor(config, vendorId, fetcher = pinnedFetch) {
  if (!vendorIds.includes(vendorId)) throw Object.assign(new Error('请选择一个厂商。'), { status: 400 });
  const ai = await probeAi(config, vendorId, fetcher);
  const game = await probeGame(config, vendorId, fetcher);
  return { scope: 'model', vendor: vendorId, ai, game };
}
