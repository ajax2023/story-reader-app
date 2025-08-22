// Simple MediaRecorder-based approach
export class MediaRecorderController {
  constructor() {
    this.active = false
    this.mediaRecorder = null
    this.chunks = []
    this.clipId = null
    this.title = 'clip'
    this.mimeType = ''
    this.audioContext = null
    this.analyser = null
    this.volumeData = null
  }

  async start(title = 'clip', { deviceId } = {}) {
    if (this.active) return
    this.title = title
    this.chunks = []
    
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 }
      }
    }
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    
    try {
      const track = stream.getAudioTracks?.[0]
      console.info('[MediaRecorder] Using device:', track?.label || '(default)')
    } catch {}
    
    // Try different MIME types for best compatibility
    this.mimeType = 'audio/webm;codecs=opus'
    if (!MediaRecorder.isTypeSupported(this.mimeType)) {
      this.mimeType = 'audio/webm'
    }
    if (!MediaRecorder.isTypeSupported(this.mimeType)) {
      this.mimeType = 'audio/mp4'
    }
    if (!MediaRecorder.isTypeSupported(this.mimeType)) {
      this.mimeType = '' // Let browser choose
    }
    
    console.log('[MediaRecorder] Using MIME type:', this.mimeType || 'default')
    
    this.mediaRecorder = new MediaRecorder(stream, { 
      mimeType: this.mimeType || undefined,
      audioBitsPerSecond: 64000
    })
    
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data)
      }
    }
    
    this.mediaRecorder.onstop = async () => {
      await this.processRecording()
    }
    
    // Create clip entry with proper structure
    const { createClip } = await import('./idb')
    const clipId = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const clipMeta = { id: clipId, title: this.title, mimeType: this.mimeType }
    await createClip(clipMeta)
    this.clipId = clipId
    
    // Set up audio analysis for VU meter
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    const source = this.audioContext.createMediaStreamSource(stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256
    source.connect(this.analyser)
    this.volumeData = new Uint8Array(this.analyser.frequencyBinCount)

    this.mediaRecorder.start(100) // 100ms chunks
    this.active = true
    
    return this.clipId
  }
  
  async stop() {
    if (!this.active || !this.mediaRecorder) return null
    
    this.active = false
    this.mediaRecorder.stop()
    this.mediaRecorder.stream.getTracks().forEach(track => track.stop())
    
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    
    return this.clipId
  }

  getVolume() {
    if (!this.analyser) return 0
    this.analyser.getByteFrequencyData(this.volumeData)
    const sum = this.volumeData.reduce((acc, v) => acc + v, 0)
    const avg = sum / this.volumeData.length
    // Normalize to 0-1 range, with some scaling for better visualization
    return Math.min(1, (avg / 255) * 2)
  }
  
  async processRecording() {
    if (this.chunks.length === 0) return
    
    // Combine all chunks
    const blob = new Blob(this.chunks, { type: this.mimeType })
        
    // Store as single audio blob
    const { saveAudioBlob, updateClip } = await import('./idb')
    await saveAudioBlob(this.clipId, blob)
    
    // Update clip metadata
    const filename = this.title.replace(/[^a-zA-Z0-9\-_]/g, '_') + '.webm'
    await updateClip(this.clipId, { 
      status: 'ready', 
      sizeBytes: blob.size,
      filename,
      md5: 'mediarecorder',
      mimeType: this.mimeType
    })
    
    console.log('[MediaRecorder] Processed recording:', blob.size, 'bytes')
  }
}
