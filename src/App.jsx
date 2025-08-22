import { useEffect, useState } from 'react'
import './ui.css'
import RecordPanel from './components/RecordPanel.jsx'
import ClipList from './components/ClipList.jsx'
import UploadDrawer from './components/UploadDrawer.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import PairDevice from './components/PairDevice.jsx'
import DevicesPanel from './components/DevicesPanel.jsx'
import DebugConsole from './components/DebugConsole.jsx'
import { parseLaunchParams, getStatus, confirmPair, saveDeviceAuth, loadDeviceAuth, clearDeviceAuth, warnIfNonProdOrigin } from './lib/deviceAuth'
import { getDeviceById, createDevice } from './lib/api'
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
  const [{ pairedDevice }, setPaired] = useState({ pairedDevice: (loadDeviceAuth().device || '') })

  useEffect(() => { localStorage.setItem('baseUrl', baseUrl || '') }, [baseUrl])
  useEffect(() => { localStorage.setItem('selectedDeviceId', selectedDeviceId || '') }, [selectedDeviceId])

  // Parse URL params for device pairing flow
  useEffect(() => {
    (async () => {
      try {
        if (warnIfNonProdOrigin()) {
          alert('Note: Device CORS allows only https://story-reader-pwa.web.app. Pairing/uploads may fail on this origin.')
        }
        const { device, action, session, deviceId } = parseLaunchParams(window.location.search)
        if (device) {
          // Save/normalize device origin early so uploads know where to go
          saveDeviceAuth({ device })
          info('App: device param detected', { device })
          // Optional handshake
          try { await getStatus(device) } catch (e) { warn('App: device status failed', String(e)) }
          setPaired({ pairedDevice: loadDeviceAuth().device || '' })
        }
        // Registration check: if deviceId provided, ensure it's in backend
        if (deviceId) {
          try {
            const existing = await getDeviceById(deviceId)
            if (!existing) {
              if (window.confirm(`Register device ${deviceId} to your account?`)) {
                await createDevice({ id: deviceId, name: deviceId })
                info('App: device registered', { deviceId })
              } else {
                info('App: device registration canceled by user', { deviceId })
              }
            }
          } catch (e) {
            warn('App: device registration check failed', String(e))
          }
        }

        // Pairing: try silent confirm first; only prompt for code if required by device
        if (action === 'pair' && session && device) {
          try {
            const { token, ttl } = await confirmPair({ device, session, deviceId })
            info('App: device paired (silent)', { ttl, hasToken: !!token })
            alert('Device paired successfully')
            setPaired({ pairedDevice: loadDeviceAuth().device || '' })
          } catch (e) {
            const msg = String(e?.message || e || '')
            const needCode = (e && (e.code === 'code_required' || e.status === 403)) || /code/i.test(msg)
            if (!needCode) {
              logError('App: pairing failed (silent)', msg)
              alert('Pairing failed: ' + msg)
              return
            }
            const code = window.prompt('Enter the 6-digit code shown on the device:', '')
            if (!code) {
              warn('App: code entry canceled')
              return
            }
            try {
              const { token, ttl } = await confirmPair({ device, session, deviceId, code })
              info('App: device paired (with code)', { ttl, hasToken: !!token })
              alert('Device paired successfully')
              setPaired({ pairedDevice: loadDeviceAuth().device || '' })
            } catch (e2) {
              logError('App: pairing failed (with code)', String(e2))
              alert('Pairing failed: ' + (e2.message || String(e2)))
            }
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
        {pairedDevice ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <small style={{ opacity: 0.8 }}>Paired: {pairedDevice}</small>
            <button className="icon" title="Forget device" onClick={() => { if (confirm('Forget paired device?')) { clearDeviceAuth(); setPaired({ pairedDevice: '' }); alert('Device forgotten. Re-pair to continue.')} }}>🗑️</button>
          </div>
        ) : null}
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
