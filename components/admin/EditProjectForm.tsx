'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check } from 'lucide-react'

type Project = {
  id: string
  title: string
  status: string | null
  due_date: string | null
  kickoff_date: string | null
  brief: string | null
  client_id: string | null
}

const STATUSES = [
  'Onboarding', 'Planning', 'Pre-Production', 'In Production',
  'In Review', 'Revisions', 'Completed', 'On Hold',
]

export default function EditProjectForm({
  project,
  clients,
}: {
  project: Project
  clients: { id: string; name: string; company: string | null }[]
}) {
  const router = useRouter()
  const [form, setForm] = useState({
    title: project.title ?? '',
    status: project.status ?? 'Onboarding',
    client_id: project.client_id ?? '',
    due_date: project.due_date ?? '',
    kickoff_date: project.kickoff_date ?? '',
    brief: project.brief ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/admin/project-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project',
          project_id: project.id,
          updates: {
            title: form.title.trim(),
            status: form.status,
            client_id: form.client_id || null,
            due_date: form.due_date || null,
            kickoff_date: form.kickoff_date || null,
            brief: form.brief.trim() || null,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save.')
      setSaved(true)
      setTimeout(() => router.push(`/admin/projects/${project.id}`), 800)
      router.refresh()
    } catch (err: any) {
      setError(err.message ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const labelClass = 'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' }
  const inputClass = 'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }))

  return (
    <div className="max-w-[640px] space-y-6">
      <Link href={`/admin/projects/${project.id}`}
        className="inline-flex items-center gap-2 text-sm"
        style={{ color: 'hsl(var(--muted-foreground))' }}>
        <ArrowLeft size={14} /> Back to project
      </Link>

      <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
        Edit Project
      </h1>

      <form onSubmit={save} className="p-6 rounded-xl space-y-5"
        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div>
          <label className={labelClass} style={labelStyle}>Title</label>
          <input value={form.title} onChange={(e) => set('title', e.target.value)}
            className={inputClass} style={inputStyle} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={labelStyle}>Client</label>
            <select value={form.client_id} onChange={(e) => set('client_id', e.target.value)}
              className={inputClass} style={inputStyle}>
              <option value="">— Unassigned —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.company ? ` — ${c.company}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}
              className={inputClass} style={inputStyle}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={labelStyle}>Kickoff date</label>
            <input type="date" value={form.kickoff_date} onChange={(e) => set('kickoff_date', e.target.value)}
              className={inputClass} style={{ ...inputStyle, colorScheme: 'dark' }} />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>Due date</label>
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)}
              className={inputClass} style={{ ...inputStyle, colorScheme: 'dark' }} />
          </div>
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>Brief</label>
          <textarea value={form.brief} onChange={(e) => set('brief', e.target.value)}
            rows={4} className={inputClass} style={inputStyle} />
        </div>

        {error && <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>}

        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{
            backgroundColor: saved ? 'hsl(var(--status-green) / 0.15)' : 'hsl(var(--primary))',
            color: saved ? 'hsl(var(--status-green))' : 'hsl(var(--primary-foreground))',
          }}>
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</>
            : saved ? <><Check size={14} /> Saved</>
            : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}
