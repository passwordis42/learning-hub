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
