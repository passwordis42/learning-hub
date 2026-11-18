import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  chatUrl,
  describeUpstreamFailure,
  listPlan,
  listUrlAllowed,
  NETWORK_FAILURE,
  parseListPayload,
  QWEN_PRESET_MODEL,
} from '../portal/assets/bailian-list.mjs';

test('official list URLs follow the documented hosts and never guess a region', () => {
  assert.equal(listPlan({}).code, 'region');
  assert.equal(listPlan({ region: 'beijing' }).code, 'workspace');
  assert.equal(listPlan({ region: 'singapore' }).code, 'workspace');
  assert.equal(listPlan({ region: 'hongkong' }).code, 'workspace');
  assert.equal(listPlan({ region: 'tokyo' }).code, 'workspace');
  assert.match(listPlan({ region: 'tokyo' }).error, /工作空间才能生成接口/);
  const virginia = listPlan({ region: 'virginia' });
  assert.equal(virginia.ok, true);
  assert.equal(virginia.source, 'catalog');
  assert.equal(virginia.url, 'https://dashscope-us.aliyuncs.com/api/v1/models?page_no=1&page_size=100');
  assert.equal(listUrlAllowed(virginia.url), true);
  assert.doesNotMatch(virginia.url, /compatible-mode/);
  const beijing = listPlan({ region: 'beijing', workspaceId: 'wsdemo1' });
  assert.equal(beijing.source, 'authorized');
  const beijingUrl = new URL(beijing.url);
  assert.equal(beijingUrl.origin, 'https://wsdemo1.cn-beijing.maas.aliyuncs.com');
  assert.equal(beijingUrl.pathname, '/api/v1/models/permissions');
  assert.equal(beijingUrl.searchParams.get('authorization_scope'), 'AUTHORIZED');
  assert.equal(beijingUrl.searchParams.get('action'), 'INFERENCE');
  const singapore = listPlan({ region: 'singapore', workspaceId: 'wsdemo1' });
  assert.equal(singapore.source, 'catalog');
  assert.equal(new URL(singapore.url).pathname, '/api/v1/models');
  assert.equal(new URL(singapore.url).hostname, 'wsdemo1.ap-southeast-1.maas.aliyuncs.com');
  assert.equal(listPlan({ region: 'virginia', customUrl: 'https://example.com/v1' }).code, 'custom-address');
  assert.equal(listUrlAllowed('https://dashscope.aliyuncs.com/compatible-mode/v1/models'), false);
  assert.equal(listUrlAllowed('https://dashscope-us.aliyuncs.com/compatible-mode/v1/models'), false);
  assert.equal(chatUrl({ region: 'beijing' }), 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(chatUrl({ region: 'hongkong' }), 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(chatUrl({ region: 'tokyo' }), '');
  assert.equal(
    chatUrl({ region: 'tokyo', workspaceId: 'wsdemo1' }),
    'https://wsdemo1.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
});

test('directory, authorization, and inference permission are parsed separately', () => {
  const catalog = parseListPayload('catalog', JSON.stringify({
    success: true,
    output: { total: 2, models: [{ model: 'mock-catalog-item' }, { model: 'bad name' }] },
  }));
  assert.equal(catalog.source, 'catalog');
  assert.deepEqual(catalog.models, ['mock-catalog-item']);
  const authorized = parseListPayload('authorized', JSON.stringify({
    success: true,
    output: {
      total: 2,
      permissions: [
        { model: 'mock-authorized-item', permissions: { inference: true } },
        { model: 'mock-not-inference', permissions: { inference: false } },
      ],
    },
  }));
  assert.deepEqual(authorized.models, ['mock-authorized-item']);
  const denied = parseListPayload('catalog', JSON.stringify({ success: false, code: 'InvalidApiKey', message: 'invalid' }));
  assert.equal(denied.ok, false);
  assert.match(describeUpstreamFailure(401, 'InvalidApiKey', 'invalid'), /不能断定密钥无效/);
  assert.match(NETWORK_FAILURE, /网络或跨域访问失败/);
  assert.match(NETWORK_FAILURE, /不能据此说密钥无效/);
  assert.equal(QWEN_PRESET_MODEL, 'qwen3.7-flash');
});

test('settings code does not store the key or call an undocumented models path', async () => {
  const settings = await readFile(new URL('../portal/assets/settings.js', import.meta.url), 'utf8');
  const memory = await readFile(new URL('../portal/assets/assistant-memory.mjs', import.meta.url), 'utf8');
  const list = await readFile(new URL('../portal/assets/bailian-list.mjs', import.meta.url), 'utf8');
  for (const source of [settings, memory, list]) {
    assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./.test(source), false);
    assert.equal(source.includes('/compatible-mode/v1/models'), false);
  }
  assert.match(settings, /credentials:\s*'omit'/);
  assert.match(settings, /method:\s*'GET'/);
  assert.doesNotMatch(settings, /\/chat\/completions|max_tokens|messages:/);
});
