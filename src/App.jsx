import { useEffect, useState } from 'react'
import './ui.css'
import RecordPanel from './components/RecordPanel.jsx'
import ClipList from './components/ClipList.jsx'
import UploadDrawer from './components/UploadDrawer.jsx'
import SettingsModal from './components/SettingsModal.jsx'

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState({ kbps: 64, sampleRate: 22050, chunk: Number(import.meta.env.VITE_MAX_CHUNK_BYTES || 32768), deviceId: localStorage.getItem('micDeviceId') || '' })
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem('baseUrl') || (import.meta.env.VITE_API_BASE_URL || ''))
  const [lastClipId, setLastClipId] = useState(null)

  useEffect(() => { localStorage.setItem('baseUrl', baseUrl || '') }, [baseUrl])

  return (
    <div className="app">
      <header className="header">
        <div className="brand">Story PWA</div>
        <div className="spacer" />
        <button className="icon" onClick={() => setSettingsOpen(true)} title="Settings">⚙️</button>
      </header>

      <main className="content">
        <RecordPanel onClipReady={setLastClipId} settings={settings} />

        <UploadDrawer baseUrl={baseUrl} setBaseUrl={setBaseUrl} />

        <section>
          <h3>Your clips</h3>
          <ClipList baseUrl={baseUrl} key={lastClipId || 'list'} />
        </section>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
    </div>
  )
}

export default App
