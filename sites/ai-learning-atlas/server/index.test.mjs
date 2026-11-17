import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createTutorServer } from './index.mjs'

async function startServer(t, options = {}) {
  const { server, host } = createTutorServer({ env: {}, ...options })
  server.listen(0, host)
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  return `http://127.0.0.1:${server.address().port}/api/tutor`
}

function sendQuestion(endpoint, provider, extra = {}) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, question: '怎么验证输出？', context: '第 1 天清洗练习', ...extra }),
  })
}

test('four configured providers send the expected protocol and relay only reply text', async (t) => {
  const env = {
    OPENAI_API_KEY: 'openai-example-key',
    OPENAI_MODEL: 'openai-test-model',
    ANTHROPIC_API_KEY: 'claude-example-key',
    ANTHROPIC_MODEL: 'claude-test-model',
    DEEPSEEK_API_KEY: 'deepseek-example-key',
    DEEPSEEK_MODEL: 'deepseek-test-model',
    DASHSCOPE_API_KEY: 'qwen-example-key',
    QWEN_MODEL: 'qwen-test-model',
    DASHSCOPE_REGION: 'cn-beijing',
    DASHSCOPE_WORKSPACE_ID: 'workspace-01',
  }
  const endpoints = {
    openai: 'https://api.openai.com/v1/responses',
    claude: 'https://api.anthropic.com/v1/messages',
    deepseek: 'https://api.deepseek.com/chat/completions',
    qwen: 'https://workspace-01.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  }
  const replies = {
    openai: { output: [{ type: 'message', content: [{ type: 'output_text', text: '先算一遍。' }] }] },
    claude: { content: [{ type: 'text', text: '先算一遍。' }] },
    deepseek: { choices: [{ message: { content: '先算一遍。', reasoning_content: '隐藏推理' } }] },
    qwen: { choices: [{ message: { content: '先算一遍。' } }] },
  }
  const ids = Object.keys(endpoints)
  const fetcher = t.mock.fn(async (url) => {
    const id = ids.find((name) => endpoints[name] === url)
    assert.ok(id)
    return Response.json(replies[id])
  })
  const endpoint = await startServer(t, { env, fetcher })

  const status = await (await fetch(endpoint)).json()
  assert.equal(fetcher.mock.callCount(), 0, 'status checks must not make upstream calls')
  assert.deepEqual(status.providers, ids.map((id) => ({ id, configured: true })))

  for (const [index, id] of ids.entries()) {
    const response = await sendQuestion(endpoint, id)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { provider: id, reply: '先算一遍。' })
    const [url, options] = fetcher.mock.calls[index].arguments
    const body = JSON.parse(options.body)
    assert.equal(url, endpoints[id])
    assert.equal(options.headers.Authorization, `Bearer ${id}-example-key`)
    assert.equal(body.model, `${id}-test-model`)
    if (id === 'openai') {
      assert.equal(body.store, false)
      assert.match(body.input, /第 1 天清洗练习/)
    } else {
      assert.match(body.messages.at(-1).content, /怎么验证输出？/)
    }
    if (id === 'claude') assert.equal(options.headers['anthropic-version'], '2026-10-21')
    if (id === 'deepseek') assert.equal(body.thinking.type, 'disabled')
  }
})

test('external origins need an allow-list entry and a separate gateway token', async (t) => {
  const origin = 'https://learning.example.com'
  const token = 'example-gateway-token-for-testing-only'
  assert.throws(() => createTutorServer({ env: { TUTOR_ALLOWED_ORIGINS: origin } }), /TUTOR_ACCESS_TOKEN/)
  assert.throws(() => createTutorServer({ env: { TUTOR_HOST: '0.0.0.0' } }), /TUTOR_ACCESS_TOKEN/)
  const endpoint = await startServer(t, {
    env: { TUTOR_ALLOWED_ORIGINS: origin, TUTOR_ACCESS_TOKEN: token },
  })
  const denied = await fetch(endpoint, { headers: { Origin: 'https://somewhere.example.com' } })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  assert.equal((await fetch(endpoint, { headers: { Origin: origin } })).status, 401)
  const allowed = await fetch(endpoint, { headers: { Origin: origin, Authorization: `Bearer ${token}` } })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin)
})

test('invalid or unavailable requests are rejected before talking to providers', async (t) => {
  const fetcher = t.mock.fn()
  const endpoint = await startServer(t, { fetcher })
  assert.equal((await sendQuestion(endpoint, 'constructor')).status, 400)
  assert.equal((await sendQuestion(endpoint, 'qwen', { question: ' ' })).status, 400)
  assert.equal((await sendQuestion(endpoint, 'qwen', { question: '字'.repeat(15000) })).status, 413)
  assert.equal((await sendQuestion(endpoint, 'qwen')).status, 503)
  assert.equal(fetcher.mock.callCount(), 0)
})

test('upstream error details stay off the response', async (t) => {
  const endpoint = await startServer(t, {
    env: { OPENAI_API_KEY: 'openai-example-key', OPENAI_MODEL: 'test-model' },
    fetcher: async () => new Response('upstream diagnostic and account detail', { status: 401 }),
  })
  const response = await sendQuestion(endpoint, 'openai')
  assert.equal(response.status, 502)
  const body = await response.text()
  assert.match(body, /密钥/)
  assert.doesNotMatch(body, /openai-example-key|upstream diagnostic/)
})
