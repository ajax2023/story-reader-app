// Simple MP3 encoder worker - direct approach
importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js')

let encoder = null
let allPcmData = []

self.onmessage = (e) => {
  const { type, payload } = e.data || {}
  
  if (type === 'init') {
    const { sampleRate = 44100, kbps = 64 } = payload
    encoder = new self.lamejs.Mp3Encoder(1, sampleRate, kbps) // mono for simplicity
    allPcmData = []
    console.log('[SimpleWorker] init sr=', sampleRate, 'kbps=', kbps)
    return
  }
  
  if (type === 'encode') {
    const { pcm } = payload
    allPcmData.push(new Float32Array(pcm))
    return
  }
  
  if (type === 'finish') {
    if (!encoder || allPcmData.length === 0) {
      self.postMessage({ type: 'done', payload: { totalBytes: 0, md5: '' } })
      return
    }
    
    // Concatenate all PCM data
    const totalLen = allPcmData.reduce((sum, arr) => sum + arr.length, 0)
    const fullPcm = new Float32Array(totalLen)
    let offset = 0
    for (const chunk of allPcmData) {
      fullPcm.set(chunk, offset)
      offset += chunk.length
    }
    
    console.log('[SimpleWorker] encoding', totalLen, 'samples')
    
    // Auto-normalize PCM levels without clipping
    let maxAbs = 0
    for (let i = 0; i < fullPcm.length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(fullPcm[i]))
    }
    
    // Target peak at 70% to avoid clipping, with minimum gain of 2x
    const targetPeak = 0.7
    const autoGain = maxAbs > 0 ? Math.max(2.0, Math.min(20.0, targetPeak / maxAbs)) : 2.0
    console.log('[SimpleWorker] auto-gain:', autoGain.toFixed(2), 'maxAbs:', maxAbs.toFixed(4))
    
    const pcm16 = new Int16Array(fullPcm.length)
    for (let i = 0; i < fullPcm.length; i++) {
      let s = Math.max(-1, Math.min(1, fullPcm[i] * autoGain))
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    
    // Encode in one shot
    const mp3Data = []
    const frameSize = 1152
    for (let i = 0; i < pcm16.length; i += frameSize) {
      const slice = pcm16.subarray(i, Math.min(i + frameSize, pcm16.length))
      const mp3buf = encoder.encodeBuffer(slice)
      if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf))
      }
    }
    
    // Flush
    const flushBuf = encoder.flush()
    if (flushBuf && flushBuf.length > 0) {
      mp3Data.push(new Uint8Array(flushBuf))
    }
    
    // Combine all MP3 data
    const totalBytes = mp3Data.reduce((sum, arr) => sum + arr.length, 0)
    const combined = new Uint8Array(totalBytes)
    let pos = 0
    for (const chunk of mp3Data) {
      combined.set(chunk, pos)
      pos += chunk.length
    }
    
    console.log('[SimpleWorker] encoded', totalBytes, 'bytes')
    
    // Send as single chunk
    self.postMessage({ type: 'data', payload: combined.buffer }, [combined.buffer])
    self.postMessage({ type: 'done', payload: { totalBytes, md5: 'simple' } })
  }
}
