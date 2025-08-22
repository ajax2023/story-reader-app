import { createClip, updateClip, appendPcmChunk, clearPcm, appendMp3Frame } from './idb'

const DEFAULT_SAMPLE_RATE = 22050
const DEFAULT_KBPS = 64

function sanitizeTitle(title) {
  const slug = (title || 'clip')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9-_]/g, '')
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${slug}__${y}${m}${d}-${hh}${mm}.mp3`
}

export class RecorderController {
  constructor() {
    this.mediaStream = null
    this.audioCtx = null
    this.node = null
    this.worker = null
    this.seq = 0
    this.sampleCursor = 0
    this.sampleRateIn = 44100
    this.clipId = null
    this.title = 'clip'
    this.durationStart = 0
    this.active = false
    this.vu = 0
  }

  get vuLevel() { return this.vu }

  async start(title = 'clip', { deviceId } = {}) {
    if (this.active) return
    this.title = title
    // reset counters for a fresh session
    this.seq = 0
    this.sampleCursor = 0
    // request raw mic (disable DSP that can suppress levels)
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.mediaStream = stream
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    this.audioCtx = ctx
    this.sampleRateIn = ctx.sampleRate
    try { if (ctx.state === 'suspended') await ctx.resume() } catch {}
    try {
      const track = stream.getAudioTracks?.()[0]
      console.info('[Recorder] Using device:', track?.label || '(default)')
    } catch {}

    // Create clip metadata
    const id = crypto.randomUUID()
    this.clipId = id
    await createClip({ id, title, duration: 0, sizeBytes: 0, md5: '', sampleRate: this.sampleRateIn, channels: 1 })

    // Setup worklet or fallback
    try {
      await ctx.audioWorklet.addModule(new URL('../audio/worklet-processor.js', import.meta.url))
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'mono-tap-processor')
      node.port.onmessage = (e) => {
        if (e.data?.type === 'pcm') this._onPcm(e.data.payload)
      }
      // keep node in graph but muted to avoid feedback
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(node)
      node.connect(mute).connect(ctx.destination)
      this.node = node
    } catch (err) {
      // Fallback ScriptProcessor
      const source = ctx.createMediaStreamSource(stream)
      const bufSize = 2048
      const proc = ctx.createScriptProcessor(bufSize, 1, 1)
      proc.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0)
        const data = new Float32Array(input)
        this._onPcm(data)
      }
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(proc)
      proc.connect(mute).connect(ctx.destination)
      this.node = proc
    }

    this.durationStart = performance.now()
    this.active = true
  }

  async _onPcm(float32) {
    if (!this.active) return
    // VU meter estimate
    let sum = 0
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i]
    const rms = Math.sqrt(sum / float32.length)
    this.vu = Math.min(1, rms * 3)

    // Persist PCM chunk sequentially with absolute start
    const start = this.sampleCursor
    await appendPcmChunk(this.clipId, this.seq, start, float32)
    this.seq += 1
    this.sampleCursor += float32.length
    const ms = performance.now() - this.durationStart
    const sec = Math.floor(ms / 1000)
    await updateClip(this.clipId, { duration: sec })
  }

  async stopAndEncode({ trimSilence = false } = {}) {
    if (!this.active) return null
    this.active = false

    // stop audio
    try { this.node && this.node.disconnect() } catch {}
    try { this.mediaStream?.getTracks().forEach(t => t.stop()) } catch {}
    try { await this.audioCtx?.close() } catch {}

    // Scan PCM for head/tail silence
    const threshold = 0.001
    let firstSample = 0
    let lastSample = 0
    let totalSamples = 0

    // First pass to compute totalSamples and firstSample
    await (async () => {
      const { iteratePcmChunks } = await import('./idb')
      firstSample = -1
      lastSample = -1
      await iteratePcmChunks(this.clipId, ({ buffer, sampleStart }) => {
        totalSamples = Math.max(totalSamples, sampleStart + buffer.length)
        if (firstSample !== -1) return
        for (let i = 0; i < buffer.length; i++) {
          if (Math.abs(buffer[i]) >= threshold) { firstSample = sampleStart + i; break }
        }
      })
      if (firstSample === -1) firstSample = 0
      // Second pass from the end to find lastSample
      const chunks = []
      await iteratePcmChunks(this.clipId, (c) => chunks.push(c))
      for (let c = chunks.length - 1; c >= 0; c--) {
        const { buffer, sampleStart } = chunks[c]
        for (let i = buffer.length - 1; i >= 0; i--) {
          if (Math.abs(buffer[i]) >= threshold) { lastSample = sampleStart + i + 1; break }
        }
        if (lastSample !== -1) break
      }
      if (lastSample === -1) lastSample = totalSamples
    })()

    // Use full PCM range without trimming to avoid assembly issues
    const totalOutSamples = totalSamples
    const fullPcm = new Float32Array(totalOutSamples)
    console.log('[Recorder] Assembling full PCM: totalSamples=', totalSamples)
    {
      const { iteratePcmChunks } = await import('./idb')
      let chunkCount = 0
      await iteratePcmChunks(this.clipId, ({ buffer, sampleStart }) => {
        chunkCount++
        // Simple direct copy without trimming logic
        fullPcm.set(buffer, sampleStart)
        if (chunkCount <= 3) {
          let min = Infinity, max = -Infinity, sum = 0
          for (let i = 0; i < buffer.length; i++) { const v = buffer[i]; if (v < min) min = v; if (v > max) max = v; sum += v*v }
          const rms = Math.sqrt(sum / Math.max(1, buffer.length))
          console.log(`[Recorder] PCM chunk ${chunkCount}: len=${buffer.length} min=${min.toFixed(4)} max=${max.toFixed(4)} rms=${rms.toFixed(4)}`)
        }
      })
      console.log('[Recorder] Total PCM chunks processed:', chunkCount)
    }

    // High-quality resample to 44100 Hz using OfflineAudioContext
    async function hqResampleMono(float32, inRate, outRate) {
      if (inRate === outRate) return float32
      try {
        const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, Math.ceil(float32.length * outRate / inRate), outRate)
        const buffer = offline.createBuffer(1, float32.length, inRate)
        buffer.copyToChannel(float32, 0)
        const src = offline.createBufferSource()
        src.buffer = buffer
        src.connect(offline.destination)
        src.start()
        const rendered = await offline.startRendering()
        const out = new Float32Array(rendered.length)
        rendered.copyFromChannel(out, 0)
        return out
      } catch (e) {
        // Fallback to linear interpolation
        const ratio = inRate / outRate
        const outLen = Math.floor(float32.length / ratio)
        const out = new Float32Array(outLen)
        for (let i = 0; i < outLen; i++) {
          const idx = i * ratio
          const idxPrev = Math.floor(idx)
          const idxNext = Math.min(float32.length - 1, idxPrev + 1)
          const frac = idx - idxPrev
          out[i] = float32[idxPrev] * (1 - frac) + float32[idxNext] * frac
        }
        return out
      }
    }

    // Use original sample rate to avoid resampling artifacts
    const TARGET_RATE = this.sampleRateIn
    const pcmOut = fullPcm // No resampling
    
    // Debug final PCM before encoding
    let min = Infinity, max = -Infinity, sum = 0
    for (let i = 0; i < pcmOut.length; i++) { const v = pcmOut[i]; if (v < min) min = v; if (v > max) max = v; sum += v*v }
    const rms = Math.sqrt(sum / Math.max(1, pcmOut.length))
    console.log(`[Recorder] Final PCM for encoding: len=${pcmOut.length} min=${min.toFixed(4)} max=${max.toFixed(4)} rms=${rms.toFixed(4)}`)

    // Encode via worker streaming with fallback; no resampling in worker
    const sampleRateOut = TARGET_RATE

    const doEncode = async (useClassic = false) => {
      let byteOffset = 0
      let frameSeq = 0

      const worker = useClassic
        ? new Worker(new URL('../workers/mp3Encoder.classic.worker.js', import.meta.url))
        : new Worker(new URL('../workers/mp3Encoder.worker.js', import.meta.url), { type: 'module' })

      let doneResolve, doneReject
      const donePromise = new Promise((res, rej) => { doneResolve = res; doneReject = rej })
      worker.onerror = (e) => {
        console.error('[Recorder] Worker error:', e)
        doneReject(e)
      }

      worker.onmessage = async (e) => {
        const { type, payload } = e.data
        console.log('[Recorder] Worker message:', type, payload ? Object.keys(payload) : 'no payload')
        if (type === 'data') {
          const { appendMp3Frame } = await import('./idb')
          await appendMp3Frame(this.clipId, frameSeq++, byteOffset, new Uint8Array(payload))
          byteOffset += payload.byteLength
        } else if (type === 'done') {
          const { md5, totalBytes } = payload
          const filename = sanitizeTitle(this.title)
          await updateClip(this.clipId, { status: 'ready', sizeBytes: totalBytes, md5, filename })
          await clearPcm(this.clipId)
          try { worker.terminate() } catch {}
          doneResolve()
        }
      }

      // init (worker will see in==out, so it won't resample). Use 2 channels (duplicate mono to stereo in worker)
      console.log('[Recorder] Sending init to worker:', { sampleRateIn: sampleRateOut, sampleRateOut, kbps: DEFAULT_KBPS, ch: 2 })
      worker.postMessage({ type: 'init', payload: { sampleRateIn: sampleRateOut, sampleRateOut, kbps: DEFAULT_KBPS, ch: 2 } })

      // safety: if trimming collapsed to nothing, fall back to full range
      if (!(lastSample > firstSample)) {
        firstSample = 0
        lastSample = totalSamples
      }

      // stream resampled PCM in chunks
      const frameSize = 1152 * 20 // encode in ~20-frame blocks
      console.log('[Recorder] Streaming PCM to worker in', Math.ceil(pcmOut.length / frameSize), 'chunks')
      for (let i = 0; i < pcmOut.length; i += frameSize) {
        const segment = pcmOut.subarray(i, Math.min(i + frameSize, pcmOut.length))
        const copy = segment.slice()
        console.log(`[Recorder] Sending chunk ${Math.floor(i/frameSize)+1}: len=${copy.length}`)
        worker.postMessage({ type: 'encode', payload: { pcm: copy } }, [copy.buffer])
      }
      worker.postMessage({ type: 'finish' })
      await donePromise
    }

    const doEncodeSimple = async () => {
      let byteOffset = 0
      let frameSeq = 0

      const worker = new Worker(new URL('../workers/mp3Encoder.simple.worker.js', import.meta.url))

      let doneResolve, doneReject
      const donePromise = new Promise((res, rej) => { doneResolve = res; doneReject = rej })
      worker.onerror = (e) => {
        console.error('[Recorder] Simple worker error:', e)
        doneReject(e)
      }

      worker.onmessage = async (e) => {
        const { type, payload } = e.data
        console.log('[Recorder] Simple worker message:', type, payload ? Object.keys(payload) : 'no payload')
        if (type === 'data') {
          const { appendMp3Frame } = await import('./idb')
          await appendMp3Frame(this.clipId, frameSeq++, byteOffset, new Uint8Array(payload))
          byteOffset += payload.byteLength
        } else if (type === 'done') {
          const { totalBytes } = payload
          const filename = sanitizeTitle(this.title)
          await updateClip(this.clipId, { status: 'ready', sizeBytes: totalBytes, md5: 'simple', filename })
          await clearPcm(this.clipId)
          try { worker.terminate() } catch {}
          doneResolve()
        }
      }

      // init simple worker (mono, no resampling)
      console.log('[Recorder] Sending init to simple worker:', { sampleRate: TARGET_RATE, kbps: DEFAULT_KBPS })
      worker.postMessage({ type: 'init', payload: { sampleRate: TARGET_RATE, kbps: DEFAULT_KBPS } })

      // stream resampled PCM in chunks
      const frameSize = 1152 * 20
      console.log('[Recorder] Streaming PCM to simple worker in', Math.ceil(pcmOut.length / frameSize), 'chunks')
      for (let i = 0; i < pcmOut.length; i += frameSize) {
        const segment = pcmOut.subarray(i, Math.min(i + frameSize, pcmOut.length))
        const copy = segment.slice()
        worker.postMessage({ type: 'encode', payload: { pcm: copy } }, [copy.buffer])
      }
      worker.postMessage({ type: 'finish' })
      await donePromise
    }

    try {
      await doEncode(false)
    } catch (e) {
      // Fallback to simple worker for direct encoding
      console.log('[Recorder] Falling back to simple worker')
      await doEncodeSimple()
    }
    return this.clipId
  }
}

export function sanitizeFilename(title) {
  return sanitizeTitle(title)
}
