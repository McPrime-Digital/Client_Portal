'use client'

import { useCallback, useEffect, useState } from 'react'
import { UsersRound, UserPlus, ShieldCheck, Loader2, X } from 'lucide-react'

type Member = {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: 'owner' | 'admin' | 'producer' | 'member'
  status: 'invited' | 'active' | 'revoked'
  invited_at: string
  accepted_at: string | null
}

const ROLE_HELP: Record<string, string> = {
  owner: 'Everything, including billing and this page',
  admin: 'Manage team, clients, and settings',
  producer: 'Run projects and client work',
  member: 'Work inside projects',
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

  async function revoke(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from the team? Their access ends immediately.`)) return
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
              <option value="admin">Admin</option>
              <option value="producer">Producer</option>
              <option value="member">Member</option>
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
              </div>
              <span className={`hidden flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold sm:block ${
                m.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
              }`}>
                {m.status === 'active' ? `Joined ${fmt(m.accepted_at)}` : `Invited ${fmt(m.invited_at)}`}
              </span>
              {canManage && m.role !== 'owner' ? (
                <>
                  <select
                    value={m.role} disabled={busy === m.id}
                    onChange={(e) => setRole(m.id, e.target.value)}
                    className="flex-shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="admin">Admin</option>
                    <option value="producer">Producer</option>
                    <option value="member">Member</option>
                  </select>
                  <button
                    type="button" disabled={busy === m.id}
                    onClick={() => revoke(m.id, m.name ?? m.email)}
                    title="Remove from team"
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                  >
                    <X size={14} />
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
