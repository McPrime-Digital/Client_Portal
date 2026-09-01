/**
 * Voice-note transcoding — Batch 19.
 *
 * MediaRecorder speaks in dialects: Chrome records webm/opus, Safari records
 * mp4/AAC — and Safari cannot PLAY webm/opus at all, which is why an org
 * voice note recorded in Chrome arrived at an Apple-side client as a dead
 * 0:00. The fix is to stop shipping dialects: the SENDER's browser (which
 * can always decode what it just recorded) resamples the clip to 16 kHz mono
 * and encodes 16-bit WAV — a format every browser ever made plays natively,
 * with real duration metadata in the header (killing the 0:00 display too).
 *
 * Size: ~1.9 MB per minute — classic voice-note weight, fine for R2.
 */

export async function toWavFile(blob: Blob, name?: string): Promise<File> {
  const targetRate = 16000
  const arrayBuf = await blob.arrayBuffer()

  type AudioCtor = typeof AudioContext
  const Ctor: AudioCtor | undefined =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
  if (!Ctor) throw new Error('WebAudio unavailable')

  const decodeCtx = new Ctor()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf)
  } finally {
    void decodeCtx.close().catch(() => {})
  }

  // Resample to 16 kHz mono offline.
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const offline = new OfflineAudioContext(1, length, targetRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)

  // PCM16 WAV encode.
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new File([buf], name ?? `voice-${Date.now()}.wav`, { type: 'audio/wav' })
}
