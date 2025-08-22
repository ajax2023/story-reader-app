export const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

async function request(path, { method = 'GET', headers = {}, body, json } = {}) {
  const opts = {
    method,
    headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    credentials: 'include',
  }
  if (json) opts.body = JSON.stringify(json)
  else if (body) opts.body = body

  const res = await fetch(`${API_BASE}${path}`, opts)
  if (!res.ok) {
    let msg = `${res.status}`
    try { const data = await res.json(); msg = data.message || msg } catch {}
    throw new Error(msg)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res.text()
}

export async function claimPair(code) {
  if (!code || code.length !== 7) throw new Error('Enter 7-character code')
  return request('/pair/claim', { method: 'POST', json: { code } })
}

export async function getMyDevices() {
  return request('/me/devices', { method: 'GET' })
}

export async function patchDevice(id, patch) {
  return request(`/devices/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch })
}
