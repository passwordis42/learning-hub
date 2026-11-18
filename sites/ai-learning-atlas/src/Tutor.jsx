import { useEffect, useId, useRef, useState } from 'react'
import { credentialMode } from './credential-mode.js'
import { directFailure, listAssistant, prepareAssistant } from './parent-config.js'
import { callTutorVendor } from './tutor-protocol.js'
import './tutor.css'

const providers = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: 'Qwen' },
]
const starters = [
  '请先给我一个提示。',
  '怎么验证我做对了？',
  '给我一个容易漏掉的反例。',
]
const defaultQuestion = '请从一个我能独立核查的小练习开始，每次只给一个提示。'

function hubEmbed() {
  return new URLSearchParams(location.search).get('embed') === '1'
}

function getEndpoint(value) {
  const entered = value.trim()
  if (!entered) return import.meta.env.DEV ? '/api/tutor' : ''
  if (/^\/(?!\/)(?:[A-Za-z0-9._~-]+\/)*api\/tutor$/.test(entered)) return entered
  try {
    const url = new URL(entered)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return ''
    if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/tutor')) return ''
    return url.href
  } catch {
    return ''
  }
}

function composePrompt(context, question) {
  return [
    '你是我的 AI 学习导师，我从零开始学习。请用中文，每次给一个可以核查的小步骤。',
    '先让我预测输出，再帮助我理解数据流、检查结果和修改一处行为。请用问题或反例引导我。',
    '',
    '课程资料',
    context || '人工智能零基础学习。重点是自己定义验收样例、读懂 AI 生成的代码，再运行核对。',
    '',
    '我的问题',
    question.trim() || defaultQuestion,
  ].join('\n')
}

