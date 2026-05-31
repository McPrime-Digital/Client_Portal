'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import McPrimeLogo from '@/components/McPrimeLogo'
import {
  ArrowRight, ArrowLeft, Loader2, Check, ImagePlus, Building2,
  Bell, Sparkles,
} from 'lucide-react'

type Initial = {
  name: string
  company: string
  phone: string
  avatarUrl: string | null
}

const PREF_OPTIONS = [
  { key: 'files', label: 'New deliverables & files' },
  { key: 'messages', label: 'New messages from the team' },
  { key: 'invoices', label: 'Invoices & payment updates' },
  { key: 'status', label: 'Project status changes' },
]

export default function OnboardingWizard({ initial }: { initial: Initial }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: initial.name,
    company: initial.company,
    phone: initial.phone,
  })
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    files: true, messages: true, invoices: true, status: true,
  })

  const steps = ['Welcome', 'Your company', 'Notifications', 'All set']

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setError('Logo must be under 4 MB.'); return }
    setUploadingLogo(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/portal/avatar', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed.')
      setAvatarUrl(json.avatar_url)
    } catch (err: any) {
      setError(err.message ?? 'Upload failed.')
    } finally {
      setUploadingLogo(false)
      if (logoRef.current) logoRef.current.value = ''
    }
  }

  async function finish() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/portal/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          phone: form.phone,
          notification_prefs: prefs,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not finish setup.')
      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      setError(err.message ?? 'Could not finish setup.')
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ backgroundColor: 'hsl(var(--background))' }}>
      <div className="w-full max-w-md">
        <div className="mb-6"><McPrimeLogo height={48} rounded="rounded-2xl" /></div>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-colors"
              style={{ backgroundColor: i <= step ? 'hsl(var(--primary))' : 'hsl(var(--secondary))' }} />
          ))}
        </div>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'hsl(var(--primary) / 0.12)' }}>
              <Sparkles size={22} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              Welcome to your portal
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Let&apos;s take a minute to set up your workspace — add your company details and choose how
              you&apos;d like to stay informed. You can change all of this later in Settings.
            </p>
            <StepNav onNext={() => setStep(1)} nextLabel="Get started" />
          </div>
        )}

        {/* Step 1 — Company */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Building2 size={20} style={{ color: 'hsl(var(--primary))' }} />
              <h1 className="font-display text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Your company
              </h1>
            </div>

            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 p-1.5"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-xl font-bold" style={{ color: 'hsl(var(--primary))' }}>
                    {(form.company || form.name)[0]?.toUpperCase() ?? 'C'}
                  </span>
                )}
              </div>
              <div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                <button type="button" onClick={() => logoRef.current?.click()} disabled={uploadingLogo}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
                  style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                  {uploadingLogo ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                  {avatarUrl ? 'Change logo' : 'Upload company logo'}
                </button>
                <p className="text-xs mt-1.5" style={{ color: 'hsl(var(--text-faint))' }}>PNG, JPG or SVG · max 4 MB</p>
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>Company name</label>
              <input value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))}
                placeholder="Your company" className={inputClass} style={inputStyle} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>Your name</label>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Phone</label>
                <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+1 (555) 000-0000" className={inputClass} style={inputStyle} />
              </div>
            </div>

            <StepNav onBack={() => setStep(0)} onNext={() => setStep(2)} />
          </div>
        )}

        {/* Step 2 — Notifications */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Bell size={20} style={{ color: 'hsl(var(--primary))' }} />
              <h1 className="font-display text-xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
                Stay informed
              </h1>
            </div>
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Choose what you&apos;d like to be notified about.
            </p>
            <div className="space-y-2">
              {PREF_OPTIONS.map((o) => (
                <label key={o.key}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-lg cursor-pointer"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <span className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>{o.label}</span>
                  <input type="checkbox" checked={prefs[o.key] ?? false}
                    onChange={(e) => setPrefs((p) => ({ ...p, [o.key]: e.target.checked }))}
                    className="w-4 h-4 accent-[hsl(var(--primary))]" />
                </label>
              ))}
            </div>
            <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} />
          </div>
        )}

        {/* Step 3 — Done */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'hsl(var(--status-green) / 0.12)' }}>
              <Check size={22} style={{ color: 'hsl(var(--status-green))' }} />
            </div>
            <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
              You&apos;re all set
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Your workspace is ready. You can manage projects, files, messages, and invoices from your dashboard.
            </p>
            {error && <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>}
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(2)} disabled={saving}
                className="px-4 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-60"
                style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                Back
              </button>
              <button onClick={finish} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Finishing...</> : <>Enter your portal <ArrowRight size={14} /></>}
              </button>
            </div>
          </div>
        )}

        {/* Skip */}
        {step < 3 && (
          <button onClick={finish} disabled={saving}
            className="mt-6 text-xs transition-colors mx-auto block"
            style={{ color: 'hsl(var(--text-faint))' }}>
            Skip for now
          </button>
        )}

        {error && step !== 3 && (
          <p className="text-sm mt-3 text-center" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>
        )}
      </div>
    </div>
  )
}

function StepNav({ onBack, onNext, nextLabel = 'Continue' }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      {onBack && (
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-3 rounded-lg text-sm font-medium transition-all"
          style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      <button type="button" onClick={onNext}
        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all"
        style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
        {nextLabel} <ArrowRight size={14} />
      </button>
    </div>
  )
}
