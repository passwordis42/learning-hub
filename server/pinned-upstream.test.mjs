import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { pinnedFetch } from './safe-upstream.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('private resolutions and redirects are never contacted', async () => {
  let contacts = 0;
  await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
    lookup: async () => [{ address: '169.254.169.254', family: 4 }],
    transport: () => { contacts += 1; return new Response('secret'); },
  }), /内网/);
  await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
    lookup: async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.2.2.2', family: 4 }],
    transport: () => { contacts += 1; return new Response('secret'); },
  }), /内网/);
  await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    transport: () => { contacts += 1; return new Response('secret'); },
  }), /内网/);
  assert.equal(contacts, 0);

  const hits = { front: 0, secret: 0 };
  const secret = createServer((request, response) => { hits.secret += 1; response.end('secret'); });
  const secretPort = await listen(secret);
  const front = createServer((request, response) => {
    hits.front += 1;
    response.writeHead(302, { Location: `http://127.0.0.1:${secretPort}/latest/meta-data` });
    response.end();
  });
  const frontPort = await listen(front);
  try {
    await assert.rejects(() => pinnedFetch(`http://127.0.0.1:${frontPort}/v1`), /重定向/);
    assert.equal(hits.front, 1);
    assert.equal(hits.secret, 0);
  } finally {
    secret.close();
    front.close();
  }
});
