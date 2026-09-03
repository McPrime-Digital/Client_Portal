import { create } from 'zustand'

// App-wide presence — who is currently *in the app* (any page), tracked via a
// single shared Supabase Realtime presence channel (see PresencePulse). Presence
// broadcasts are NOT subject to Postgres RLS, so this works for admins too (who
// otherwise have no broad RLS read). The messaging hubs read this to render an
// accurate "Online / Away" indicator: online === in the app, away === not.
export type PresenceEntry = {
  role: 'admin' | 'client'
  userId: string
  clientId: string | null
  /** WHICH conversation view they are reading (item 6) — null when they are
   *  signed in but not in a thread. A hint for a subtitle, never authorization. */
  view?: import('@/lib/presenceView').PresenceView | null
}

type PresenceStore = {
  online: PresenceEntry[]
  setOnline: (entries: PresenceEntry[]) => void
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  online: [],
  setOnline: (entries) => set({ online: entries }),
}))

// Selectors (pure helpers — call with the current `online` array).
export function isAdminOnline(online: PresenceEntry[]): boolean {
  return online.some((e) => e.role === 'admin')
}

export function isClientOnline(online: PresenceEntry[], clientId: string | null | undefined): boolean {
  if (!clientId) return false
  return online.some((e) => e.role === 'client' && e.clientId === clientId)
}

/**
 * WHERE the other side is, not just whether they are here.
 *
 * "Online" answers the wrong question in a product where one room has several
 * views. Before you type, what you want to know is whether they are reading
 * THIS conversation:
 *
 *   in this room's All view        → "in All"
 *   in a project view of this room → "in <project>"
 *   signed in, but on overview,
 *     invoices, anywhere else      → "Online"
 *
 * Returns null when nobody from that side is present, so the caller keeps its
 * existing "Away" wording rather than this file inventing a second vocabulary.
 */
export function presenceWhere(
  online: PresenceEntry[],
  side: 'admin' | 'client',
  clientId: string | null | undefined,
  projectTitle?: (projectId: string) => string | undefined
): string | null {
  const them = online.filter((e) =>
    e.role === side && (side === 'admin' || (!!clientId && e.clientId === clientId))
  )
  if (them.length === 0) return null
  // Prefer whoever is actually IN this room — one person reading the thread is
  // more useful than three signed in elsewhere.
  const inRoom = them.find((e) => e.view && e.view.kind !== 'none' && e.view.clientId === clientId)
  if (!inRoom || !inRoom.view || inRoom.view.kind === 'none') return 'Online'
  if (inRoom.view.kind === 'all') return 'in All'
  const title = projectTitle?.(inRoom.view.projectId)
  return title ? `in ${title}` : 'in a project'
}
