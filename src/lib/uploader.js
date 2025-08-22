import { getUploadState, setUploadState, getDB, getMp3Chunk } from './idb'
import { authHeaders, loadDeviceAuth, clearDeviceAuth } from './deviceAuth'

const DEFAULT_CHUNK = Number(import.meta.env.VITE_MAX_CHUNK_BYTES || import.meta.env.VITE_DEFAULT_CHUNK_BYTES || 32768)
const MAX_FILE_BYTES = Number(import.meta.env.VITE_MAX_FILE_BYTES || 52428800)

async function fetchWithRetry(url, opts, { retries = 3, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...opts, signal: ac.signal })
      clearTimeout(t)
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 300))
        continue
      }
      return res
    } catch (e) {
      clearTimeout(t)
      if (attempt >= retries) throw e
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 300))
    }
  }
}

async function probeStrategy(baseUrl) {
  try {
    const res = await fetch(baseUrl, { method: 'HEAD' })
    const ranges = res.headers.get('accept-ranges') || res.headers.get('Accept-Ranges') || ''
    if (ranges.toLowerCase().includes('bytes')) return { kind: 'content-range' }
  } catch {}
  return { kind: 'three-step' }
}

export async function uploadClip({ clipId, baseUrl, onProgress }) {
  if (!baseUrl) throw new Error('Base URL is required')
  const db = await getDB()
  const clip = await db.get('clips', clipId)
  if (!clip) throw new Error('Clip not found')
  if (clip.sizeBytes > MAX_FILE_BYTES) throw new Error('File too large for upload limit')

  const targetKey = baseUrl || 'default'
  const state = await getUploadState(clipId, targetKey)
  const chunkBytesDefault = DEFAULT_CHUNK
  const strategy = state.strategy || (await probeStrategy(baseUrl)).kind

  if (strategy === 'content-range') {
    // Try to get remote offset via HEAD
    let remoteOffset = state.offset || 0
    try {
      const head = await fetchWithRetry(baseUrl, { method: 'HEAD' })
      const len = head.headers.get('content-length')
      if (len) remoteOffset = Math.max(remoteOffset, Number(len))
      const off = head.headers.get('x-upload-offset')
      if (off) remoteOffset = Math.max(remoteOffset, Number(off))
    } catch {}

    await setUploadState(clipId, targetKey, { strategy, offset: remoteOffset })

    let offset = remoteOffset
    let chunkBytes = chunkBytesDefault
    while (offset < clip.sizeBytes) {
      const end = Math.min(clip.sizeBytes, offset + chunkBytes)
      const body = await getMp3Chunk(clipId, offset, end)
      const res = await fetchWithRetry(baseUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${offset}-${end - 1}/${clip.sizeBytes}`,
          ...(clip.md5 ? { 'Content-MD5': clip.md5 } : {})
        },
        body
      }).catch(async (e) => {
        // adaptive down on timeout/abort
        if (chunkBytes > 8192) chunkBytes = Math.max(8192, Math.floor(chunkBytes / 2))
        throw e
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      offset = end
      await setUploadState(clipId, targetKey, { offset })
      onProgress && onProgress({ offset, total: clip.sizeBytes })
    }
    return { ok: true }
  }

  // three-step
  let { uploadId } = state
  if (!uploadId) {
    const initRes = await fetchWithRetry(`${baseUrl}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeBytes: clip.sizeBytes, md5: clip.md5 || null, filename: clip.filename || 'clip.mp3' })
    })
    if (!initRes.ok) throw new Error('Init failed')
    const data = await initRes.json()
    uploadId = data.uploadId
    await setUploadState(clipId, targetKey, { uploadId, strategy: 'three-step', offset: 0 })
  }

  let offset = state.offset || 0
  let chunkBytes = chunkBytesDefault
  while (offset < clip.sizeBytes) {
    const end = Math.min(clip.sizeBytes, offset + chunkBytes)
    const body = await getMp3Chunk(clipId, offset, end)
    const res = await fetchWithRetry(`${baseUrl}/chunk?uploadId=${encodeURIComponent(uploadId)}&offset=${offset}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body
    }).catch(async (e) => {
      if (chunkBytes > 8192) chunkBytes = Math.max(8192, Math.floor(chunkBytes / 2))
      throw e
    })
    if (!res.ok) throw new Error(`Chunk failed: ${res.status}`)
    offset = end
    await setUploadState(clipId, { offset })
    onProgress && onProgress({ offset, total: clip.sizeBytes })
  }

  const fin = await fetchWithRetry(`${baseUrl}/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, sizeBytes: clip.sizeBytes, md5: clip.md5 || null })
  })
  if (!fin.ok) throw new Error('Finish failed')
  return { ok: true }
}

