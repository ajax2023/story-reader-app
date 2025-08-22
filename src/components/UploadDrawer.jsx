import { useEffect, useState } from 'react'

export default function UploadDrawer({ baseUrl, setBaseUrl }) {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  return (
    <div className="drawer">
      <label>Upload Endpoint</label>
      <input placeholder="https://device-or-api/upload" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
      <div className={`net ${online ? 'ok' : 'bad'}`}>{online ? 'Online' : 'Offline'}</div>
    </div>
  )
}
