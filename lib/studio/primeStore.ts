import { create } from 'zustand'

export type PrimeTurn = { role: 'user' | 'assistant'; text: string; applicable?: boolean }
type ApplyFn = (text: string, mode: 'replace' | 'after') => void

// Global PrimeOS state so the assistant lives at the app shell level: once opened
// it stays mounted across navigation (sticky until the user closes it), keeps its
// conversation, and can read the latest text selection from anywhere in the app.
type PrimeStore = {
  open: boolean
  turns: PrimeTurn[]
  /** the most recent non-empty selection captured anywhere in the app */
  selText: string
  /** editor-supplied apply handler (insert/replace); null when no editor is mounted */
  applyFn: ApplyFn | null
  /** editor-supplied full-document text getter; null when no editor is mounted */
  getDocText: (() => string) | null

  openPanel: () => void
  closePanel: () => void
  toggle: () => void
  setTurns: (t: PrimeTurn[]) => void
  setSel: (s: string) => void
  registerEditor: (apply: ApplyFn, getDocText: () => string) => void
  unregisterEditor: (apply: ApplyFn) => void
}

export const usePrimeStore = create<PrimeStore>((set) => ({
  open: false,
  turns: [],
  selText: '',
  applyFn: null,
  getDocText: null,

  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  setTurns: (t) => set({ turns: t }),
  // Only remember non-empty selections, so the last highlight persists even after
  // the user clicks into the panel (which clears the live DOM selection).
  setSel: (s) => set((prev) => (s.trim() ? { selText: s } : prev)),
  registerEditor: (apply, getDocText) => set({ applyFn: apply, getDocText }),
  // Only clear if the unmounting editor is still the registered one (avoid a newly
  // mounted editor being unregistered by a previous one's cleanup).
  unregisterEditor: (apply) => set((s) => (s.applyFn === apply ? { applyFn: null, getDocText: null } : s)),
}))
