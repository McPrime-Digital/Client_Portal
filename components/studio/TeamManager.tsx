'use client'

import { useCallback, useEffect, useState } from 'react'
import { UsersRound, UserPlus, ShieldCheck, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ORG_GRANTABLE, ORG_ROLE_HELP } from '@/lib/permissions'
import {
  ORG_ROLES_ASSIGNABLE, SEAT_CLASSES, SEAT_CLASS_HELP, SEAT_CLASS_LABEL,
  SEAT_CLASS_SCOPE_MODE, type OrgRole, type SeatClass,
} from '@/lib/capabilities'
import CapabilityGrants, { GrantSummary, type Grant } from '@/components/shared/CapabilityGrants'
import MemberAssignments from '@/components/studio/MemberAssignments'

// THREE LOCAL COPIES OF THE VOCABULARY LIVED HERE and all three were stale: a
// six-value role union, an ASSIGNABLE list of five that could not offer
// `coordinator` or `crew`, and a ROLE_HELP map that still called the Suite "the
// workspace". They now come from lib/capabilities.ts — the same source that
// generates role_baseline() in SQL (ruling 2).
type Member = {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: OrgRole
  roles?: string[]
  extra_caps?: string[]
  title?: string | null
  seat_class?: SeatClass
  scope_mode?: 'all' | 'selected'
  status: 'invited' | 'active' | 'paused' | 'revoked'
  invited_at: string
  accepted_at: string | null
}

