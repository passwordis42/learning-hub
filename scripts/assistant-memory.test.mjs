import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assistantMemory } from '../portal/assets/assistant-memory.mjs';

test('memory config keeps a key only for the same origins and never stores it', async () => {
  assistantMemory.reset();
  const source = await readFile(new URL('../portal/assets/assistant-memory.mjs', import.meta.url), 'utf8');
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source), false);
  assistantMemory.saveVendor('openai', { model: 'memory-model', apiKey: 'sk-memory-not-real', baseUrl: 'https://api.openai.com/v1' });
  const view = assistantMemory.view();
  assert.equal(JSON.stringify(view).includes('sk-memory-not-real'), false);
  assert.equal(view.vendors.find((item) => item.id === 'openai').apiKeyConfigured, true);
  const ready = assistantMemory.prepare('ai', 'openai');
  assert.equal(ready.ok, true);
  assert.equal(ready.config.url, 'https://api.openai.com/v1/responses');
  assert.equal(ready.config.key, 'sk-memory-not-real');
  assert.throws(() => assistantMemory.saveVendor('openai', { baseUrl: 'https://vendor.example/v1' }), /不会继续使用/);
  assert.equal(assistantMemory.prepare('ai', 'openai').config.key, 'sk-memory-not-real');
  assistantMemory.saveVendor('openai', { baseUrl: 'https://vendor.example/v1', confirmKeyBinding: assistantMemory.keyRebind });
  assert.equal(assistantMemory.prepare('ai', 'openai').ok, false);
  assistantMemory.saveVendor('openai', { baseUrl: 'https://vendor.example/v1', model: 'memory-model', apiKey: 'sk-second-not-real' });
  assert.equal(assistantMemory.prepare('game', 'openai').config.url, 'https://vendor.example/v1/chat/completions');
  assert.equal(assistantMemory.prepare('game', 'openai').config.key, 'sk-second-not-real');
  assistantMemory.clearVendor('openai');
  assert.equal(assistantMemory.view().vendors.find((item) => item.id === 'openai').apiKeyConfigured, false);
});

test('blank qwen does not assume Beijing or inject the preset into other vendors', () => {
  assistantMemory.reset();
  const fresh = assistantMemory.view().vendors.find((item) => item.id === 'qwen');
  assert.equal(fresh.region, '');
  assert.equal(fresh.enteredModel, '');
  assert.equal(fresh.protocols.ai.url, '');
  const blocked = assistantMemory.prepare('ai', 'qwen');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'region');
  assistantMemory.saveVendor('openai', { model: 'kept-openai-model', apiKey: 'sk-memory-not-real' });
  assistantMemory.saveVendor('qwen', { region: 'tokyo', model: 'kept-qwen-model', apiKey: 'sk-memory-not-real' });
  assert.equal(assistantMemory.prepare('game', 'qwen').code, 'workspace');
  assert.equal(assistantMemory.view().vendors.find((item) => item.id === 'openai').enteredModel, 'kept-openai-model');
  assistantMemory.saveVendor('qwen', {
    region: 'virginia',
    model: 'kept-qwen-model',
    apiKey: 'sk-memory-not-real',
    confirmKeyBinding: assistantMemory.keyRebind,
  });
  const ready = assistantMemory.prepare('ai', 'qwen');
  assert.equal(ready.ok, true);
  assert.equal(ready.config.url, 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(ready.config.model, 'kept-qwen-model');
  assert.equal(JSON.stringify(assistantMemory.view()).includes('sk-memory-not-real'), false);
  assert.equal(assistantMemory.peekKey('qwen'), 'sk-memory-not-real');
  assistantMemory.saveVendor('qwen', {
    region: 'beijing',
    workspaceId: 'wsdemo1',
    apiKey: 'sk-memory-not-real',
    confirmKeyBinding: assistantMemory.keyRebind,
  });
  assert.equal(
    assistantMemory.prepare('game', 'qwen').config.url,
    'https://wsdemo1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
  assert.notEqual(assistantMemory.view().vendors.find((item) => item.id === 'qwen').enteredModel, assistantMemory.presetModel);
});
