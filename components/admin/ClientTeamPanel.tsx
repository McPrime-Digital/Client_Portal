'use client'

import { useCallback, useEffect, useState } from 'react'
import { UsersRound, ShieldCheck, Check, X } from 'lucide-react'

// Org oversight of one client company's team: roster with invite states,
// pending-invite approval, role overrides, revocation, and the invite policy.

type Member = {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: 'owner' | 'approver' | 'member' | 'viewer'
  status: 'pending' | 'invited' | 'active' | 'revoked'
  invited_at: string
  accepted_at: string | null
}

const POLICY_HELP: Record<string, string> = {
  open: 'The account owner invites teammates freely',
  approval: 'Invites wait for your approval before sending',
  locked: 'Only you can add seats to this company',
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function ClientTeamPanel({ clientId }: { clientId: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [policy, setPolicy] = useState('open')
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/client-team?clientId=${clientId}`)
      if (res.ok) {
        const json = await res.json()
        setMembers((json.members ?? []).filter((m: Member) => m.status !== 'revoked'))
        setPolicy(json.invitePolicy ?? 'open')
        setCanManage(!!json.canManage)
      }
    } catch {}
    setLoading(false)
  }, [clientId])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  async function act(payload: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey); setError(null)
    const res = await fetch('/api/admin/client-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) setError((await res.json()).error ?? 'Action failed.')
    await load(); setBusy(null)
  }

  const pending = members.filter((m) => m.status === 'pending')

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <UsersRound size={15} className="text-primary" /> Team
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{members.length}</span>
        </p>
        {canManage && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Invite policy
            <select
              value={policy}
              onChange={(e) => { setPolicy(e.target.value); act({ action: 'set_policy', clientId, policy: e.target.value }, 'policy') }}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="open">Open</option>
              <option value="approval">Approval required</option>
              <option value="locked">Locked</option>
            </select>
          </label>
        )}
      </div>
      <p className="mb-4 text-xs text-faint">{POLICY_HELP[policy]}</p>

      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {pending.length > 0 && (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-semibold text-primary">Awaiting your approval</p>
          {pending.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{m.name ?? m.email}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email} · as {m.role}</p>
              </div>
              <button
                type="button" disabled={busy === m.id}
                onClick={() => act({ action: 'approve', memberId: m.id }, m.id)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Check size={13} /> Approve
              </button>
              <button
                type="button" disabled={busy === m.id}
                onClick={() => act({ action: 'reject', memberId: m.id }, m.id)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                title="Reject"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-faint">Loading…</p>
      ) : (
        members.filter((m) => m.status !== 'pending').map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
            <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-primary">
              {(m.name ?? m.email)[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                {m.name ?? m.email}
                {m.role === 'owner' && <ShieldCheck size={12} className="flex-shrink-0 text-primary" />}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email} · {m.status === 'active' ? `joined ${fmt(m.accepted_at)}` : `invited ${fmt(m.invited_at)}`}
              </p>
            </div>
            {canManage && m.role !== 'owner' ? (
              <>
                <select
                  value={m.role} disabled={busy === m.id}
                  onChange={(e) => act({ action: 'set_role', memberId: m.id, role: e.target.value }, m.id)}
                  className="flex-shrink-0 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="approver">Approver</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="button" disabled={busy === m.id}
                  onClick={() => { if (confirm(`Revoke ${m.name ?? m.email}? Their access ends immediately.`)) act({ action: 'revoke', memberId: m.id }, m.id) }}
                  className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                  title="Revoke access"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <span className="flex-shrink-0 text-xs font-semibold capitalize text-muted-foreground">{m.role}</span>
            )}
          </div>
        ))
      )}
    </div>
  )
}
