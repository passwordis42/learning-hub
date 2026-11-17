import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { pinnedFetch } from './safe-upstream.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const deniedAnswers = [
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:7f00:0001',
  '0:0:0:0:0:ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '::ffff:169.254.169.254',
  '::ffff:c0a8:1',
  '::ffff:ac10:1',
  '::7f00:1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '169.254.169.254',
  '100.64.0.1',
  '127.0.0.2',
  '0.0.0.0',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '192.0.2.1',
  '198.51.100.1',
  '203.0.113.1',
  '0177.0.0.1',
  'fe80::1',
  'fe90::1',
  'fea0::1',
  'febf::1',
  'fc00::1',
  'fd12:3456::1',
  'ff02::1',
  '::',
  '2001:db8::1',
];

test('denied mapped, private, and link-local answers never reach a connector or TCP socket', async () => {
  let contacts = 0;
  const transport = () => {
    contacts += 1;
    return new Response('secret-payload');
  };
  for (const address of deniedAnswers) {
    await assert.rejects(() => pinnedFetch('https://rebind.example/v1', { body: 'payload-must-not-matter' }, {
      lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      transport,
    }), /内网|无法确认/);
  }
  await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
    lookup: async () => [{ address: '1.1.1.1', family: 4 }, { address: '::ffff:127.0.0.1', family: 6 }],
    transport,
  }), /内网/);
  await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
    lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }, { address: 'fe90::1', family: 6 }],
    transport,
  }), /内网/);
  assert.equal(contacts, 0);

  const hits = { mapped: 0 };
  const mapped = createServer((request, response) => {
    hits.mapped += 1;
    response.end('loopback-was-reached');
  });
  const mappedPort = await listen(mapped);
  try {
    await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
      lookup: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
    }), /内网/);
    await assert.rejects(() => pinnedFetch('https://rebind.example/v1', {}, {
      lookup: async () => [{ address: '::ffff:7f00:1', family: 6 }],
    }), /内网/);
    assert.equal(hits.mapped, 0);
  } finally {
    mapped.close();
  }
});

test('public addresses are pinned and redirects are not followed', async () => {
  const seen = [];
  const transport = async (plan, init) => {
    seen.push({ address: plan.address, family: plan.family, body: init.body });
    return new Response('ok', { status: 200 });
  };
  const v4 = await pinnedFetch('https://public.example/v1', { body: 'one' }, {
    lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    transport,
  });
  const v6 = await pinnedFetch('https://public.example/v1', { body: 'two' }, {
    lookup: async () => [{ address: '::ffff:1.1.1.1', family: 6 }, { address: '2606:4700:4700::1111', family: 6 }],
    transport,
  });
  assert.equal(await v4.text(), 'ok');
  assert.equal(await v6.text(), 'ok');
  assert.deepEqual(seen.map((item) => item.address), ['1.1.1.1', '1.1.1.1']);
  assert.deepEqual(seen.map((item) => item.family), [4, 4]);

  const hits = { front: 0, secret: 0, mapped: 0 };
  const secret = createServer((request, response) => { hits.secret += 1; response.end('secret'); });
  const mapped = createServer((request, response) => { hits.mapped += 1; response.end('mapped'); });
  const secretPort = await listen(secret);
  const mappedPort = await listen(mapped);
  const front = createServer((request, response) => {
    hits.front += 1;
    const location = hits.front === 1
      ? `http://127.0.0.1:${secretPort}/latest/meta-data`
      : `http://[::ffff:127.0.0.1]:${mappedPort}/latest/meta-data`;
    response.writeHead(302, { Location: location });
    response.end();
  });
  const frontPort = await listen(front);
  try {
    await assert.rejects(() => pinnedFetch(`http://127.0.0.1:${frontPort}/v1`), /重定向/);
    await assert.rejects(() => pinnedFetch(`http://127.0.0.1:${frontPort}/v1`), /重定向/);
    assert.equal(hits.front, 2);
    assert.equal(hits.secret, 0);
    assert.equal(hits.mapped, 0);
  } finally {
    secret.close();
    front.close();
    mapped.close();
  }
});
