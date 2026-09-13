import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE CALENDAR — one read path, one manual write path.
 *
 * `S3-b` §1.1's premise is the reason this table is shaped the way it is: a
 * meeting, an approval deadline and an invoice due date are THE SAME KIND OF
 * THING to a person looking at a week. Model them separately and you build three
 * calendars and then a fourth to reconcile them.
 *
 * ── TWO KINDS OF ENTRY, AND ONLY ONE IS EDITABLE HERE ─────────────────────
 *
 * A DERIVED entry (`source_id` is set) is a projection written by 0074's
 * triggers from the approval stage or invoice it describes. It is read-only on
 * this surface: dragging an approval deadline on a calendar would be overwritten
 * the next time the stage is saved, so the edit would silently vanish — worse
 * than not offering it. The database refuses it
 * (`calendar_entry_projection_guard`); the functions below refuse it earlier so
 * the caller gets a sentence instead of a 500.
 *
 * A MANUAL entry (`source_id` null) is somebody's own, and is fully editable.
 *
 * ── DELETED ROWS ARE FILTERED IN THE QUERY, NOT BY RLS ────────────────────
 *
 * 0073 settled this and it is a standing obligation on every crew read: the crew
 * policy deliberately does NOT carry `deleted_at is null`, because a policy that
 * did could not perform the soft delete or the restore. So the filter is here,
 * once, in the one read path — which is the argument for having one.
 */

export const CALENDAR_KINDS = [
  'meeting', 'approval_deadline', 'invoice_due', 'shoot_day', 'manual',
] as const
export type CalendarKind = (typeof CALENDAR_KINDS)[number]

export type CalendarEntry = {
  id: string
  organization_id: string
  kind: CalendarKind
  source_kind: string | null
  source_id: string | null
  project_id: string | null
  client_id: string | null
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  created_at: string
}

const COLUMNS =
  'id, organization_id, kind, source_kind, source_id, project_id, client_id, title, starts_at, ends_at, all_day, created_at'

/** A derived entry is owned by its source and cannot be edited here. */
export function isDerived(e: Pick<CalendarEntry, 'source_id'>): boolean {
  return e.source_id !== null
}

export type ListParams = {
  orgId: string
  /** Inclusive. */
  from: Date
  /** Exclusive. */
  to: Date
  projectId?: string | null
}

export async function listEntries(
  db: SupabaseClient,
  { orgId, from, to, projectId }: ListParams
): Promise<CalendarEntry[]> {
  let q = db
    .from('calendar_entries')
    .select(COLUMNS)
    .eq('organization_id', orgId)
    // The standing obligation from 0073. Not optional.
    .is('deleted_at', null)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: true })
    // Bounded (I-1). A month of entries past this is pathological, and the cap
    // is stated rather than implied.
    .limit(1000)

  if (projectId) q = q.eq('project_id', projectId)

  const { data, error } = await q
  if (error) throw new Error(`listEntries: ${error.message}`)
  return (data ?? []) as unknown as CalendarEntry[]
}

export type ManualEntryInput = {
  organizationId: string
  title: string
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  kind?: Extract<CalendarKind, 'manual' | 'shoot_day' | 'meeting'>
  projectId?: string | null
  clientId?: string | null
  createdBy: string
}

export async function createManualEntry(
  db: SupabaseClient,
  p: ManualEntryInput
): Promise<CalendarEntry | null> {
  const { data, error } = await db
    .from('calendar_entries')
    .insert({
      organization_id: p.organizationId,
      kind: p.kind ?? 'manual',
      // NEVER a source. A manual entry that claimed one would be deleted by the
      // next projection sweep for a source it does not have.
      source_kind: null,
      source_id: null,
      project_id: p.projectId ?? null,
      client_id: p.clientId ?? null,
      title: p.title,
      starts_at: p.startsAt,
      ends_at: p.endsAt ?? null,
      all_day: p.allDay ?? false,
      created_by: p.createdBy,
    })
    .select(COLUMNS)
    .maybeSingle()

  if (error) throw new Error(`createManualEntry: ${error.message}`)
  // RLS refuses by matching zero rows and PostgREST returns no error
  // (HANDOFF §12 lesson 6), so an absent row is a refusal.
  return (data as unknown as CalendarEntry) ?? null
}

