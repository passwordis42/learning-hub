import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPublicBailian, renderPublicBailianScript } from '../portal/assets/public-bailian.mjs';

const mockKey = 'sk-public-mock-not-real';

test('missing key keeps manual entry', () => {
  assert.deepEqual(readPublicBailian(null), { state: 'absent' });
  assert.deepEqual(readPublicBailian({}), { state: 'absent' });
  assert.equal(renderPublicBailianScript({}).includes(mockKey), false);
  assert.match(renderPublicBailianScript({}), /=\s*null;/);
});

test('empty region uses the confirmed Beijing mapping and does not probe elsewhere', () => {
  const parsed = readPublicBailian({ key: mockKey, region: '', model: '' });
  assert.equal(parsed.state, 'ready');
  assert.equal(parsed.region, 'beijing');
  assert.equal(parsed.model, 'qwen3.7-flash');
  assert.equal(parsed.verified, false);
  assert.equal(parsed.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(readPublicBailian({ key: mockKey, region: 'Beijing' }).state, 'invalid');
  const script = renderPublicBailianScript({ LEARNING_HUB_PUBLIC_BAILIAN_KEY: mockKey });
  assert.match(script, /"region":"beijing"/);
  assert.doesNotMatch(script, /singapore|hongkong|virginia|tokyo/);
});

test('ready config validates the model and stays unverified', () => {
  const parsed = readPublicBailian({ key: mockKey, region: 'beijing' });
  assert.equal(parsed.state, 'ready');
  assert.equal(parsed.model, 'qwen3.7-flash');
  assert.equal(parsed.verified, false);
  assert.equal(parsed.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(readPublicBailian({ key: mockKey, region: 'beijing', model: 'bad model' }).state, 'invalid');
});

test('tokyo without a workspace does not fall through to another region', () => {
  const parsed = readPublicBailian({ key: mockKey, region: 'tokyo', model: 'qwen3.7-flash' });
  assert.equal(parsed.state, 'needs-workspace');
  assert.equal(parsed.region, 'tokyo');
  assert.equal(parsed.url, undefined);
});

test('render script keeps the key out of a log-shaped summary', () => {
  const script = renderPublicBailianScript({
    LEARNING_HUB_PUBLIC_BAILIAN_KEY: mockKey,
    LEARNING_HUB_PUBLIC_BAILIAN_REGION: 'beijing',
  });
  assert.equal(script.startsWith('globalThis.LEARNING_HUB_PUBLIC_BAILIAN = '), true);
  assert.equal(script.includes(mockKey), true);
  const log = script.includes(mockKey)
    ? '公开百炼配置已写入 dist/assets/public-bailian-config.js。构建日志不包含密钥。'
    : '';
  assert.equal(log.includes(mockKey), false);
});
