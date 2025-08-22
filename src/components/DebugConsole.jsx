import { useEffect, useState } from 'react'
import { getBuffer, clear } from '../lib/log'

export default function DebugConsole({ open, onClose }) {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    function update(e) {
      setLogs(prev => [...prev, e.detail])
    }
    if (open) {
      setLogs(getBuffer())
      addEventListener('app:log', update)
      return () => removeEventListener('app:log', update)
    }
  }, [open])

  if (!open) return null

  async function copyAll() {
    try {
      const text = logs.map(l => `${new Date(l.t).toISOString()} [${l.level}] ${JSON.stringify(l.msg)}`).join('\n')
      await navigator.clipboard.writeText(text)
      alert('Logs copied to clipboard')
    } catch (e) {
      alert('Copy failed: ' + (e.message || e))
    }
  }

  function clearAll() {
    clear()
    setLogs([])
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="card" style={{ maxWidth: 900, width: '90vw', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Debug logs</h3>
          <button onClick={copyAll}>Copy</button>
          <button onClick={clearAll}>Clear</button>
          <button onClick={onClose}>Close</button>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {logs.map((l, i) => (
            <div key={i}>
              <span style={{ opacity: .7 }}>{new Date(l.t).toLocaleTimeString()} </span>
              <strong>[{l.level}]</strong> {JSON.stringify(l.msg)}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
