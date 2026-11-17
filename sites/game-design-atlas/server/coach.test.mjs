import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { assist, getProviderStatus } from './coach.mjs';
import { createLearningServer } from './index.mjs';

const rule = '触发：按下冲刺键；条件：冷却已经结束；结果：角色向前移动三格；例外：碰墙停止';
const base = {
  provider: 'openai',
  mode: 'coach',
  week: 6,
  title: '动作反馈',
  draft: rule,
  rationale: '玩家有计划地穿过警戒区域。',
  evidence: '准备观察玩家撞墙后是否理解停止的原因。',
};

const keys = {
  OPENAI_API_KEY: 'fake-openai-key',
  ANTHROPIC_API_KEY: 'fake-anthropic-key',
  DEEPSEEK_API_KEY: 'fake-deepseek-key',
  DASHSCOPE_API_KEY: 'fake-qwen-key',
};

function providerResponse(findings, anthropic = false, extra = {}) {
  const text = JSON.stringify({ findings, ...extra });
  return new Response(JSON.stringify(anthropic
    ? { content: [{ type: 'text', text }] }
    : { choices: [{ message: { content: text } }] }));
}

function noProviderCall() {
  assert.fail('the checkpoint should run before provider access');
}

test('the checkpoint requires a learner draft, reasoning and evidence in all modes', async () => {
  for (const mode of ['coach', 'review', 'implementation']) {
    for (const field of ['draft', 'rationale', 'evidence']) {
      await assert.rejects(assist({ ...base, mode, [field]: ' \n ' }, { env: keys, fetcher: noProviderCall }), {
        status: 400,
        field,
      });
    }
  }
});

test('case context stays separate from learner evidence and cannot become an answer', async () => {
  const context = '花铺在两个不同的时间段招募首次玩家。';
  const result = await assist({ ...base, context }, {
    env: keys,
    fetcher: async (_url, init) => {
      const request = JSON.parse(init.body);
      const submitted = JSON.parse(request.messages.at(-1).content);
      assert.equal(submitted.context, context);
      assert.equal(submitted.draft, base.draft);
      assert.equal(submitted.evidence, base.evidence);
      return providerResponse([{ focus: 'evidence', anchor: context }], false, { answer: '直接采用新版。' });
    },
  });
  assert.deepEqual(result.questions, ['哪一段观察支持你的判断？你还有什么其他解释？']);
  assert.deepEqual(result.specification, []);
  assert.equal(JSON.stringify(result).includes(context), false);
});

test('implementation blocks empty, incomplete and unapproved rules before provider access', async () => {
  const mode = 'implementation';
  const blocked = await assist({ ...base, mode, approvedRules: [] }, { env: keys, fetcher: noProviderCall });
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.specification, []);
  await assert.rejects(assist({ ...base, mode, approvedRules: [`${rule}并加双跳`] }, {
    env: keys, fetcher: noProviderCall,
  }), { status: 400, field: 'approvedRules' });

  for (const draft of [
    '按下冲刺键后向前移动三格。',
    '触发：按下冲刺键；条件：无；结果：AI 决定；例外：碰墙停止',
    '触发：无；条件：无；结果：角色向前移动；例外：无',
  ]) {
    const result = await assist({ ...base, mode, draft, approvedRules: [draft] }, {
      env: keys, fetcher: noProviderCall,
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.questions.length);
  }
});

test('implementation only emits the exact assigned rules and discards invented provider text', async () => {
  const other = '触发：按下拾取键；条件：附近有能源盒；结果：获得能源盒；例外：无';
  const submission = { ...base, mode: 'implementation', draft: `${rule}\n${other}`, approvedRules: [rule] };
  const fake = async (_url, init) => {
    const body = JSON.parse(init.body);
    const providerInput = JSON.parse(body.messages.at(-1).content);
    assert.deepEqual(providerInput.approvedRules, [rule]);
    assert.equal(Object.hasOwn(providerInput, 'draft'), false);
    assert.equal(Object.hasOwn(providerInput, 'evidence'), false);
    return providerResponse([], false, { specification: ['新增双跳'] });
  };
  const result = await assist(submission, { env: keys, fetcher: fake });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.specification, [rule]);
  assert(!JSON.stringify(result).includes('新增双跳'));
  assert(!JSON.stringify(result).includes(other));
});

