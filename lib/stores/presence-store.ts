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
