'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, X, CalendarClock } from 'lucide-react'
import { PROJECT_ROLES, PROJECT_ROLE_LABEL, type ProjectRole } from '@/lib/capabilities'

/**
 * WHAT A PERSON IS ON — S-R §3.2's axis made usable (Batch 26 item 7).
 *
 * Opens on demand under a roster row, the same shape CapabilityGrants uses, so
 * the common case stays one line per person (S-R §13: not a wall of checkboxes).
 *
 * Every write goes to /api/admin/assignments, which is the ONE server-side path,
 * capability-gated on people.manage and writing a ledger row per action (R-8).
 * Nothing is computed here that the server does not re-derive.
 */

export type Assignment = {
  projectId: string
  projectTitle: string | null
  projectRole: ProjectRole | null
  expiresAt: string | null
  createdAt: string
}

type Project = { id: string; title: string }

const isExpired = (a: Assignment) => !!a.expiresAt && Date.parse(a.expiresAt) <= Date.now()
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function MemberAssignments({
  memberId, projects, scopeMode, onChanged,
}: {
  memberId: string
  projects: Project[]
  /** Shown so an admin can see WHY these assignments do or do not matter: under
   *  scope_mode 'all' they grant project ROLES but narrow nothing, and under
   *  'selected' they are the person's entire visible world. Stating it here is
   *  what keeps the B1 footgun legible instead of surprising. */
  scopeMode: 'all' | 'selected'
  onChanged?: () => void
}) {
  const [rows, setRows] = useState<Assignment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addId, setAddId] = useState('')
  const [addRole, setAddRole] = useState<ProjectRole | ''>('')
  const [addExpiry, setAddExpiry] = useState('')

  /** FETCHES, DOES NOT SET. Keeping the read free of setState is what lets the
   *  effect below put every state update inside a promise callback, which is the
   *  shape react-hooks/set-state-in-effect asks for — "subscribe for updates from
   *  some external system, calling setState in a callback". A `load()` helper that
   *  set state itself reads fine and trips the rule, because the linter cannot see
   *  that the setState is behind an await. */
  const fetchRows = useCallback(async (): Promise<{ rows?: Assignment[]; error?: string }> => {
    try {
      const res = await fetch(`/api/admin/assignments?memberId=${memberId}`)
      const json = await res.json()
      return res.ok ? { rows: json.assignments ?? [] } : { error: json.error ?? 'Could not read assignments.' }
    } catch { return { error: 'Could not read assignments.' } }
  }, [memberId])

  /** The `alive` guard is not decoration: this panel unmounts the moment an admin
   *  collapses the row, and a fetch resolving afterwards would set state on a dead
   *  component. */
  const apply = useCallback((r: { rows?: Assignment[]; error?: string }) => {
    if (r.rows) setRows(r.rows)
    if (r.error) setError(r.error)
  }, [])

  useEffect(() => {
    const alive = { current: true }
    fetchRows().then((r) => { if (alive.current) apply(r) })
    return () => { alive.current = false }
  }, [fetchRows, apply])

  const reload = useCallback(async () => { apply(await fetchRows()) }, [fetchRows, apply])

  async function save(projectId: string, projectRole: ProjectRole | null, expiresAt: string | null) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, projectId, projectRole, expiresAt }),
      })
      if (!res.ok) setError((await res.json()).error ?? 'Could not save.')
      else { await reload(); onChanged?.() }
    } catch { setError('Could not save.') }
    setBusy(false)
  }

  async function remove(projectId: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, projectId }),
      })
      if (!res.ok) setError((await res.json()).error ?? 'Could not remove.')
      else { await reload(); onChanged?.() }
    } catch { setError('Could not remove.') }
    setBusy(false)
  }

  const taken = new Set((rows ?? []).map((r) => r.projectId))
  const available = projects.filter((p) => !taken.has(p.id))

  return (
    <div className="mt-2 rounded-xl border border-border bg-background/60 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">
        Productions
        <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
          {scopeMode === 'selected'
            ? 'this person sees only these'
            : 'this person sees every production — these set their role on each'}
        </span>
      </p>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {rows === null && <p className="text-xs text-faint">Loading…</p>}

      {rows?.length === 0 && (
        <p className="text-xs text-faint">
          {scopeMode === 'selected'
            ? 'Not on any production yet — so they see nothing. Add one below.'
            : 'No stated role on any production.'}
        </p>
      )}

      {(rows ?? []).map((a) => (
        <div key={a.projectId} className="flex flex-wrap items-center gap-2 border-t border-border/60 py-1.5 first:border-t-0">
          <span className={`min-w-0 flex-1 truncate text-xs ${isExpired(a) ? 'text-faint line-through' : 'text-foreground'}`}>
            {a.projectTitle ?? a.projectId}
          </span>
          <select
            value={a.projectRole ?? ''} disabled={busy}
            onChange={(e) => save(a.projectId, (e.target.value || null) as ProjectRole | null, a.expiresAt)}
            aria-label="Project role"
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
          >
            {/* The empty option is 0057's NULL and is labelled as the fact it is,
                not as a prompt: "on the production, no stated role" resolves to no
                baseline, and that is different from `observer`, which is a
                decision that somebody writes nothing. */}
            <option value="">no stated role</option>
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>
            ))}
          </select>
          <input
            type="date" disabled={busy}
            value={a.expiresAt ? a.expiresAt.slice(0, 10) : ''}
            onChange={(e) => save(
              a.projectId, a.projectRole,
              e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null,
            )}
            aria-label="Assignment expiry"
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-muted-foreground"
          />
          {isExpired(a) && (
            <span className="inline-flex items-center gap-1 text-[10px] text-faint">
              <CalendarClock size={11} /> expired {day(a.expiresAt!)}
            </span>
          )}
          <button
            type="button" disabled={busy} onClick={() => remove(a.projectId)}
            title="Take them off this production"
            className="rounded-md p-1 text-faint transition-colors hover:text-destructive"
          >
            <X size={13} />
          </button>
        </div>
      ))}

      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <select
            value={addId} onChange={(e) => setAddId(e.target.value)} disabled={busy}
            aria-label="Production"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
          >
            <option value="">Add to a production…</option>
            {available.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <select
            value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole | '')} disabled={busy}
            aria-label="Project role"
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
          >
            <option value="">no stated role</option>
            {PROJECT_ROLES.map((r) => <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>)}
          </select>
          <input
            type="date" value={addExpiry} onChange={(e) => setAddExpiry(e.target.value)} disabled={busy}
            aria-label="Expiry (optional)"
            className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-muted-foreground"
          />
          <button
            type="button"
            disabled={busy || !addId}
            onClick={async () => {
              await save(
                addId, (addRole || null) as ProjectRole | null,
                addExpiry ? new Date(`${addExpiry}T23:59:59Z`).toISOString() : null,
              )
              setAddId(''); setAddRole(''); setAddExpiry('')
            }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
          </button>
        </div>
      )}
    </div>
  )
}