test('an unresolved model finding blocks implementation and coach uses bounded questions', async () => {
  const fake = async () => providerResponse([{ focus: 'parameter', anchor: '新增双跳' }]);
  const implementation = await assist({ ...base, mode: 'implementation', approvedRules: [rule] }, { env: keys, fetcher: fake });
  assert.equal(implementation.status, 'blocked');
  assert.deepEqual(implementation.specification, []);
  assert(!JSON.stringify(implementation).includes('新增双跳'));
  const coach = await assist(base, {
    env: keys,
    fetcher: async () => providerResponse([{ focus: 'feedback', anchor: '按下冲刺键' }], false, { text: '新增双跳' }),
  });
  assert.equal(coach.status, 'feedback');
  assert(coach.questions[0].includes('按下冲刺键'));
  assert(!JSON.stringify(coach).includes('新增双跳'));
  assert.deepEqual(coach.specification, []);
});

test('four providers use their fixed endpoints and authentication without exposing secrets', async () => {
  const urls = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    deepseek: 'https://api.deepseek.com/chat/completions',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  };
  for (const [provider, expectedUrl] of Object.entries(urls)) {
    const result = await assist({ ...base, provider, mode: 'review' }, {
      env: keys,
      fetcher: async (url, init) => {
        assert.equal(url, expectedUrl);
        const body = JSON.parse(init.body);
        assert.equal(init.redirect, 'error');
        if (provider === 'anthropic') {
          assert.equal(init.headers['x-api-key'], keys.ANTHROPIC_API_KEY);
          assert.equal(init.headers['anthropic-version'], '2023-06-01');
          assert.equal(body.messages.at(-1).role, 'user');
          assert.ok(body.system);
        } else {
          const key = {
            openai: keys.OPENAI_API_KEY,
            deepseek: keys.DEEPSEEK_API_KEY,
            qwen: keys.DASHSCOPE_API_KEY,
          }[provider];
          assert.equal(init.headers.Authorization, `Bearer ${key}`);
          assert.equal(body.messages[0].role, 'system');
          assert.equal(body.response_format.type, 'json_object');
        }
        for (const key of Object.values(keys)) assert(!init.body.includes(key));
        return providerResponse([{ focus: 'test', anchor: '' }], provider === 'anthropic');
      },
    });
    assert.equal(result.status, 'feedback');
    assert.equal(result.checks.length, 1);
  }
  const publicStatus = JSON.stringify(getProviderStatus(keys));
  for (const key of Object.values(keys)) assert(!publicStatus.includes(key));
  assert(!JSON.stringify(getProviderStatus({})).includes('"configured":true'));
});

test('Qwen regions select only known vendor hosts', async () => {
  await assist({ ...base, provider: 'qwen' }, {
    env: { ...keys, QWEN_REGION: 'singapore', QWEN_WORKSPACE_ID: 'llm-student' },
    fetcher: async (url) => {
      assert.equal(url, 'https://llm-student.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
      return providerResponse([]);
    },
  });
  await assert.rejects(assist({ ...base, provider: 'qwen' }, {
    env: { ...keys, QWEN_WORKSPACE_ID: 'invalid.example' },
    fetcher: noProviderCall,
  }), { status: 503, field: 'provider' });
});

test('upstream response bodies and malformed output are withheld', async () => {
  await assert.rejects(assist(base, {
    env: keys,
    fetcher: async () => new Response('provider error with private diagnostic', { status: 401 }),
  }), (error) => error.status === 502 && !error.message.includes('private diagnostic'));
  await assert.rejects(assist(base, {
    env: keys,
    fetcher: async () => providerResponse([{ focus: 'generate-answer', anchor: '' }]),
  }), { status: 502 });
});

test('HTTP service enforces the host and origin boundary, and validates content', async (t) => {
  const server = createLearningServer({ env: keys, fetcher: async () => providerResponse([]) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${url}/api/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).providers.length, 4);

  const crossOrigin = await fetch(`${url}/api/status`, { headers: { Origin: 'https://other.example' } });
  assert.equal(crossOrigin.status, 403);
  const sameOrigin = await fetch(`${url}/api/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify(base),
  });
  assert.equal(sameOrigin.status, 200);
  assert.equal((await sameOrigin.json()).status, 'feedback');
  const wrongType = await fetch(`${url}/api/assist`, { method: 'POST', body: JSON.stringify(base) });
  assert.equal(wrongType.status, 415);
  const hiddenFile = await fetch(`${url}/.env.example`);
  assert.equal(hiddenFile.status, 404);
  const privateSource = await fetch(`${url}/server/coach.mjs`);
  assert.equal(privateSource.status, 404);
});
