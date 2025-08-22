import { getUploadState, setUploadState, getDB, getMp3Chunk } from './idb'

const DEFAULT_CHUNK = Number(import.meta.env.VITE_MAX_CHUNK_BYTES || 32768)
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

  const state = await getUploadState(clipId)
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

    await setUploadState(clipId, { strategy, offset: remoteOffset })

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
      await setUploadState(clipId, { offset })
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
    await setUploadState(clipId, { uploadId, strategy: 'three-step', offset: 0 })
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
