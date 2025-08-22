import { useState } from 'react'
import { claimPair } from '../lib/api'

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
      await claimPair(c)
      setCode('')
      onPaired && onPaired()
    } catch (err) {
      setError(err.message || 'Pairing failed')
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
