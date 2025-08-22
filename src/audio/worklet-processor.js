class MonoTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(0)
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0] // take mono
    if (channel && channel.length > 0) {
      // Copy to transferable buffer to avoid blocking
      const data = new Float32Array(channel)
      this.port.postMessage({ type: 'pcm', payload: data }, [data.buffer])
    }
    return true
  }
}

registerProcessor('mono-tap-processor', MonoTapProcessor)
