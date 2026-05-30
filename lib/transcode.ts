import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

// Server-only audio transcoding. Voice notes recorded in Chrome are
// audio/webm (Opus), which Safari can't play at all — a problem when
// most SaaS users may be on Mac. We transcode the Safari-incompatible
// containers to .m4a (AAC in MP4), which plays everywhere. Already-
// universal formats (mp3/m4a/wav/flac) are left untouched so genuine
// audio deliverables aren't re-encoded / degraded.

// Resolve the ffmpeg binary robustly: prefer ffmpeg-static's path, but
// bundlers (Turbopack/webpack) can rewrite its __dirname to a bogus
// /ROOT/... path, so fall back to a cwd-relative copy and finally to a
// system ffmpeg on PATH.
function resolveFfmpeg(): string {
  const candidates = [
    ffmpegStatic as unknown as string | null,
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return 'ffmpeg'
}
const FFMPEG = resolveFfmpeg()

// Don't try to transcode huge files in a request — voice notes are tiny.
const MAX_TRANSCODE_BYTES = 300 * 1024 * 1024 // 300 MB

/** True when `name`/`mime` is audio Safari can't natively play. */
export function needsAudioTranscode(name: string, mime: string): boolean {
  const m = (mime || '').toLowerCase()
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''

  // .webm / .ogg are also video containers — only transcode as audio.
  if (ext === 'webm' || ext === 'ogg') {
    return m.startsWith('audio/') || /^voice-/i.test(name)
  }
  // Unambiguous audio-only formats Safari can't play.
  if (['opus', 'weba', 'oga', 'amr'].includes(ext)) return true

  // Fall back to MIME when the extension is missing/uninformative.
  if (m === 'audio/webm' || m === 'audio/ogg' || m.includes('opus') || m === 'audio/amr') {
    return true
  }
  return false
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`))
    )
  })
}

/** Transcode arbitrary audio bytes to AAC/.m4a. */
export async function transcodeAudioToM4a(input: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-aac-'))
  const inPath = join(dir, 'input')
  const outPath = join(dir, 'output.m4a')
  try {
    await writeFile(inPath, input)
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-i', inPath,
      '-vn', // audio only
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', // stream-friendly
      '-y', outPath,
    ])
    return new Uint8Array(await readFile(outPath))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Transcodes to .m4a when needed, otherwise returns the input
 * unchanged. Never throws — on failure it keeps the original so an
 * upload is never lost.
 */
export async function maybeTranscodeAudio(input: {
  bytes: Uint8Array
  name: string
  mime: string
}): Promise<{ bytes: Uint8Array; name: string; mime: string; transcoded: boolean }> {
  if (!needsAudioTranscode(input.name, input.mime)) {
    return { ...input, transcoded: false }
  }
  if (input.bytes.byteLength > MAX_TRANSCODE_BYTES) {
    return { ...input, transcoded: false }
  }
  try {
    const bytes = await transcodeAudioToM4a(input.bytes)
    const base = input.name.replace(/\.[^./\\]+$/, '') || 'audio'
    return { bytes, name: `${base}.m4a`, mime: 'audio/mp4', transcoded: true }
  } catch (err) {
    console.error('[transcode] failed, keeping original:', err)
    return { ...input, transcoded: false }
  }
}
