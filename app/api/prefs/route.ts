import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Per-user preferences — Batch 20.3.
 *
 * The durable copy of the device-level chat settings (wallpaper, sound,
 * focus, mention trigger, sticky project tag), so they survive logout,
 * refresh and a NEW device. localStorage remains the zero-latency cache;
 * lib/prefsSync.ts hydrates it from here at mount and writes through on
 * every change.
 *
 * This surface follows AD-001 as written: the USER client only, RLS
 * (0034, user_id = auth.uid()) is the entire authorization story, and
 * every write is validated against an allowlist — a preference blob must
 * not become a dumping ground.
 */

// Accepts the CURRENT set plus the three retired names, deliberately: a
// browser that still holds 'aurora' must be able to write it back without a
// 400, and lib/chatPrefs maps it to its nearest survivor on read. Refusing
// the old value would make the push fail, leave the key dirty, and strand
// that device on a preference it can never replace.
const PATTERNS = new Set([
  'slate', 'plaster', 'onyx', 'silk', 'velvet', 'ribbon', 'dots', 'film', 'strip', 'none',
  // Retired names stay ACCEPTED on write; lib/chatPrefs maps them on read.
  'aurora', 'waves', 'grid', 'grain', 'filmstrip', 'storyboard', 'bokeh', 'vignette',
])
const INTENSITIES = new Set(['faint', 'medium', 'bold'])
const VOLUMES = new Set(['off', 'low', 'medium', 'high'])
const TRIGGERS = new Set(['at', 'slash', 'both'])
const ONOFF = new Set(['on', 'off'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate one known key; unknown keys are dropped, bad values refused. */
function sanitizeChat(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const src = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if ('wallpaperPattern' in src) {
    if (typeof src.wallpaperPattern !== 'string' || !PATTERNS.has(src.wallpaperPattern)) return null
    out.wallpaperPattern = src.wallpaperPattern
  }
  if ('wallpaperIntensity' in src) {
    if (typeof src.wallpaperIntensity !== 'string' || !INTENSITIES.has(src.wallpaperIntensity)) return null
    out.wallpaperIntensity = src.wallpaperIntensity
  }
  if ('soundVolume' in src) {
    if (typeof src.soundVolume !== 'string' || !VOLUMES.has(src.soundVolume)) return null
    out.soundVolume = src.soundVolume
  }
  if ('sound' in src) {
    if (typeof src.sound !== 'string' || !ONOFF.has(src.sound)) return null
    out.sound = src.sound
  }
  if ('focus' in src) {
    if (typeof src.focus !== 'string' || !ONOFF.has(src.focus)) return null
    out.focus = src.focus
  }
  if ('mentionTrigger' in src) {
    if (typeof src.mentionTrigger !== 'string' || !TRIGGERS.has(src.mentionTrigger)) return null
    out.mentionTrigger = src.mentionTrigger
  }
  if ('roomTag' in src) {
    // { [clientId]: projectId | '' } — '' clears the sticky tag.
    if (typeof src.roomTag !== 'object' || src.roomTag === null || Array.isArray(src.roomTag)) return null
    const tags: Record<string, string> = {}
    for (const [k, v] of Object.entries(src.roomTag as Record<string, unknown>)) {
      if (!UUID_RE.test(k) || typeof v !== 'string' || (v !== '' && !UUID_RE.test(v))) return null
      tags[k.toLowerCase()] = v.toLowerCase()
    }
    out.roomTag = tags
  }
  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase.from('user_prefs').select('chat').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ chat: data?.chat ?? {} })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const patch = sanitizeChat((body as { chat?: unknown })?.chat)
  if (!patch || Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid preference keys' }, { status: 400 })
  }

  // ADDITIVE merge — a patch never wipes what it does not name, and the
  // roomTag map merges per client rather than replacing whole.
  const { data: existing } = await supabase.from('user_prefs').select('chat').eq('user_id', user.id).maybeSingle()
  const cur = (existing?.chat ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = { ...cur, ...patch }
  if (patch.roomTag) {
    merged.roomTag = {
      ...((cur.roomTag as Record<string, string> | undefined) ?? {}),
      ...(patch.roomTag as Record<string, string>),
    }
  }

  const { error } = await supabase
    .from('user_prefs')
    .upsert({ user_id: user.id, chat: merged, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ chat: merged })
}
