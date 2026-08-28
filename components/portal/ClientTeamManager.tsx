'use client'

import { useCallback, useEffect, useState } from 'react'
import { UsersRound, UserPlus, ShieldCheck, Loader2, Lock, History, FolderLock, Pause, Play, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CLIENT_GRANTABLE } from '@/lib/permissions'

type Member = {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: 'owner' | 'approver' | 'member' | 'viewer'
  status: 'pending' | 'invited' | 'active' | 'paused' | 'revoked'
  invited_at: string
  accepted_at: string | null
  history_from?: string | null
  extra_caps?: string[]
  title?: string | null
  client_member_projects?: { project_id: string }[]
}

const ROLE_HELP: Record<string, string> = {
  approver: 'Can approve deliverables and request changes',
  member: 'Can message, comment, and upload',
  viewer: 'Can view everything, read-only',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting studio approval',
  invited: 'Invite sent',
  active: 'Active',
  paused: 'Paused',
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function ClientTeamManager() {
  const [members, setMembers] = useState<Member[]>([])
  const [myRole, setMyRole] = useState<string>('member')
  const [canManage, setCanManage] = useState(false)
  const [policy, setPolicy] = useState<string>('open')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'member' })
  const [history, setHistory] = useState<'all' | 'new'>('all')
  const [scopeAll, setScopeAll] = useState(true)
  const [scopeIds, setScopeIds] = useState<string[]>([])
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([])
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/team')
      if (res.ok) {
        const json = await res.json()
        setMembers(json.members ?? [])
        setMyRole(json.myRole ?? 'member')
        setCanManage(!!json.canManage)
        setPolicy(json.invitePolicy ?? 'open')
        setProjects(json.projects ?? [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  // Live roster — membership changes land everywhere without a refresh.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('portal-team-roster')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_members' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const isOwner = myRole === 'owner' || canManage

  // Custom access: toggle a granted capability on top of the member's role.
  async function toggleGrant(m: Member, cap: string) {
    const current = m.extra_caps ?? []
    const next = current.includes(cap) ? current.filter((c) => c !== cap) : [...current, cap]
    setBusy(m.id); setError(null)
    const res = await fetch('/api/portal/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, extraCaps: next }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change access.')
    await load(); setBusy(null)
  }

  // Custom role name — shown across the portal in place of the standard label.
  async function saveTitle(m: Member, title: string) {
    if ((m.title ?? '') === title.trim()) return
    const res = await fetch('/api/portal/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, title }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not save the role name.')
    await load()
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setSending(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/portal/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, history, projectIds: scopeAll ? [] : scopeIds }),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error ?? 'Invite failed.')
      else {
        setNotice(json.message)
        setForm({ name: '', email: '', role: 'member' })
        setHistory('all'); setScopeAll(true); setScopeIds([])
        load()
      }
    } catch { setError('Invite failed.') }
    setSending(false)
  }

  async function setRole(memberId: string, role: string) {
    setBusy(memberId); setError(null)
    const res = await fetch('/api/portal/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, role }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change role.')
    await load(); setBusy(null)
  }

  async function setStatus(memberId: string, status: 'paused' | 'active') {
    setBusy(memberId); setError(null)
    const res = await fetch('/api/portal/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, status }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change status.')
    await load(); setBusy(null)
  }

  async function remove(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from the team? They lose access to this company immediately. Their login itself survives — it may belong to another company — but they will no longer be on this team. (Use pause to hold their access temporarily instead.)`)) return
    setBusy(memberId); setError(null)
    const res = await fetch('/api/portal/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not remove member.')
    await load(); setBusy(null)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <UsersRound size={24} className="text-primary" />
          Your team
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your marketing team and stakeholders into the work — everyone sees the same projects, files, and messages, with the role you choose.
        </p>
      </div>

      {error && <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</p>}
      {notice && <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-primary">{notice}</p>}

      {isOwner && policy !== 'locked' && (
        <form onSubmit={invite} className="mb-8 rounded-2xl border border-border bg-card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserPlus size={15} className="text-primary" /> Invite a teammate
            {policy === 'approval' && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Studio approves invites
              </span>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_auto_auto]">
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
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="approver">Approver</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="submit" disabled={sending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Invite
            </button>
          </div>
          <p className="mt-2 text-xs text-faint">{ROLE_HELP[form.role]}</p>

          {/* what they can see — the owner's call, set before the invite goes out */}
          <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <History size={13} className="text-primary" /> Message history
              </p>
              <div className="flex gap-1.5">
                {([['all', 'Full history'], ['new', 'New messages only']] as const).map(([v, label]) => (
                  <button
                    key={v} type="button" onClick={() => setHistory(v)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      history === v
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <FolderLock size={13} className="text-primary" /> Project access
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button" onClick={() => setScopeAll(true)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    scopeAll ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  All projects
                </button>
                <button
                  type="button" onClick={() => setScopeAll(false)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    !scopeAll ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  Only selected
                </button>
              </div>
              {!scopeAll && (
                <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {projects.map((p) => {
                    const on = scopeIds.includes(p.id)
                    return (
                      <button
                        key={p.id} type="button"
                        onClick={() => setScopeIds((ids) => (on ? ids.filter((i) => i !== p.id) : [...ids, p.id]))}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {p.title}
                      </button>
                    )
                  })}
                  {projects.length === 0 && <span className="text-[11px] text-faint">No projects yet</span>}
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {isOwner && policy === 'locked' && (
        <p className="mb-8 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Lock size={14} className="flex-shrink-0" />
          Team seats are managed by your studio — ask them to add teammates.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-faint">Loading your team…</p>
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
                <p className="truncate text-xs text-muted-foreground">
                  {m.email}
                  {m.history_from && <span className="ml-1.5 text-[10px] font-semibold text-faint">· new messages only</span>}
                  {(m.client_member_projects?.length ?? 0) > 0 && (
                    <span className="ml-1.5 text-[10px] font-semibold text-faint">
                      · {m.client_member_projects!.length} project{m.client_member_projects!.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </p>
                {isOwner && m.role !== 'owner' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[9.5px] uppercase tracking-wide text-faint">access:</span>
                    {CLIENT_GRANTABLE.map(({ cap, label }) => {
                      const on = (m.extra_caps ?? []).includes(cap)
                      return (
                        <button
                          key={cap} type="button" disabled={busy === m.id}
                          onClick={() => toggleGrant(m, cap)}
                          title={`Grant "${label}" beyond their role`}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            on ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-faint hover:text-muted-foreground'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
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
                {!isOwner && m.title && (
                  <p className="mt-0.5 text-[10px] font-semibold text-primary">{m.title}</p>
                )}
              </div>
              <span className={`hidden flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold sm:block ${
                m.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
              }`}>
                {m.status === 'active' ? `Joined ${fmt(m.accepted_at)}` : STATUS_LABEL[m.status] ?? m.status}
              </span>
              {isOwner && m.role !== 'owner' ? (
                <>
                  <select
                    value={m.role} disabled={busy === m.id || m.status === 'pending'}
                    onChange={(e) => setRole(m.id, e.target.value)}
                    className="flex-shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="approver">Approver</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button" disabled={busy === m.id || m.status === 'pending'}
                    onClick={() => setStatus(m.id, m.status === 'paused' ? 'active' : 'paused')}
                    title={m.status === 'paused' ? 'Reinstate access' : 'Pause access (reversible)'}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {m.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                  <button
                    type="button" disabled={busy === m.id}
                    onClick={() => remove(m.id, m.name ?? m.email)}
                    title="Remove from the team — access ends, the login survives"
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
