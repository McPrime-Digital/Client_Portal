// Single source of truth for a project's overall progress.
//
// When a project has phases, the overall percentage is the average of
// its phase progress (auto-derived). When it has no phases, the stored
// `projects.progress` value is used. Every screen — admin + client,
// detail + list + overview — must compute progress through this helper
// (and the admin write path persists the result to projects.progress)
// so the number is identical everywhere.

export type PhaseLike = { progress?: number | null }

export function computeProjectProgress(
  phases: PhaseLike[] | null | undefined,
  fallback: number | null | undefined = 0,
): number {
  if (phases && phases.length > 0) {
    const sum = phases.reduce((s, p) => s + (p.progress ?? 0), 0)
    return clampPct(Math.round(sum / phases.length))
  }
  return clampPct(Math.round(fallback ?? 0))
}

export function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, value))
}

// ── Live project status, derived from phase progress ──────────────────────
// The admin picks a starting status at creation, but the pipeline status must
// then track real progress as phases advance. This maps the *current* phase
// (the first one not yet complete) to a project status, so the overview, badges
// and lists move on their own. 'On Hold' is a deliberate manual pause and is
// never overridden; once every phase is done the project reads 'Completed'.

export type StatusPhaseLike = {
  name: string
  progress?: number | null
  is_complete?: boolean | null
  sort_order?: number | null
}

function phaseNameToStatus(name: string): string {
  const n = (name ?? '').toLowerCase()
  if (n.includes('discovery') || n.includes('brief') || n.includes('onboard')) return 'Onboarding'
  if (n.includes('pre')) return 'Pre-Production'
  if (n.includes('post')) return 'Post-Production'
  if (n.includes('revis')) return 'Revisions'
  if (n.includes('review')) return 'In Review'
  if (n.includes('final') || n.includes('deliver')) return 'In Review'
  if (n.includes('g1') || n.includes('g2') || n.includes('production') || n.includes('generation')) return 'In Production'
  return 'In Production'
}

export function deriveProjectStatus(
  phases: StatusPhaseLike[] | null | undefined,
  currentStatus: string | null | undefined,
): string {
  const current = currentStatus ?? 'Onboarding'
  // Respect a deliberate manual pause.
  if (current === 'On Hold') return current
  if (!phases || phases.length === 0) return current

  const ordered = [...phases].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  )
  const isDone = (p: StatusPhaseLike) => p.is_complete === true || (p.progress ?? 0) >= 100
  if (ordered.every(isDone)) return 'Completed'

  const currentPhase = ordered.find((p) => !isDone(p)) ?? ordered[0]
  return phaseNameToStatus(currentPhase.name)
}

// Balanced per-phase identifier colours. Tuned so the 7-phase production
// pipeline reads as a harmonious cool→warm progression that resolves to green
// at delivery, with no two adjacent phases sharing a hue. Cycled by index.
export const PHASE_COLORS = [
  'hsl(var(--status-blue))',    // Discovery & Brief
  'hsl(var(--status-violet))',  // Pre-Production
  'hsl(var(--primary))',        // Production G1
  'hsl(var(--status-amber))',   // Production G2
  'hsl(var(--status-blue))',    // Post-Production
  'hsl(var(--status-violet))',  // Revisions
  'hsl(var(--status-green))',   // Final Delivery
]

export function phaseColor(index: number): string {
  return PHASE_COLORS[index % PHASE_COLORS.length]
}

// Server-side: overwrite each project's `progress` with the canonical
// value derived from its phases, so list/overview pages match the
// detail pages even when the stored projects.progress is stale.
// Mutates the passed project objects in place.
export function applyCanonicalProgress(
  projects: { id: string; progress?: number | null }[] | null | undefined,
  phases: { project_id: string; progress?: number | null }[] | null | undefined,
): void {
  if (!projects) return
  const byProject = new Map<string, PhaseLike[]>()
  for (const ph of phases ?? []) {
    const arr = byProject.get(ph.project_id) ?? []
    arr.push({ progress: ph.progress })
    byProject.set(ph.project_id, arr)
  }
  for (const p of projects) {
    p.progress = computeProjectProgress(byProject.get(p.id), p.progress)
  }
}