export default function Tutor({ context = '' }) {
  const id = useId()
  const promptRef = useRef(null)
  const embedded = hubEmbed()
  const [provider, setProvider] = useState(embedded ? 'qwen' : 'openai')
  const [question, setQuestion] = useState('')
  const [gateway, setGateway] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [availability, setAvailability] = useState(null)
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [answer, setAnswer] = useState(null)
  const lessonContext = context.trim().slice(0, 6000)
  const prompt = composePrompt(lessonContext, question)

  async function requestTutor(mode) {
    if (embedded) {
      setBusy(mode)
      setFeedback('')
      try {
        if (mode !== 'ask') {
          const listed = await listAssistant('ai')
          const ready = listed.filter((item) => item.configured)
          setAvailability(new Set(ready.map((item) => item.id === 'anthropic' ? 'claude' : item.id)))
          if (ready.some((item) => item.id === 'qwen')) setProvider('qwen')
          setFeedback(ready.length
            ? '只核对了这次页面里的站点预设。没有连接供应商，不能当作已经连通。'
            : '助手暂不可用。没有可用的站点预设。没有连接供应商，也不会打开配置页。')
          return
        }
        const vendor = provider === 'claude' ? 'anthropic' : provider
        const config = await prepareAssistant('ai', vendor)
        const input = lessonContext ? `课程资料\n${lessonContext}\n\n学习者的问题\n${question.trim()}` : question.trim()
        const reply = await callTutorVendor(config, input)
        setAnswer({ label: providers.find(({ id }) => id === provider).label, text: reply })
      } catch (error) {
        setFeedback(directFailure(error))
      } finally {
        setBusy('')
      }
      return
    }
    const endpoint = getEndpoint(gateway)
    const payload = mode === 'ask' ? { provider, question: question.trim(), context: lessonContext } : null
    setFeedback('')
    if (!endpoint) {
      setFeedback(gateway.trim()
        ? '请输入受信任的 HTTPS 导师地址，或本机 HTTP 地址，并以 /api/tutor 结尾。'
        : '请先填写导师服务地址。你也可以复制辅学提示词，在常用的 AI 工具中继续。')
      return
    }
    setBusy(mode)
    if (!payload) setAvailability(null)
    if (payload) setAnswer(null)
    const headers = {}
    if (accessToken.trim()) headers.Authorization = `Bearer ${accessToken.trim()}`
    if (payload) headers['Content-Type'] = 'application/json'
    try {
      const result = await fetch(endpoint, {
        method: payload ? 'POST' : 'GET',
        body: payload ? JSON.stringify(payload) : undefined,
        headers,
        signal: AbortSignal.timeout(50_000),
        cache: 'no-store',
        credentials: credentialMode(endpoint, location.origin),
        redirect: 'error',
      })
      const data = await result.json().catch(() => null)
      if (!result.ok) throw new Error(data?.error || '导师服务连接失败，请核对地址和访问口令。')
      if (!payload) {
        if (data?.service !== 'atlas-tutor' || !Array.isArray(data.providers)) {
          throw new Error('该地址没有返回学习地图导师服务的状态。')
        }
        const configured = data.providers.filter(({ configured }) => configured).map(({ id }) => id)
        setAvailability(new Set(configured))
        setFeedback(configured.length
          ? '导师服务已连接。模型账号与权限会在首次提问时验证。'
          : '导师服务已连接。请在服务端配置至少一家模型的密钥和模型名。')
      } else {
        if (typeof data?.reply !== 'string' || !data.reply.trim() || data.provider !== provider) {
          throw new Error('导师未返回可显示的答复。')
        }
        setAnswer({ label: providers.find(({ id }) => id === provider).label, text: data.reply })
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        setFeedback('这次连接超时。稍后重试，或者先复制辅学提示词。')
      } else if (error instanceof TypeError) {
        setFeedback('暂时无法连接导师服务。请确认服务已运行，并允许当前网站访问。')
      } else {
        setFeedback(error.message)
      }
    } finally {
      setBusy('')
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyFeedback('已复制辅学提示词。')
    } catch {
      setShowPrompt(true)
      requestAnimationFrame(() => {
        promptRef.current?.focus()
        promptRef.current?.select()
      })
      setCopyFeedback('提示词已选中，可以手动复制。')
    }
  }

  function resetConnection() {
    setAvailability(null)
    setFeedback('')
  }

  return (
    <section className="atlas-tutor" aria-labelledby={`${id}-title`}>
      <header className="atlas-tutor__header">
        <h2 id={`${id}-title`}>AI 导师</h2>
        <p>卡住时先要一个提示，也可以让导师帮你找反例。</p>
      </header>
      <form className="atlas-tutor__form" onSubmit={(event) => {
        event.preventDefault()
        if (question.trim() && !busy) requestTutor('ask')
      }}>
        <label className="atlas-tutor__label" htmlFor={`${id}-question`}>你想问什么？</label>
        <textarea id={`${id}-question`} rows={3} placeholder="比如，我怎么事先算出清洗后应该剩几行？"
          value={question} maxLength={2000} disabled={Boolean(busy)}
          onChange={(event) => { setQuestion(event.target.value); setCopyFeedback('') }} />
        <div className="atlas-tutor__starters" aria-label="示例问题">
          {starters.map((starter) => (
            <button type="button" key={starter} disabled={Boolean(busy)} onClick={() => {
              setQuestion(starter)
              setCopyFeedback('')
            }}>{starter}</button>
          ))}
        </div>
        {embedded ? (
          <p>提问使用站点预设。预设未经验证，不能当作已连接。没有可用预设时助手暂不可用，不会打开配置页。此页不接收访客密钥。</p>
        ) : (
          <details className="atlas-tutor__settings">
            <summary>设置模型连接</summary>
            <div className="atlas-tutor__connection">
              <label className="atlas-tutor__label" htmlFor={`${id}-gateway`}>导师服务地址</label>
              <input id={`${id}-gateway`} type="text" inputMode="url" autoComplete="off" spellCheck={false}
                value={gateway} placeholder="http://127.0.0.1:8787/api/tutor" disabled={Boolean(busy)}
                onChange={(event) => { setGateway(event.target.value); resetConnection() }} />
              <label className="atlas-tutor__label" htmlFor={`${id}-token`}>导师服务访问口令（服务启用时填写）</label>
              <input id={`${id}-token`} type="password" autoComplete="off" value={accessToken} disabled={Boolean(busy)}
                onChange={(event) => { setAccessToken(event.target.value); resetConnection() }} />
              <p>仅填写你信任的导师服务。各家模型的 API 密钥在服务端配置。</p>
              <button className="atlas-tutor__muted" type="button" disabled={Boolean(busy)}
                onClick={() => requestTutor('check')}>{busy === 'check' ? '正在检查…' : '检查连接'}</button>
            </div>
          </details>
        )}
        {embedded && <button className="atlas-tutor__muted" type="button" disabled={Boolean(busy)}
          onClick={() => requestTutor('check')}>{busy === 'check' ? '正在检查…' : '检查连接'}</button>}
        <p className="atlas-tutor__notice">在线提问会把本课资料、已保存的判断记录和当前问题发给所选模型。</p>
        <div className="atlas-tutor__actions">
          <label className="atlas-tutor__provider" htmlFor={`${id}-provider`}>
            <span>选择模型</span>
            <select id={`${id}-provider`} value={provider} disabled={Boolean(busy)}
              onChange={(event) => setProvider(event.target.value)}>
              {providers.map(({ id, label }) => (
                <option key={id} value={id}>{label}{availability && !availability.has(id) ? '（待配置）' : ''}</option>
              ))}
            </select>
          </label>
          <div className="atlas-tutor__buttons">
            <button className="atlas-tutor__muted" type="button" onClick={copyPrompt}>复制辅学提示词</button>
            <button className="atlas-tutor__send" type="submit" disabled={!question.trim() || Boolean(busy)}>
              {busy === 'ask' ? '导师正在回复…' : '向导师提问'}
            </button>
          </div>
        </div>
        <div className="atlas-tutor__feedback" role="status">
          {feedback && <p>{feedback}</p>}
          {copyFeedback && <p>{copyFeedback}</p>}
        </div>
        {showPrompt && (
          <label className="atlas-tutor__label">
            辅学提示词
            <textarea readOnly ref={promptRef} rows={6} value={prompt} />
          </label>
        )}
      </form>
      {answer && (
        <section className="atlas-tutor__answer" aria-live="polite" aria-label={`${answer.label} 的答复`}>
          <h3>{answer.label} 的答复</h3>
          <p>{answer.text}</p>
        </section>
      )}
    </section>
  )
}
