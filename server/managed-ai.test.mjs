import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { dispatchManaged } from './managed-ai.mjs';

function once(request, sourceIp) {
  return new Promise((resolve) => {
    const response = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(payload) { resolve({ status: this.status, body: JSON.parse(payload) }); },
    };
    dispatchManaged(request, response, sourceIp);
  });
}

test('managed entry is closed and does not use a character coefficient', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'managed-ai-'));
  process.env.MANAGED_LEDGER_DRIVER = 'sqlite';
  process.env.MANAGED_LEDGER_PATH = path.join(directory, 'ledger.sqlite');
  try {
    const sessionRequest = new EventEmitter();
    sessionRequest.url = '/api/ai/session';
    sessionRequest.method = 'POST';
    sessionRequest.headers = { 'content-type': 'application/json' };
    sessionRequest.socket = { remoteAddress: '203.0.113.10' };
    const sessionPromise = once(sessionRequest, '203.0.113.10');
    sessionRequest.emit('data', Buffer.from('{}'));
    sessionRequest.emit('end');
    const session = await sessionPromise;
    assert.equal(session.body.code, 'session');
    const request = new EventEmitter();
    request.url = '/api/ai/requests';
    request.method = 'POST';
    request.headers = { 'content-type': 'application/json', 'idempotency-key': 'node-idem-1', 'x-learning-session': session.body.sessionId };
    request.socket = { remoteAddress: '203.0.113.10' };
    const pending = once(request, '203.0.113.10');
    request.emit('data', Buffer.from(JSON.stringify({ entry: 'ai', text: '请解释这一课', model: 'qwen-plus' })));
    request.emit('end');
    const result = await pending;
    assert.equal(result.body.code, 'bad_request');
    const allowed = new EventEmitter();
    allowed.url = '/api/ai/requests';
    allowed.method = 'POST';
    allowed.headers = request.headers;
    allowed.socket = request.socket;
    const closedPromise = once(allowed, '203.0.113.10');
    allowed.emit('data', Buffer.from(JSON.stringify({ entry: 'ai', text: '请解释这一课' })));
    allowed.emit('end');
    const closed = await closedPromise;
    assert.equal(closed.body.code, 'UPPER_BOUND_UNPROVEN');
    assert.equal(closed.body.reading, true);
    assert.match(closed.body.message, /不是百炼账户的自然日总额/);
    const portal = await readFile(new URL('../portal/index.html', import.meta.url), 'utf8');
    assert.match(portal, /核磁仍使用复制提问/);
  } finally {
    delete process.env.MANAGED_LEDGER_DRIVER;
    delete process.env.MANAGED_LEDGER_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});
