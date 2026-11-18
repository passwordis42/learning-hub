import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferredVendor } from './coach-direct.js';

test('game assistant prefers an enabled qwen preset', () => {
  assert.equal(preferredVendor([
    { id: 'openai', configured: false },
    { id: 'qwen', configured: true, model: 'qwen3.7-flash' },
  ]), 'qwen');
  assert.equal(preferredVendor([{ id: 'openai', configured: true }]), 'openai');
  assert.equal(preferredVendor([]), '');
});
