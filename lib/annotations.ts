import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * REVIEW ANNOTATIONS — a mark on a frame that outlives the call.
 *
 * The market makes you choose. Frame.io gives you frame-accurate drawn
 * annotations and no live conferencing at all. SyncSketch gives you a synced
 * session aimed at shot review. Evercast gives you both, and its annotations are
 * a property of the SESSION — they are how people point at things while talking,
 * and they go when the call does.
 *
 * So today a studio either has a durable note with nobody to discuss it with, or
 * a conversation whose drawings evaporate. This is the join: the mark is drawn
 * live, over the shared playhead, and persisted against the asset at a timecode.
 * The editor opens it tomorrow at the exact frame.
 *
 * ── ONE ANCHOR, AND IT IS 0038's ─────────────────────────────────────────
 *
 * `anchor_ms` is the same number in the same unit as
 * `messages.anchor_value->>'ms'` and `meeting_sync_state.position_ms`. Batch 22
 * refused `messages.timecode_ms` precisely so a timecode would have ONE
 * representation; a note that disagrees with the playhead about where it is is a
 * note on the wrong shot.
 *
 * ── NORMALISED COORDINATES, NOT PIXELS ───────────────────────────────────
 *
 * Strokes are 0–1 of the frame. A mark drawn on a laptop lands in the same place
 * on a reference monitor. Pixels would be correct exactly once, on the machine
 * that drew them.
 */

export type Point = { x: number; y: number }
export type Stroke = Point[]

export type Annotation = {
  id: string
  organization_id: string
  meeting_id: string | null
  file_id: string | null
  approval_id: string | null
  anchor_ms: number
  strokes: Stroke[]
  note: string | null
  colour: string
  created_by: string | null
  created_at: string
}

const COLUMNS =
  'id, organization_id, meeting_id, file_id, approval_id, anchor_ms, strokes, note, colour, created_by, created_at'

/** Every point clamped into the frame, and the shape validated. A stroke with a
 *  point at x=40 would render off-screen on every device except the one that
 *  produced it, so it is corrected at the boundary rather than stored. */
export function normaliseStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input)) return []
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const out: Stroke[] = []
  for (const raw of input.slice(0, 200)) {
    if (!Array.isArray(raw)) continue
    const stroke: Stroke = []
    for (const p of raw.slice(0, 2000)) {
      const pt = p as { x?: unknown; y?: unknown }
      if (typeof pt?.x !== 'number' || typeof pt?.y !== 'number') continue
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue
      stroke.push({ x: clamp(pt.x), y: clamp(pt.y) })
    }
    if (stroke.length > 0) out.push(stroke)
  }
  return out
}

export async function listAnnotations(
  db: SupabaseClient, fileId: string
): Promise<Annotation[]> {
  const { data, error } = await db
    .from('review_annotations')
    .select(COLUMNS)
    .eq('file_id', fileId)
    // 0073's standing obligation on every crew read.
    .is('deleted_at', null)
    .order('anchor_ms', { ascending: true })
    .limit(500)
  if (error) throw new Error(`listAnnotations: ${error.message}`)
  return (data ?? []) as unknown as Annotation[]
}

export async function createAnnotation(
  db: SupabaseClient,
  p: {
    organizationId: string
    fileId: string
    anchorMs: number
    strokes: Stroke[]
    note?: string | null
    colour?: string
    meetingId?: string | null
    approvalId?: string | null
    createdBy: string
  }
): Promise<Annotation | null> {
  const { data, error } = await db.from('review_annotations').insert({
    organization_id: p.organizationId,
    file_id: p.fileId,
    meeting_id: p.meetingId ?? null,
    approval_id: p.approvalId ?? null,
    anchor_ms: Math.max(0, Math.round(p.anchorMs)),
    strokes: p.strokes,
    note: p.note ?? null,
    colour: p.colour ?? '#ff3b30',
    created_by: p.createdBy,
  }).select(COLUMNS).maybeSingle()

  if (error) throw new Error(`createAnnotation: ${error.message}`)
  // RLS refuses by matching zero rows (§12 lesson 6), so absent is a refusal.
  return (data as unknown as Annotation) ?? null
}

export async function deleteAnnotation(
  db: SupabaseClient, id: string
): Promise<boolean> {
  const { data } = await db.from('review_annotations')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id')
  return (data ?? []).length > 0
}

/** Format a timecode the way a cutting room reads one. `fps` is supplied by the
 *  caller because the asset knows it and this module does not — inventing a
 *  default would produce a frame number that is confidently wrong. */
export function timecode(ms: number, fps = 24): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const f = Math.floor(((ms % 1000) / 1000) * fps)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}
