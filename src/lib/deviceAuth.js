import { info, warn, error as logError, debug } from './log'

export function parseLaunchParams(search = window.location.search) {
  const q = new URLSearchParams(search || '')
  let device = q.get('device') || ''
  const action = (q.get('action') || '').toLowerCase()
  const session = q.get('session') || ''
  try {
    if (device && !/^https?:\/\//i.test(device)) device = `http://${device}`
    if (device) {
      const u = new URL(device)
      device = `${u.protocol}//${u.host}` // normalize, strip path
    }
  } catch {}
  return { device, action, session }
}

export function saveDeviceAuth({ device, token, ttl }) {
  if (device) localStorage.setItem('storyDevice', device)
  if (token) localStorage.setItem('storyToken', token)
  if (ttl && Number.isFinite(Number(ttl))) {
    const exp = Date.now() + Number(ttl) * 1000
    localStorage.setItem('storyTokenExp', String(exp))
  }
  info('deviceAuth: saved', { device, hasToken: !!token, ttl })
}

export function loadDeviceAuth() {
  const device = localStorage.getItem('storyDevice') || ''
  const token = localStorage.getItem('storyToken') || ''
  const expStr = localStorage.getItem('storyTokenExp') || ''
  const exp = expStr ? Number(expStr) : 0
  const expired = exp && Date.now() > exp
  return { device, token, exp, expired }
}

export function authHeaders() {
  const { token } = loadDeviceAuth()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getStatus(device) {
  try {
    const res = await fetch(`${device.replace(/\/$/, '')}/status`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: { ...authHeaders() },
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const json = await res.json().catch(() => ({}))
    debug('deviceAuth: status', json)
    return json
  } catch (e) {
    warn('deviceAuth: status failed', String(e))
    throw e
  }
}

export async function confirmPair({ device, session, code }) {
  const body = new URLSearchParams({ session, code })
  const res = await fetch(`${device.replace(/\/$/, '')}/pair/confirm`, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  })
  if (!res.ok) {
    let msg = `pair failed: ${res.status}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  const { token, ttl } = await res.json()
  if (!token) throw new Error('No token returned')
  saveDeviceAuth({ device, token, ttl })
  return { token, ttl }
}
