// Lightweight logger with in-memory ring buffer and optional debug toggle
const DEBUG = (() => {
  try {
    if (import.meta && import.meta.env && import.meta.env.VITE_DEBUG === '1') return true
  } catch {}
  try { if (typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG') === '1') return true } catch {}
  try { if (typeof location !== 'undefined' && /[?&]debug=1(?!\d)/.test(location.search)) return true } catch {}
  return false
})()

const maxEntries = 500
const buf = []

function push(level, args) {
  const entry = { t: Date.now(), level, msg: args.map(a => safe(a)) }
  buf.push(entry)
  if (buf.length > maxEntries) buf.shift()
  try {
    dispatchEvent(new CustomEvent('app:log', { detail: entry }))
  } catch {}
}

function safe(v) {
  try { return typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v } catch { return String(v) }
}

export function getBuffer() { return buf.slice() }
export function clear() { buf.length = 0 }

export function debug(...args) { if (DEBUG) { console.debug('[DBG]', ...args); push('debug', args) } }
export function info(...args) { console.info('[INF]', ...args); push('info', args) }
export function warn(...args) { console.warn('[WRN]', ...args); push('warn', args) }
export function error(...args) { console.error('[ERR]', ...args); push('error', args) }
