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

// Distinct per-phase identifier colours (theme-token based) so each
// production phase reads as its own step. Cycled by phase index.
export const PHASE_COLORS = [
  'hsl(var(--status-blue))',
  'hsl(var(--status-violet))',
  'hsl(var(--primary))',
  'hsl(var(--status-green))',
  'hsl(var(--status-blue))',
  'hsl(var(--status-violet))',
  'hsl(var(--primary))',
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
