import { useEffect, useState } from 'react'

export default function SettingsModal({ open, onClose, settings, setSettings }) {
  const [local, setLocal] = useState(settings)
  const [devices, setDevices] = useState([])
  
  useEffect(() => { setLocal(settings) }, [settings])
  
  useEffect(() => {
    if (!open) return
    async function loadDevices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        setDevices(list.filter(d => d.kind === 'audioinput'))
      } catch {}
    }
    loadDevices()
    const onChange = () => loadDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
  }, [open])
  if (!open) return null
  return (
    <div className="modal">
      <div className="card">
        <h3>Settings</h3>
        <label>Microphone
          <select
            value={local.deviceId || ''}
            onChange={(e) => { const v = e.target.value; setLocal({ ...local, deviceId: v }); localStorage.setItem('micDeviceId', v) }}
          >
            <option value="">System default microphone</option>
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>
        <label>Bitrate (kbps)
          <input type="number" min="32" max="128" value={local.kbps} onChange={e => setLocal({ ...local, kbps: Number(e.target.value) })} />
        </label>
        <label>Sample rate (Hz)
          <input type="number" min="16000" max="44100" value={local.sampleRate} onChange={e => setLocal({ ...local, sampleRate: Number(e.target.value) })} />
        </label>
        <label>Chunk size (bytes)
          <input type="number" min="8192" max="131072" step="1024" value={local.chunk} onChange={e => setLocal({ ...local, chunk: Number(e.target.value) })} />
        </label>
        <div className="row">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => { setSettings(local); onClose() }}>Save</button>
        </div>
      </div>
    </div>
  )
}
