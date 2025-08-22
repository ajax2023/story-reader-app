import { useEffect, useRef, useState } from 'react'
import { MediaRecorderController } from '../lib/mediaRecorder.js'

export default function RecordPanel({ onClipReady, settings }) {
  const [title, setTitle] = useState('Story')
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [vu, setVu] = useState(0)
  const ctrlRef = useRef(null)

  useEffect(() => {
    let raf
    function tick() {
      const ctrl = ctrlRef.current
      if (ctrl && recording) {
        setVu(ctrl.getVolume())
        raf = requestAnimationFrame(tick)
      }
    }
    if (recording) raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [recording])

  // mic selection moved to SettingsModal

  useEffect(() => {
    ctrlRef.current = new MediaRecorderController()
    return () => ctrlRef.current = null
  }, [])

  async function start() {
    if (!ctrlRef.current) return
    try {
      await ctrlRef.current.start(title, { deviceId: settings?.deviceId || undefined })
    } catch (e) {
      console.warn('Selected mic failed, retrying default:', e)
      await ctrlRef.current.start(title)
    }
    setRecording(true)
    setDuration(0)
    const t0 = performance.now()
    const id = setInterval(() => setDuration(Math.floor((performance.now() - t0) / 1000)), 1000)
    ctrlRef.current._timer = id
  }

  async function stop() {
    setRecording(false)
    if (ctrlRef.current?._timer) clearInterval(ctrlRef.current._timer)
    const clipId = await ctrlRef.current.stop()
    setVu(0) // reset VU bar on stop
    onClipReady && onClipReady(clipId)
  }

  return (
    <div className="panel">
      <div className="row">
        <input className="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" />
      </div>
      <div className="vu">
        <div className="bar" style={{ width: `${Math.round(vu * 100)}%` }} />
      </div>
      <div className="row">
        <button className={recording ? 'stop' : 'record'} onClick={recording ? stop : start}>
          {recording ? 'Stop' : 'Record'}
        </button>
        <div className="duration">{duration}s</div>
      </div>
    </div>
  )
}
