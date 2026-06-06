import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The persistent "page-in-view" session — a Storyboard/Workflow pairing that
// follows the user across the studio (survives navigation, and refresh via
// localStorage). Real session content lands in Phase 2; this is the mechanism.
export type SessionView = 'storyboard' | 'workflow'
export type SessionMode = 'closed' | 'docked' | 'minimized' | 'maximized'

type SessionState = {
  title: string | null
  view: SessionView
  mode: SessionMode
  open: (title: string, view?: SessionView) => void
  setMode: (mode: SessionMode) => void
  toggleView: () => void
  close: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      title: null,
      view: 'storyboard',
      mode: 'closed',
      open: (title, view = 'storyboard') => set({ title, view, mode: 'docked' }),
      setMode: (mode) => set({ mode }),
      toggleView: () => set((s) => ({ view: s.view === 'storyboard' ? 'workflow' : 'storyboard' })),
      close: () => set({ mode: 'closed', title: null }),
    }),
    { name: 'throughline-session' },
  ),
)
