import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { clearConfig, loadConfig, publicConfig, saveConfig, toAiEnv, toGameEnv } from './assistant-config.mjs';
import { assertResolvedUpstream, assertSafeUpstream } from './safe-upstream.mjs';

const secret = 'sk-test-value-that-must-never-leak';
const previousPath = process.env.ASSISTANT_CONFIG_PATH;
const previousKey = process.env.OPENAI_API_KEY;

async function useTempConfig() {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-config-'));
  process.env.ASSISTANT_CONFIG_PATH = path.join(directory, 'assistant-config.json');
  process.env.OPENAI_API_KEY = 'env-key-must-stay-unused';
  return directory;
}

test('custom upstreams reject non-local and ambiguous addresses', async () => {
  for (const value of [
    'http://example.com/v1',
    'http://169.254.169.254/latest',
    'https://10.1.2.3/v1',
    'https://192.168.1.8/v1',
    'file:///etc/passwd',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?token=1',
    'https://example.com/v1#key',
    'http://8.8.8.8/v1',
    'https://printer.local/v1',
  ]) {
    assert.throws(() => assertSafeUpstream(value), value);
  }
  assert.equal(assertSafeUpstream('http://127.0.0.1:9/v1'), 'http://127.0.0.1:9/v1');
  assert.equal(await assertResolvedUpstream('https://example.com/v1'), 'https://example.com/v1');
});

test('saved keys stay on disk and out of AI until that protocol has its own model', async () => {
  const directory = await useTempConfig();
  try {
    await assert.rejects(() => saveConfig({ vendors: { openai: { apiKey: secret, model: 'shared-model' } } }), /save: true/);
    assert.equal(await loadConfig().then((config) => config.vendors.openai.apiKey), '');
    const saved = await saveConfig({
      save: true,
      vendors: { openai: { apiKey: secret, model: 'shared-model', protocols: { ai: { model: '' } } } },
    });
    assert.equal(JSON.stringify(saved).includes(secret), false);
    assert.equal(saved.vendors.find((item) => item.id === 'openai').apiKeyConfigured, true);
    const stored = await readFile(process.env.ASSISTANT_CONFIG_PATH, 'utf8');
    assert.equal(stored.includes(secret), true);
    const gameOnly = toGameEnv(await loadConfig());
    assert.equal(gameOnly.OPENAI_API_KEY, secret);
    assert.equal(gameOnly.OPENAI_MODEL, 'shared-model');
    assert.equal(gameOnly.OPENAI_MODEL === 'gpt-4.1-mini', false);
    const ai = toAiEnv(await loadConfig());
    assert.equal(ai.OPENAI_API_KEY, secret);
    assert.equal(ai.OPENAI_MODEL, 'shared-model');
    await saveConfig({ save: true, vendors: { openai: { baseUrl: 'https://example.com/v1' } } });
    const routed = await loadConfig();
    assert.equal(toAiEnv(routed).OPENAI_BASE_URL, 'https://example.com/v1/responses');
    assert.equal(toGameEnv(routed).OPENAI_BASE_URL, 'https://example.com/v1/chat/completions');
    await saveConfig({ save: true, vendors: { openai: { model: '', protocols: { ai: { model: 'ai-only-model' } } } } });
    const isolated = await loadConfig();
    assert.equal(toAiEnv(isolated).OPENAI_MODEL, 'ai-only-model');
    assert.equal(toGameEnv(isolated).OPENAI_API_KEY, undefined);
    assert.equal(toGameEnv(isolated).OPENAI_MODEL, undefined);
    assert.equal(JSON.stringify(publicConfig(isolated)).includes(secret), false);
    assert.equal(isolated.vendors.openai.apiKey, secret);
    await saveConfig({ save: true, vendors: { deepseek: { apiKey: secret, model: 'deepseek-test' } } });
    await assert.rejects(() => clearConfig({ confirm: 'clear' }), (error) => {
      assert.match(error.effect, /不会读取或迁移旧的 .env/);
      assert.equal(error.status, 400);
      return true;
    });
    assert.equal((await loadConfig()).vendors.deepseek.apiKey, secret);
    const cleared = await clearConfig({ confirm: 'clear-assistant-configuration' });
    assert.match(cleared.effect, /核磁课程不受影响/);
    assert.equal((await loadConfig()).vendors.deepseek.apiKey, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (previousPath === undefined) delete process.env.ASSISTANT_CONFIG_PATH;
    else process.env.ASSISTANT_CONFIG_PATH = previousPath;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
