import { useEffect, useState } from 'react'
import './ui.css'
import RecordPanel from './components/RecordPanel.jsx'
import ClipList from './components/ClipList.jsx'
import UploadDrawer from './components/UploadDrawer.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import PairDevice from './components/PairDevice.jsx'
import DevicesPanel from './components/DevicesPanel.jsx'
import DebugConsole from './components/DebugConsole.jsx'
import { parseLaunchParams, getStatus, confirmPair, saveDeviceAuth } from './lib/deviceAuth'
import { info, warn, error as logError } from './lib/log'

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [settings, setSettings] = useState({ kbps: 64, sampleRate: 22050, chunk: Number(import.meta.env.VITE_DEFAULT_CHUNK_BYTES || import.meta.env.VITE_MAX_CHUNK_BYTES || 32768), deviceId: localStorage.getItem('micDeviceId') || '' })
  const apiBase = (import.meta.env.VITE_API_BASE || '').toString()
  const apiUploadDefault = apiBase ? `${apiBase.replace(/\/$/, '')}/audio/upload` : ''
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem('baseUrl') || (import.meta.env.VITE_API_BASE_URL || apiUploadDefault || ''))
  const [lastClipId, setLastClipId] = useState(null)
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(localStorage.getItem('selectedDeviceId') || '')

  useEffect(() => { localStorage.setItem('baseUrl', baseUrl || '') }, [baseUrl])
  useEffect(() => { localStorage.setItem('selectedDeviceId', selectedDeviceId || '') }, [selectedDeviceId])

  // Parse URL params for device pairing flow
  useEffect(() => {
    (async () => {
      try {
        const { device, action, session } = parseLaunchParams(window.location.search)
        if (device) {
          // Save/normalize device origin early so uploads know where to go
          saveDeviceAuth({ device })
          info('App: device param detected', { device })
          // Optional handshake
          try { await getStatus(device) } catch (e) { warn('App: device status failed', String(e)) }
        }
        if (action === 'pair' && session && device) {
          // Prompt for 6-digit code
          const code = window.prompt('Enter the 6-digit code shown on the device:', '')
          if (!code) return
          try {
            const { token, ttl } = await confirmPair({ device, session, code })
            info('App: device paired', { ttl, hasToken: !!token })
            alert('Device paired successfully')
          } catch (e) {
            logError('App: pairing failed', String(e))
            alert('Pairing failed: ' + (e.message || String(e)))
          }
        }
      } catch (e) {
        warn('App: param parse flow error', String(e))
      }
    })()
  }, [])

  const selectedDevice = devices.find(d => d.id === selectedDeviceId)

  return (
    <div className="app">
      <header className="header">
        <div className="brand">Story PWA</div>
        <div className="spacer" />
        <button className="icon" onClick={() => setDebugOpen(true)} title="Debug logs">🐞</button>
        <button className="icon" onClick={() => setSettingsOpen(true)} title="Settings">⚙️</button>
      </header>

      <main className="content">
        <RecordPanel onClipReady={setLastClipId} settings={settings} />

        <UploadDrawer baseUrl={baseUrl} setBaseUrl={setBaseUrl} />

        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Pair device</h3>
          <PairDevice onPaired={() => { /* Reload via DevicesPanel */ }} />
        </section>

        <DevicesPanel onChanged={(list) => {
          setDevices(list || [])
          if (!selectedDeviceId && (list || []).length) setSelectedDeviceId(list[0].id)
        }} />

        <section style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="devsel">Upload to device</label>
          <select id="devsel" value={selectedDeviceId} onChange={e => setSelectedDeviceId(e.target.value)}>
            <option value="">— None —</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.name || d.id}</option>
            ))}
          </select>
          {selectedDevice?.localUrl ? <small>{selectedDevice.localUrl}</small> : <small>Set Local URL in Devices</small>}
        </section>

        <section>
          <h3>Your clips</h3>
          <ClipList baseUrl={baseUrl} device={selectedDevice || null} key={lastClipId || 'list'} />
        </section>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
      <DebugConsole open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  )
}

export default App