// Upload directly to a paired device over LAN using either Content-Range or a three-step protocol.
// device: { id, localUrl }
export async function uploadToDevice({ clipId, device, onProgress }) {
  // Normalize device origin and ensure token is present
  const { token, device: pairedDevice } = loadDeviceAuth()
  const localUrl = device?.localUrl || pairedDevice || ''
  if (!localUrl) throw new Error('No device URL found. Set Local URL or pair the device.')
  if (!token) {
    // It's possible some endpoints allow no auth, but per spec uploads require token
    throw new Error('Missing device token. Please pair the device again.')
  }

  const db = await getDB()
  const clip = await db.get('clips', clipId)
  if (!clip) throw new Error('Clip not found')
  if (clip.sizeBytes > MAX_FILE_BYTES) throw new Error('File too large for upload limit')

  const filenameRaw = clip.filename || (clip.title ? `${clip.title}.mp3` : `${clipId}.mp3`)
  const filename = encodeURIComponent(filenameRaw)
  const origin = localUrl.startsWith('http') ? localUrl : `http://${localUrl}`
  const headUrl = `${origin.replace(/\/$/, '')}/upload?name=${filename}`
  const postUrl = `${origin.replace(/\/$/, '')}/upload`
  const targetKey = device?.id || localUrl

  const state = await getUploadState(clipId, targetKey)
  let offset = state.offset || 0
  let chunkBytes = DEFAULT_CHUNK

  // 1) HEAD to get current offset
  try {
    const head = await fetchWithRetry(headUrl, { method: 'HEAD', mode: 'cors', headers: { ...authHeaders() } })
    if (head.status === 401) {
      clearDeviceAuth()
      throw new Error('401 unauthorized (token expired). Please re-pair the device.')
    }
    const off = head.headers.get('Upload-Offset') || head.headers.get('upload-offset')
    if (off) offset = Math.max(offset, Number(off))
  } catch {}

  await setUploadState(clipId, targetKey, { strategy: 'content-range', offset })

  // 2) Send chunks with Content-Range
  while (offset < clip.sizeBytes) {
    const end = Math.min(clip.sizeBytes - 1, offset + chunkBytes - 1)
    const bodyBytes = await getMp3Chunk(clipId, offset, end + 1)
    const form = new FormData()
    form.append('file', new Blob([bodyBytes], { type: 'audio/mpeg' }), filenameRaw)

    const res = await fetchWithRetry(postUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        ...authHeaders(),
        'Content-Range': `bytes ${offset}-${end}/${clip.sizeBytes}`
      },
      body: form
    }).catch(async (e) => {
      if (chunkBytes > 8192) chunkBytes = Math.max(8192, Math.floor(chunkBytes / 2))
      throw e
    })

    if (res.status === 401) {
      clearDeviceAuth()
      throw new Error('401 unauthorized (token expired). Please re-pair the device.')
    }

    if (res.status === 308 || res.status === 201 || res.ok) {
      const next = res.headers.get('Upload-Offset')
      if (next != null) {
        offset = Number(next)
      } else {
        // Fallback: if 201 or ok without header, assume we advanced to end + 1
        offset = end + 1
      }
      await setUploadState(clipId, targetKey, { offset })
      onProgress && onProgress({ offset, total: clip.sizeBytes })
      if (offset >= clip.sizeBytes) break
    } else {
      throw new Error(`Upload failed: ${res.status}`)
    }
  }

  return { ok: true }
}
