'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check } from 'lucide-react'

type Client = {
  id: string
  name: string
  email: string
  company: string | null
  phone: string | null
  notes: string | null
}

export default function EditClientForm({ client }: { client: Client }) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: client.name ?? '',
    email: client.email ?? '',
    company: client.company ?? '',
    phone: client.phone ?? '',
    notes: client.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/admin/update-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          updates: {
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            company: form.company.trim() || null,
            phone: form.phone.trim() || null,
            notes: form.notes.trim() || null,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save.')
      setSaved(true)
      setTimeout(() => router.push(`/admin/clients/${client.id}`), 800)
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

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div>
      <label className={labelClass} style={labelStyle}>{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className={inputClass}
        style={inputStyle}
      />
    </div>
  )

  return (
    <div className="max-w-[640px] space-y-6">
      <Link href={`/admin/clients/${client.id}`}
        className="inline-flex items-center gap-2 text-sm"
        style={{ color: 'hsl(var(--muted-foreground))' }}>
        <ArrowLeft size={14} /> Back to {client.name}
      </Link>

      <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
        Edit Client
      </h1>

      <form onSubmit={save} className="p-6 rounded-xl space-y-5"
        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        {field('Full name', 'name')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Email', 'email', 'email')}
          {field('Phone', 'phone', 'tel')}
        </div>
        {field('Company', 'company')}
        <div>
          <label className={labelClass} style={labelStyle}>Internal notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            rows={3}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>
        )}

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
