const CLOSED = '托管助手未接通。输入硬上界尚未证明，所以上游没有调用。这不是百炼账户的自然日总额。课程仍可阅读。'

function prefix() {
  return location.pathname.startsWith('/learning-hub/') ? '/learning-hub' : ''
}

export async function callManagedAi(entry, text) {
  const root = prefix()
  let session = ''
  try { session = sessionStorage.getItem('lh-managed-session') || '' } catch { session = '' }
  if (!session) {
    try {
      const created = await fetch(`${root}/api/ai/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await created.json()
      if (data?.sessionId) {
        session = data.sessionId
        try { sessionStorage.setItem('lh-managed-session', session) } catch { /* 会话只是匿名标记 */ }
      }
    } catch { /* 下面统一说明未接通 */ }
  }
  try {
    const response = await fetch(`${root}/api/ai/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID().replace(/-/g, ''),
        ...(session ? { 'X-Learning-Session': session } : {}),
      },
      body: JSON.stringify({ entry, text }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || typeof data?.reply !== 'string') throw new Error(data?.message || CLOSED)
    return data.reply
  } catch (error) {
    if (error instanceof TypeError) throw new Error(CLOSED)
    throw error
  }
}
