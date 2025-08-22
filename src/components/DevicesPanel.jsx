import { useEffect, useState } from 'react'
import { getMyDevices, patchDevice } from '../lib/api'
import { saveDevice, listDevices as listCachedDevices } from '../lib/idb'
import { info, warn, error as logError, debug } from '../lib/log'

export default function DevicesPanel({ onChanged }) {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setLoading(true)
    try {
      info('DevicesPanel: loading devices')
      const fresh = await getMyDevices()
      const list = Array.isArray(fresh) ? fresh : (Array.isArray(fresh?.devices) ? fresh.devices : [])
      debug('DevicesPanel: devices raw', fresh)
      const normalized = (list || []).map(d => ({ id: d.id, name: d.name || d.id, lastSeen: d.lastSeen || null, localUrl: d.localUrl || '' }))
      setDevices(normalized)
      for (const d of normalized) await saveDevice(d)
      onChanged && onChanged(normalized)
    } catch (e) {
      setError(e.message || 'Failed to load devices, showing cached list')
      logError('DevicesPanel: load failed', { error: String(e) })
      const cached = await listCachedDevices()
      warn('DevicesPanel: using cached devices', cached)
      setDevices(cached)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function save(idx) {
    const d = devices[idx]
    try {
      info('DevicesPanel: saving device', { id: d.id, localUrl: d.localUrl })
      await patchDevice(d.id, { localUrl: d.localUrl })
      await saveDevice(d)
      onChanged && onChanged(devices)
      alert('Saved')
    } catch (e) {
      logError('DevicesPanel: save failed', { error: String(e) })
      alert('Save failed: ' + (e.message || ''))
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Devices</h3>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        {error && <span style={{ color: 'crimson' }}>{error}</span>}
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {devices.map((d, idx) => (
          <div key={d.id} style={{ border: '1px solid #334', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{d.name}</strong>
              <small>{d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}</small>
            </div>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Local URL (http://device.local or http://192.168.x.x)</span>
              <input value={d.localUrl || ''} onChange={e => {
                const next = [...devices]; next[idx] = { ...d, localUrl: e.target.value }; setDevices(next)
              }} placeholder="http://storyboard.local" />
            </label>
            <div>
              <button onClick={() => save(idx)}>Save</button>
            </div>
          </div>
        ))}
        {devices.length === 0 && !loading && <div>No devices</div>}
      </div>
    </section>
  )
}