export type ManualEntryPatch = {
  title?: string
  startsAt?: string
  endsAt?: string | null
  allDay?: boolean
  projectId?: string | null
}

/** Returns null when RLS refused, and throws with a sentence when the entry is
 *  a projection — two different answers, because they need two different
 *  messages. */
export async function updateManualEntry(
  db: SupabaseClient,
  id: string,
  patch: ManualEntryPatch
): Promise<CalendarEntry | null> {
  const { data: existing } = await db
    .from('calendar_entries').select('id, source_kind, source_id').eq('id', id).maybeSingle()
  if (!existing) return null
  if ((existing as { source_id: string | null }).source_id !== null) {
    throw new Error('DERIVED')
  }

  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt
  if (patch.endsAt !== undefined) row.ends_at = patch.endsAt
  if (patch.allDay !== undefined) row.all_day = patch.allDay
  if (patch.projectId !== undefined) row.project_id = patch.projectId
  if (Object.keys(row).length === 0) return existing as unknown as CalendarEntry

  const { data, error } = await db
    .from('calendar_entries').update(row).eq('id', id).select(COLUMNS).maybeSingle()
  if (error) throw new Error(`updateManualEntry: ${error.message}`)
  return (data as unknown as CalendarEntry) ?? null
}

/** SOFT delete — `deleted_at`, not a row removal. The purge (0071) takes it 90
 *  days later, and until then an undelete is an ordinary update. */
export async function deleteManualEntry(
  db: SupabaseClient,
  id: string
): Promise<boolean> {
  const { data: existing } = await db
    .from('calendar_entries').select('id, source_id').eq('id', id).maybeSingle()
  if (!existing) return false
  if ((existing as { source_id: string | null }).source_id !== null) {
    throw new Error('DERIVED')
  }

  const { data, error } = await db
    .from('calendar_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(`deleteManualEntry: ${error.message}`)
  return (data ?? []).length > 0
}

// ── the month grid ──────────────────────────────────────────────────────────

/**
 * Six weeks of days covering `month`, Monday-first.
 *
 * SIX WEEKS ALWAYS, not five-or-six. A grid that changes height between months
 * makes every element below it jump when you page through the year, and paging
 * through the year is the only thing anybody does with a month view.
 *
 * Pure and timezone-naive by construction: every day is built from local
 * year/month/date, so a month never gains or loses a row to an offset.
 */
export function monthGrid(month: Date): { days: Date[]; from: Date; to: Date } {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  // getDay() is 0=Sunday; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead)

  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42)
  return { days, from: start, to: end }
}

/** Local YYYY-MM-DD. Deliberately NOT toISOString().slice(0,10), which converts
 *  to UTC first and puts a late-evening entry on the following day. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function groupByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>()
  for (const e of entries) {
    const key = dayKey(new Date(e.starts_at))
    const list = out.get(key)
    if (list) list.push(e)
    else out.set(key, [e])
  }
  return out
}

/** `?m=YYYY-MM` → a Date, falling back to this month for anything unparseable.
 *  A bad month in the URL shows today rather than an error page. */
export function parseMonth(param: string | null | undefined, now = new Date()): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(param ?? '')
  if (!m) return new Date(now.getFullYear(), now.getMonth(), 1)
  const year = Number(m[1])
  const mon = Number(m[2])
  if (mon < 1 || mon > 12 || year < 1970 || year > 2999) {
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  return new Date(year, mon - 1, 1)
}

export function monthParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const KIND_LABEL: Record<CalendarKind, string> = {
  meeting: 'Meeting',
  approval_deadline: 'Review date',
  invoice_due: 'Invoice due',
  shoot_day: 'Shoot day',
  manual: 'Entry',
}

/** Colour per kind, as CSS custom-property expressions. */
export const KIND_TONE: Record<CalendarKind, string> = {
  meeting: 'var(--primary)',
  approval_deadline: 'var(--status-amber, var(--destructive))',
  invoice_due: 'var(--destructive)',
  shoot_day: 'var(--primary)',
  manual: 'var(--muted-foreground)',
}
