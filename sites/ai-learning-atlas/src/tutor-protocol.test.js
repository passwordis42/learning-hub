import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { tutorRequest } from './tutor-protocol.js'

test('qwen tutor requests disable thinking at the top level', () => {
  const { body } = tutorRequest('qwen', { key: 'sk-public-mock-not-real', model: 'qwen3.7-flash' }, '怎么验证输出？')
  assert.equal(body.enable_thinking, false)
  assert.equal(body.model, 'qwen3.7-flash')
  assert.equal(body.messages.at(-1).content, '怎么验证输出？')
  assert.equal(tutorRequest('deepseek', { key: 'x', model: 'deepseek-test' }, 'hi').body.enable_thinking, undefined)
})

test('embedded tutor defaults to qwen', async () => {
  const source = await readFile(new URL('./Tutor.jsx', import.meta.url), 'utf8')
  assert.match(source, /useState\(embedded \? 'qwen' : 'openai'\)/)
})
