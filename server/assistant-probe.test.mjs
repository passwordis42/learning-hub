import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig } from './assistant-config.mjs';
import { probeVendor, statusReport } from './assistant-probe.mjs';

const secret = 'sk-test-value-that-must-never-leak';

test('status check does not call a model and a mocked probe reports each course', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-probe-'));
  const previous = process.env.ASSISTANT_CONFIG_PATH;
  process.env.ASSISTANT_CONFIG_PATH = path.join(directory, 'assistant-config.json');
  let calls = 0;
  try {
    await saveConfig({
      save: true,
      vendors: { openai: { apiKey: secret, model: 'shared-test-model' } },
    });
    const config = await loadConfig();
    const status = statusReport(config, 'openai');
    assert.equal(calls, 0);
    assert.equal(status.ai.message, '服务可达，模型调用尚未验证。');
    assert.equal(status.game.message, '服务可达，模型调用尚未验证。');
    assert.equal(JSON.stringify(status).includes(secret), false);
    const probed = await probeVendor(config, 'openai', async (url) => {
      calls += 1;
      if (String(url).includes('responses')) {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '连接测试' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    assert.equal(calls, 2);
    assert.equal(probed.ai.message, '模型调用成功。');
    assert.equal(probed.game.message, '模型调用成功。');
    assert.equal(JSON.stringify(probed).includes(secret), false);
    const denied = await probeVendor(config, 'openai', async () => new Response('no', { status: 401 }));
    assert.equal(denied.ai.code, 'auth');
    assert.equal(denied.game.code, 'auth');
    assert.equal(JSON.stringify(denied).includes(secret), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ASSISTANT_CONFIG_PATH;
    else process.env.ASSISTANT_CONFIG_PATH = previous;
  }
});
