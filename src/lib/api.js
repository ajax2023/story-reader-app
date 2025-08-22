import { debug, info, warn, error } from './log'

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

  info('API request', { url: `${API_BASE}${path}`, method, headers: opts.headers })
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, opts)
  } catch (e) {
    error('API network error', { url: `${API_BASE}${path}`, error: String(e) })
    throw e
  }
  const ct = res.headers.get('content-type') || ''
  const status = res.status
  if (!res.ok) {
    let msg = `${status}`
    if (ct.includes('application/json')) {
      try { const data = await res.json(); msg = data.message || msg; error('API error', { url: `${API_BASE}${path}`, status, data }) } catch {}
    } else {
      try { const text = await res.text(); msg = text || msg; error('API error', { url: `${API_BASE}${path}`, status, text }) } catch {}
    }
    throw new Error(msg)
  }
  if (ct.includes('application/json')) {
    const data = await res.json()
    debug('API response', { url: `${API_BASE}${path}`, status, data })
    return data
  }
  const text = await res.text()
  debug('API response (text)', { url: `${API_BASE}${path}`, status, textSample: text.slice(0, 200) })
  return text
}

export async function claimPair(code) {
  if (!code || code.length !== 7) throw new Error('Enter 7-character code')
  const result = await request('/pair/claim', { method: 'POST', json: { code } })
  info('Pair claim result', result)
  return result
}

export async function getMyDevices() {
  const raw = await request('/me/devices', { method: 'GET' })
  debug('getMyDevices raw', raw)
  if (Array.isArray(raw)) return raw
  if (raw && Array.isArray(raw.devices)) return raw.devices
  if (raw && raw.data && Array.isArray(raw.data.devices)) return raw.data.devices
  warn('getMyDevices returned non-array; normalizing to empty list')
  return []
}

export async function patchDevice(id, patch) {
  const result = await request(`/devices/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch })
  info('Device patched', { id, patch, result })
  return result
}
