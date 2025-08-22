import { openDB } from 'idb'

const DB_NAME = 'story-pwa'
const DB_VERSION = 3

// Stores:
// clips: { id, title, duration, sizeBytes, createdAt, md5, status, sampleRate, channels }
// pcm: { key: `${clipId}:${seq}`, clipId, seq, sampleStart, sampleEnd, buffer (Float32Array) } (legacy)
// frames: { key: `${clipId}:${seq}`, clipId, seq, byteStart, byteEnd, buffer (Uint8Array) } (legacy)
// blobs: { clipId, blob (Blob) }
// uploads: { clipId, strategy, offset, uploadId }

export async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      if (!db.objectStoreNames.contains('clips')) {
        const s = db.createObjectStore('clips', { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains('pcm')) {
        const s = db.createObjectStore('pcm', { keyPath: 'key' })
        s.createIndex('clipId', 'clipId')
        s.createIndex('clipId_seq', ['clipId', 'seq'])
      } else if (tx) {
        try { tx.objectStore('pcm').createIndex('clipId_seq', ['clipId', 'seq']) } catch {}
      }
      if (!db.objectStoreNames.contains('frames')) {
        const s = db.createObjectStore('frames', { keyPath: 'key' })
        s.createIndex('clipId', 'clipId')
      }
      if (!db.objectStoreNames.contains('uploads')) {
        db.createObjectStore('uploads', { keyPath: 'clipId' })
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'clipId' })
      }
    }
  })
}

export async function createClip(meta) {
  const db = await getDB()
  const value = { ...meta, status: 'recording', sizeBytes: 0, createdAt: Date.now() }
  await db.put('clips', value)
  return value
}

export async function updateClip(id, patch) {
  const db = await getDB()
  const clip = await db.get('clips', id)
  if (!clip) throw new Error('Clip not found')
  const value = { ...clip, ...patch }
  await db.put('clips', value)
  return value
}

export async function listClips() {
  const db = await getDB()
  const tx = db.transaction('clips')
  const idx = tx.store.index('createdAt')
  const result = []
  for await (const cursor of idx.iterate(null, 'prev')) {
    result.push(cursor.value)
  }
  return result
}

export async function deleteClip(id) {
  const db = await getDB()
  // delete related stores
  const pcmKeys = await db.getAllKeysFromIndex('pcm', 'clipId', IDBKeyRange.only(id))
  for (const key of pcmKeys) await db.delete('pcm', key)
  const frameKeys = await db.getAllKeysFromIndex('frames', 'clipId', IDBKeyRange.only(id))
  for (const key of frameKeys) await db.delete('frames', key)
  await db.delete('blobs', id)
  await db.delete('uploads', id)
  await db.delete('clips', id)
}

// PCM handling
export async function appendPcmChunk(clipId, seq, sampleStart, samples) {
  const db = await getDB()
  const key = `${clipId}:${seq}`
  await db.put('pcm', { key, clipId, seq, sampleStart, sampleEnd: sampleStart + samples.length, buffer: samples })
}

export async function iteratePcmChunks(clipId, handler) {
  const db = await getDB()
  const tx = db.transaction('pcm')
  const idx = tx.store.index('clipId_seq')
  const range = IDBKeyRange.bound([clipId, 0], [clipId, Number.MAX_SAFE_INTEGER])
  for await (const cursor of idx.iterate(range)) {
    await handler(cursor.value)
  }
}

export async function clearPcm(clipId) {
  const db = await getDB()
  const keys = await db.getAllKeysFromIndex('pcm', 'clipId', IDBKeyRange.only(clipId))
  for (const key of keys) await db.delete('pcm', key)
}

export async function getPcmRange(clipId, startSample, endSample) {
  const db = await getDB()
  const tx = db.transaction('pcm')
  const idx = tx.store.index('clipId_seq')
  const range = IDBKeyRange.bound([clipId, 0], [clipId, Number.MAX_SAFE_INTEGER])
  const total = Math.max(0, endSample - startSample)
  const out = new Float32Array(total)
  for await (const cursor of idx.iterate(range)) {
    const c = cursor.value
    if (c.sampleEnd <= startSample) continue
    if (c.sampleStart >= endSample) continue
    const sliceStart = Math.max(0, startSample - c.sampleStart)
    const sliceEnd = Math.min(c.buffer.length, endSample - c.sampleStart)
    if (sliceEnd <= sliceStart) continue
    const view = c.buffer.subarray(sliceStart, sliceEnd)
    const destStart = Math.max(0, c.sampleStart - startSample)
    out.set(view, destStart)
  }
  return out
}

// Audio blob handling (for MediaRecorder)
export async function saveAudioBlob(clipId, blob) {
  const db = await getDB()
  await db.put('blobs', { clipId, blob })
}

export async function getAudioBlob(clipId) {
  const db = await getDB()
  const result = await db.get('blobs', clipId)
  return result?.blob
}

// MP3 frames handling (legacy)
export async function appendMp3Frame(clipId, seq, byteStart, buf) {
  const db = await getDB()
  const key = `${clipId}:${seq}`
  await db.put('frames', { key, clipId, seq, byteStart, byteEnd: byteStart + buf.length, buffer: buf })
  const clip = await db.get('clips', clipId)
  if (clip) {
    clip.sizeBytes = Math.max(clip.sizeBytes || 0, byteStart + buf.length)
    await db.put('clips', clip)
  }
}

export async function getMp3Chunk(clipId, start, endExclusive) {
  const db = await getDB()
  const idx = db.transaction('frames').store.index('clipId')
  const out = new Uint8Array(Math.max(0, endExclusive - start))
  for await (const cursor of idx.iterate(IDBKeyRange.only(clipId))) {
    const f = cursor.value
    if (f.byteEnd <= start) continue
    if (f.byteStart >= endExclusive) continue
    const sliceStart = Math.max(0, start - f.byteStart)
    const sliceEnd = Math.min(f.buffer.length, endExclusive - f.byteStart)
    if (sliceEnd <= sliceStart) continue
    const view = f.buffer.subarray(sliceStart, sliceEnd)
    const destStart = Math.max(0, f.byteStart - start) + 0
    out.set(view, destStart)
  }
  return out
}

// Upload checkpoints
export async function getUploadState(clipId) {
  const db = await getDB()
  return (await db.get('uploads', clipId)) || { clipId, offset: 0 }
}

export async function setUploadState(clipId, patch) {
  const db = await getDB()
  const curr = (await db.get('uploads', clipId)) || { clipId, offset: 0 }
  const next = { ...curr, ...patch }
  await db.put('uploads', next)
  return next
}