const ASSIGNABLE = ORG_ROLES_ASSIGNABLE
const ROLE_HELP: Record<string, string> = ORG_ROLE_HELP

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function TeamManager() {
  const [members, setMembers] = useState<Member[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [grants, setGrants] = useState<Record<string, Grant[]>>({})
  /** The GRANTER's own resolved set. G-1's ceiling, offered rather than
   *  discovered: a picker that shows what the trigger will refuse turns a rule
   *  into a bug report. */
  const [myCaps, setMyCaps] = useState<string[]>([])
  const [openCaps, setOpenCaps] = useState<string | null>(null)
  const [openProjects, setOpenProjects] = useState<string | null>(null)
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // TWO DEFAULTS, AND THE FIRST ONE WAS A BUG (Batch 26 item 4).
  //
  // `role` defaulted to 'member' — the DEPRECATED alias S-R §3.1 retires. The
  // route defaults to 'crew' and its comment says why ("a default is the surest
  // way to keep a retired name alive"), but the route's default never fired,
  // because this form always SENDS a value. So every invite from the studio
  // created a `member`, and the route was right about the danger and wrong about
  // where it lived. It is not in ASSIGNABLE either, so the select could not even
  // display it — the field showed 'Admin' while the state said 'member'.
  //
  // `seatClass` defaults to 'contractor', matching the route: S1-P's archetypes
  // are defined by a rotating freelance bench, so the freelance seat is the common
  // case AND the one that grants less. Where those agree there is no trade.
  const [form, setForm] = useState<{ name: string; email: string; role: OrgRole; seatClass: SeatClass }>(
    { name: '', email: '', role: 'crew', seatClass: 'contractor' },
  )
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/team')
      if (res.ok) {
        const json = await res.json()
        setMembers(json.members ?? [])
        setCanManage(!!json.canManage)
        setGrants(json.grants ?? {})
        setMyCaps(json.myCaps ?? [])
        setProjects(json.projects ?? [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  // Live roster — joins, role changes, and revocations land without a refresh.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('studio-crew-roster')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_members' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setSending(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? 'Invite failed.')
      else {
        setNotice(json.message)
        setForm({ name: '', email: '', role: 'crew', seatClass: 'contractor' })
        load()
      }
    } catch { setError('Invite failed.') }
    setSending(false)
  }

  /** Seat class and scope are separate PATCH fields and separate decisions —
   *  changing the LABEL never moves the ACCESS. See the route's comment: deriving
   *  one from the other turns a correction into a lockout, because an empty
   *  project set means everything under 'all' and nothing under 'selected'. */
  async function patchMember(memberId: string, body: Record<string, unknown>) {
    setBusy(memberId); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, ...body }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not save.')
    else await load()
    setBusy(null)
  }

  async function setRole(memberId: string, role: string) {
    setBusy(memberId); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change role.')
    await load(); setBusy(null)
  }

  /**
   * Individual access, written to the GRANT TABLES (item 8) rather than straight
   * into extra_caps. The rows are the record — who granted what, when, and until
   * when (R-8) — and extra_caps is kept as a projection of them.
   *
   * Three states per capability, cycled in that order: nothing → granted →
   * denied → nothing. DENY IS NOT THE ABSENCE OF A GRANT: a role baseline can
   * carry a capability, so "not granted" and "denied" are different answers and
   * the UI has to be able to express both (S-R R-3).
   */
  async function cycleGrant(m: Member, cap: string) {
    const live = (grants[m.id] ?? []).filter((g) => g.capability === cap)
    const nextMode = live.length === 0 ? 'grant' : live[0].mode === 'grant' ? 'deny' : null
    const desired = [
      ...(grants[m.id] ?? []).filter((g) => g.capability !== cap)
        .map((g) => ({ capability: g.capability, mode: g.mode, expiresAt: g.expiresAt })),
      ...(nextMode ? [{ capability: cap, mode: nextMode, expiresAt: null }] : []),
    ]
    setBusy(m.id); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, grants: desired }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change access.')
    await load(); setBusy(null)
  }

  /** Expiry on one grant (G-5). Null = permanent, which is the default. */
  async function setExpiry(m: Member, cap: string, value: string) {
    const desired = (grants[m.id] ?? []).map((g) =>
      g.capability === cap
        ? { capability: g.capability, mode: g.mode, expiresAt: value ? new Date(value).toISOString() : null }
        : { capability: g.capability, mode: g.mode, expiresAt: g.expiresAt },
    )
    setBusy(m.id); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, grants: desired }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not set an expiry.')
    await load(); setBusy(null)
  }

  // Custom role name — shown across the studio in place of the standard label.
  async function saveTitle(m: Member, title: string) {
    if ((m.title ?? '') === title.trim()) return
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, title }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not save the role name.')
    await load()
  }

  // Toggle an ADDITIONAL role — capabilities are the union of everything held.
  async function toggleExtraRole(m: Member, r: string) {
    const current = m.roles ?? []
    const next = current.includes(r) ? current.filter((x) => x !== r) : [...current, r]
    setBusy(m.id); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, roles: next }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change roles.')
    await load(); setBusy(null)
  }

  async function setStatus(memberId: string, status: 'paused' | 'active') {
    setBusy(memberId); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, status }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change status.')
    await load(); setBusy(null)
  }

  async function remove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from the crew? They lose all studio access immediately. Their login itself survives — it may belong to another company — but they will no longer be on this team. (Use pause to hold access temporarily instead.)`)) return
    setBusy(memberId); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not remove member.')
    await load(); setBusy(null)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <UsersRound size={24} className="text-primary" />
          Team
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your crew — everyone with studio access, and what they&apos;re allowed to do.
        </p>
      </div>

      {error && <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>}
      {notice && <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">{notice}</p>}

      {canManage && (
        <form onSubmit={invite} className="mb-8 rounded-2xl border border-border bg-card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserPlus size={15} className="text-primary" /> Invite a teammate
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_auto_auto_auto]">
            <input
              required value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
            />
            <input
              required type="email" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="name@company.com"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
            />
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as OrgRole }))}
              aria-label="Company role"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
            {/* THE SEAT CLASS — S-R §2's first axis, and the decision that was
                missing rather than the mechanism. It chooses the scope_mode
                WRITTEN to the row (SEAT_CLASS_SCOPE_MODE); nothing re-derives it
                afterwards. */}
            <select
              value={form.seatClass}
              onChange={(e) => setForm((f) => ({ ...f, seatClass: e.target.value as SeatClass }))}
              aria-label="Seat class"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {SEAT_CLASSES.map((sc) => (
                <option key={sc} value={sc}>{SEAT_CLASS_LABEL[sc]}</option>
              ))}
            </select>
            <button
              type="submit" disabled={sending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Invite
            </button>
          </div>
          {/* BOTH consequences, in words, before the invite is sent.
              The seat-class one has to be said out loud: choosing Contractor
              writes scope_mode 'selected' with no assignments yet, so the person
              signs in to an EMPTY studio until someone puts them on a production.
              S-R §8 S-3 forbids an empty state that names what is missing — which
              means the explaining has to happen HERE, to the admin who can act on
              it, rather than there, to the person who cannot. */}
          <p className="mt-2 text-xs text-faint">{ROLE_HELP[form.role]}</p>
          <p className="mt-1 text-xs text-faint">
            <span className="font-semibold text-muted-foreground">{SEAT_CLASS_LABEL[form.seatClass]}</span>
            {' · '}{SEAT_CLASS_HELP[form.seatClass]}
            {' '}<span className="text-faint">(scope: {SEAT_CLASS_SCOPE_MODE[form.seatClass]})</span>
          </p>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-faint">Loading the roster…</p>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                {(m.name ?? m.email)[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                  {m.name ?? m.email}
                  {m.role === 'owner' && <ShieldCheck size={13} className="flex-shrink-0 text-primary" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                {canManage && m.role !== 'owner' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[9.5px] uppercase tracking-wide text-faint">also:</span>
                    {ASSIGNABLE.filter((r) => r !== m.role).map((r) => {
                      const on = (m.roles ?? []).includes(r)
                      return (
                        <button
                          key={r} type="button" disabled={busy === m.id}
                          onClick={() => toggleExtraRole(m, r)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-faint hover:text-muted-foreground'
                          }`}
                        >
                          {r}
                        </button>
                      )
                    })}
                  </div>
                )}
                {/* The seat, beside the role. An admin looking at a roster needs to
                    see WHY somebody reads one production rather than all of them,
                    and the seat class is the first half of that answer. */}
                {m.seat_class === 'contractor' && (
                  <span className="ml-1.5 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {SEAT_CLASS_LABEL.contractor}
                  </span>
                )}
                {!canManage && (m.roles?.length ?? 0) > 0 && (
                  <p className="mt-0.5 text-[10px] text-faint">also: {m.roles!.join(', ')}</p>
                )}
                {/* SEAT, SCOPE, PRODUCTIONS — the three halves of "why does this
                    person see what they see". The owner is excluded from the
                    controls for the same reason they are excluded from the role
                    picker: G-3/G-4 refuse it at the row anyway, and offering a
                    click the database will refuse reads as a bug. */}
                {canManage && m.role !== 'owner' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <select
                      value={m.seat_class ?? 'staff'} disabled={busy === m.id}
                      onChange={(e) => patchMember(m.id, { seatClass: e.target.value })}
                      aria-label="Seat class"
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {SEAT_CLASSES.map((sc) => (
                        <option key={sc} value={sc}>{SEAT_CLASS_LABEL[sc]}</option>
                      ))}
                    </select>
                    <select
                      value={m.scope_mode ?? 'all'} disabled={busy === m.id}
                      onChange={(e) => patchMember(m.id, { scopeMode: e.target.value })}
                      aria-label="Project scope"
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      <option value="all">every production</option>
                      <option value="selected">assigned only</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setOpenProjects(openProjects === m.id ? null : m.id)}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Productions
                    </button>
                  </div>
                )}
                {canManage && openProjects === m.id && (
                  <MemberAssignments
                    memberId={m.id}
                    projects={projects}
                    scopeMode={m.scope_mode ?? 'all'}
                  />
                )}
                {canManage && m.role !== 'owner' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {/* GROUPED BY DOMAIN, NOT FORTY CHECKBOXES (S-R §13). The
                        summary line is the resolved answer; the detail opens on
                        demand, so the common case stays one line per person. */}
                    <button
                      type="button"
                      onClick={() => setOpenCaps(openCaps === m.id ? null : m.id)}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <GrantSummary grants={grants[m.id] ?? []} />
                    </button>
                    <input
                      key={`${m.id}-${m.title ?? ''}`}
                      defaultValue={m.title ?? ''}
                      placeholder="Custom role name"
                      maxLength={40}
                      onBlur={(e) => saveTitle(m, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="ml-1 w-36 rounded-lg border border-border bg-background px-2 py-0.5 text-[10.5px] text-foreground placeholder:text-faint focus:border-primary focus:outline-none"
                    />
                  </div>
                )}

                {canManage && m.role !== 'owner' && openCaps === m.id && (
                  <div className="mt-2">
                    <CapabilityGrants
                      grantable={ORG_GRANTABLE}
                      grants={grants[m.id] ?? []}
                      myCaps={myCaps}
                      busy={busy === m.id}
                      onCycle={(cap) => cycleGrant(m, cap)}
                      onExpiry={(cap, v) => setExpiry(m, cap, v)}
                    />
                  </div>
                )}
                {!canManage && m.title && (
                  <p className="mt-0.5 text-[10px] font-semibold text-primary">{m.title}</p>
                )}
              </div>
              <span className={`hidden flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold sm:block ${
                m.status === 'active' ? 'bg-primary/10 text-primary'
                : m.status === 'paused' ? 'bg-destructive/10 text-destructive'
                : 'bg-secondary text-muted-foreground'
              }`}>
                {m.status === 'active' ? `Joined ${fmt(m.accepted_at)}`
                : m.status === 'paused' ? 'Paused'
                : `Invited ${fmt(m.invited_at)}`}
              </span>
              {canManage && m.role !== 'owner' ? (
                <>
                  <select
                    value={m.role} disabled={busy === m.id}
                    onChange={(e) => setRole(m.id, e.target.value)}
                    className="flex-shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                  <button
                    type="button" disabled={busy === m.id}
                    onClick={() => setStatus(m.id, m.status === 'paused' ? 'active' : 'paused')}
                    title={m.status === 'paused' ? 'Reinstate access' : 'Pause access (reversible)'}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {m.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                  <button
                    type="button" disabled={busy === m.id}
                    onClick={() => remove(m.id, m.name ?? m.email)}
                    title="Remove from the crew — access ends, the login survives"
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              ) : (
                <span className="flex-shrink-0 text-xs font-semibold capitalize text-muted-foreground">{m.role}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
