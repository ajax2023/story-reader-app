/*
  Classic Worker version of the MP3 encoder.
  Loads UMD builds via importScripts for maximum compatibility.
  NOTE: For production/offline, copy these files locally to /public/vendor and switch URLs.
*/

// Temporary CDN sources (dev). For production, vendor these locally.
importScripts('https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js')
importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js')

let encoder = null
let md5 = null
let totalBytes = 0
let inputSampleRate = 44100
let targetSampleRate = 22050
let channels = 1

function resampleMono(float32, inRate, outRate) {
  if (inRate === outRate) return float32
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

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length)
  const gain = 10.0 // 20dB boost to fix low levels
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i] * gain))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

self.onmessage = (e) => {
  const { type, payload } = e.data || {}
  if (type === 'init') {
    const { sampleRateIn, sampleRateOut = 22050, kbps = 64, ch = 1 } = payload
    inputSampleRate = sampleRateIn
    targetSampleRate = sampleRateOut
    channels = ch
    encoder = new self.lamejs.Mp3Encoder(channels, targetSampleRate, kbps)
    md5 = new self.SparkMD5.ArrayBuffer()
    totalBytes = 0
    console.log('[ClassicWorker] init srIn=', inputSampleRate, 'srOut=', targetSampleRate, 'ch=', channels, 'kbps=', kbps)
    return
  }
  if (type === 'encode') {
    if (!encoder) return
    let { pcm } = payload // Float32Array mono (already resampled in main thread)
    // No resampling needed since main thread handles it
    // pcm = resampleMono(pcm, inputSampleRate, targetSampleRate)
    
    // Debug first chunk
    if (totalBytes === 0) {
      let min = Infinity, max = -Infinity, sum = 0
      for (let i = 0; i < Math.min(pcm.length, 1000); i++) { 
        const v = pcm[i]; if (v < min) min = v; if (v > max) max = v; sum += v*v 
      }
      const rms = Math.sqrt(sum / Math.min(pcm.length, 1000))
      console.log('[ClassicWorker] first encode slice len=', pcm.length, 'min=', min.toFixed(4), 'max=', max.toFixed(4), 'rms=', rms.toFixed(4))
    }
    
    const frameSize = 1152
    for (let i = 0; i < pcm.length; i += frameSize) {
      const slice = pcm.subarray(i, Math.min(i + frameSize, pcm.length))
      const pcm16 = floatTo16BitPCM(slice)
      let mp3buf
      if (channels === 2) {
        mp3buf = encoder.encodeBuffer(pcm16, pcm16)
      } else {
        mp3buf = encoder.encodeBuffer(pcm16)
      }
      if (mp3buf && mp3buf.length > 0) {
        const arr = new Uint8Array(mp3buf)
        md5.append(arr.buffer)
        totalBytes += arr.length
        self.postMessage({ type: 'data', payload: arr.buffer }, [arr.buffer])
      } else if (totalBytes === 0) {
        console.log('[ClassicWorker] encodeBuffer returned empty/null for slice len=', slice.length)
      }
    }
    return
  }
  if (type === 'finish') {
    if (!encoder) return
    const mp3buf = encoder.flush()
    if (mp3buf && mp3buf.length > 0) {
      const arr = new Uint8Array(mp3buf)
      md5.append(arr.buffer)
      totalBytes += arr.length
      self.postMessage({ type: 'data', payload: arr.buffer }, [arr.buffer])
    }
    const hex = md5.end()
    self.postMessage({ type: 'done', payload: { md5: hex, totalBytes } })
    encoder = null
    md5 = null
    totalBytes = 0
  }
}
