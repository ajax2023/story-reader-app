import { useState } from 'react'
import { claimPair } from '../lib/api'
import { info, error as logError, debug } from '../lib/log'

export default function PairDevice({ onPaired }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    const c = (code || '').trim().toUpperCase()
    if (c.length !== 7) { setError('Enter 7-character code'); return }
    setBusy(true)
    try {
      info('PairDevice: claiming code', { code: c })
      const res = await claimPair(c)
      debug('PairDevice: claim result', res)
      setCode('')
      onPaired && onPaired()
    } catch (err) {
      setError(err.message || 'Pairing failed')
      logError('PairDevice: claim failed', { error: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label htmlFor="code">Pair code</label>
      <input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXXXXX" maxLength={7} autoCapitalize="characters" />
      <button disabled={busy || code.length !== 7} type="submit">{busy ? 'Pairing…' : 'Pair'}</button>
      {error && <span style={{ color: 'crimson' }}>{error}</span>}
    </form>
  )
}
