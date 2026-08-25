'use client'

import { useCallback, useEffect, useState } from 'react'
import { UsersRound, UserPlus, ShieldCheck, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ORG_GRANTABLE } from '@/lib/permissions'

type Member = {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: 'owner' | 'admin' | 'producer' | 'finance' | 'editor' | 'member'
  roles?: string[]
  extra_caps?: string[]
  title?: string | null
  status: 'invited' | 'active' | 'paused' | 'revoked'
  invited_at: string
  accepted_at: string | null
}

const ASSIGNABLE = ['admin', 'producer', 'finance', 'editor', 'member'] as const

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including billing and this page',
  admin: 'Manage team, clients, settings, and money',
  producer: 'Run projects and the client relationship',
  finance: 'Invoices, billing, and cost control',
  editor: 'Workspace craft — script, storyboard, AI tools',
  member: 'Work inside projects and the workspace',
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function TeamManager() {
  const [members, setMembers] = useState<Member[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'member' })
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/team')
      if (res.ok) {
        const json = await res.json()
        setMembers(json.members ?? [])
        setCanManage(!!json.canManage)
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
        setForm({ name: '', email: '', role: 'member' })
        load()
      }
    } catch { setError('Invite failed.') }
    setSending(false)
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

  // Custom access: toggle a granted capability on top of the member's roles.
  async function toggleGrant(m: Member, cap: string) {
    const current = m.extra_caps ?? []
    const next = current.includes(cap) ? current.filter((c) => c !== cap) : [...current, cap]
    setBusy(m.id); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, extraCaps: next }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not change access.')
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
    if (!confirm(`Delete  permanently? Their account is removed entirely — no Throughline access of any kind. This cannot be undone. (Use pause to hold access instead.)`)) return
    setBusy(memberId); setError(null)
    const res = await fetch('/api/admin/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Could not delete member.')
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
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>
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
          <p className="mt-2 text-xs text-faint">{ROLE_HELP[form.role]}</p>
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
                {!canManage && (m.roles?.length ?? 0) > 0 && (
                  <p className="mt-0.5 text-[10px] text-faint">also: {m.roles!.join(', ')}</p>
                )}
                {canManage && m.role !== 'owner' && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[9.5px] uppercase tracking-wide text-faint">access:</span>
                    {ORG_GRANTABLE.map(({ cap, label }) => {
                      const on = (m.extra_caps ?? []).includes(cap)
                      return (
                        <button
                          key={cap} type="button" disabled={busy === m.id}
                          onClick={() => toggleGrant(m, cap)}
                          title={`Grant "${label}" beyond their roles`}
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
                    title="Delete permanently — account removed forever"
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
