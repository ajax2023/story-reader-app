import { useEffect, useRef, useState } from 'react'
import { getDB, listClips, deleteClip, updateClip, getAudioBlob } from '../lib/idb'
import { uploadClip } from '../lib/uploader'

export default function ClipList({ baseUrl }) {
  const [clips, setClips] = useState([])
  const [uploading, setUploading] = useState(null)
  const [progress, setProgress] = useState({})
  const [urls, setUrls] = useState({})
  const audioRef = useRef(null)
  const [playingId, setPlayingId] = useState(null)

  async function refresh() {
    setClips(await listClips())
  }
  useEffect(() => { refresh() }, [])

  async function handleRename(id) {
    const name = prompt('New title?')
    if (!name) return
    await updateClip(id, { title: name })
    refresh()
  }

  async function handleDelete(id) {
    if (!confirm('Delete clip?')) return
    await deleteClip(id)
    refresh()
  }

  async function ensureUrl(c) {
    if (urls[c.id]) return urls[c.id]
    if (!c.sizeBytes || c.sizeBytes <= 0) {
      console.warn('[Preview] Clip has zero sizeBytes:', c)
    }
    const blob = await getAudioBlob(c.id)
    if (!blob) {
      console.error('[Preview] No audio blob found for clip:', c.id)
      return null
    }
    console.info('[Preview] Got blob:', blob)
    console.info('[Preview] Blob size:', blob.size)
    const url = URL.createObjectURL(blob)
    setUrls(prev => ({ ...prev, [c.id]: url }))
    return url
  }

  async function handlePreview(c) {
    const el = audioRef.current || new Audio()
    audioRef.current = el
    if (playingId === c.id && !el.paused) {
      el.pause()
      setPlayingId(null)
      return
    }
    const url = await ensureUrl(c)
    el.src = url
    el.volume = 1.0
    el.onerror = () => {
      console.error('[Preview] Audio element error:', el.error)
    }
    el.onloadedmetadata = () => {
      console.info('[Preview] Loaded metadata. duration:', el.duration, 'readyState:', el.readyState)
    }
    el.onended = () => setPlayingId(null)
    await el.play().catch(() => {})
    setPlayingId(c.id)
  }

  async function handleUpload(id) {
    setUploading(id)
    try {
      await uploadClip({ clipId: id, baseUrl, onProgress: (p) => setProgress(prev => ({ ...prev, [id]: p })) })
      alert('Upload complete')
    } catch (e) {
      alert('Upload failed: ' + e.message)
    } finally {
      setUploading(null)
      refresh()
    }
  }

  return (
    <div className="clips">
      {clips.map(c => (
        <div className="clip" key={c.id}>
          <div className="meta">
            <div className="title">{c.title}</div>
            <div className="sub">{Math.round(c.duration)}s · {(c.sizeBytes / 1024).toFixed(1)} KB</div>
          </div>
          <div className="actions">
            <button onClick={() => handlePreview(c)}>
              {playingId === c.id ? 'Pause' : 'Preview'}
            </button>
            <a
              href={urls[c.id]}
              download={c.filename || (c.title || 'clip') + '.webm'}
              onMouseEnter={() => ensureUrl(c)}
              style={{ textDecoration: 'none' }}
            >
              <button>Save</button>
            </a>
            <button onClick={() => handleRename(c.id)}>Rename</button>
            <button onClick={() => handleDelete(c.id)}>Delete</button>
            <button disabled={!navigator.onLine || uploading === c.id || !baseUrl} onClick={() => handleUpload(c.id)}>
              {uploading === c.id ? `${Math.floor(((progress[c.id]?.offset||0)/(c.sizeBytes||1))*100)}%` : 'Upload'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
