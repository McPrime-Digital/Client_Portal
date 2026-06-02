'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import {
  Shield, Lock, Check, Loader2, AlertCircle, Eye, EyeOff,
  CreditCard, Building2, Users, ChevronRight,
} from 'lucide-react'

type Props = { user: User }

type SectionKey = 'business' | 'payments' | 'profile' | 'security' | 'team'

export default function AdminSettings({ user }: Props) {
  const supabase = createClient()
  const [section, setSection] = useState<SectionKey>('business')

  // Admin display name lives in auth user_metadata.
  const [name, setName] = useState<string>(user.user_metadata?.name ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')

  const [passwordForm, setPasswordForm] = useState({ next: '', confirm: '' })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [showNext, setShowNext] = useState(false)

  // Business + payment settings (global — shown on client invoices).
  const emptyPay = {
    business_name: '', business_email: '', business_address: '',
    bank_name: '', bank_address: '', account_name: '', account_number: '',
    routing_number: '', swift: '', payment_instructions: '',
  }
  const [pay, setPay] = useState(emptyPay)
  const [paySaving, setPaySaving] = useState(false)
  const [paySuccess, setPaySuccess] = useState(false)
  const [payError, setPayError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/admin/invoice-actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_settings' }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (active && j.settings) {
          setPay((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, j.settings[k] ?? ''])) as typeof prev)
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  async function savePayment(e: React.FormEvent) {
    e.preventDefault()
    setPaySaving(true); setPayError(''); setPaySuccess(false)
    try {
      const res = await fetch('/api/admin/invoice-actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_settings', settings: pay }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save.')
      setPaySuccess(true); setTimeout(() => setPaySuccess(false), 3000)
    } catch (err: any) {
      setPayError(err.message ?? 'Failed to save.')
    } finally {
      setPaySaving(false)
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true); setProfileError(''); setProfileSuccess(false)
    try {
      const { error } = await supabase.auth.updateUser({ data: { name: name.trim() } })
      if (error) throw error
      setProfileSuccess(true); setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      setProfileError(err.message ?? 'Failed to save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(''); setPasswordSuccess(false)
    if (passwordForm.next.length < 8) { setPasswordError('New password must be at least 8 characters.'); return }
    if (passwordForm.next !== passwordForm.confirm) { setPasswordError('Passwords do not match.'); return }
    setPasswordSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordForm.next })
      if (error) throw error
      setPasswordSuccess(true); setPasswordForm({ next: '', confirm: '' }); setTimeout(() => setPasswordSuccess(false), 4000)
    } catch (err: any) {
      setPasswordError(err.message ?? 'Failed to update password.')
    } finally {
      setPasswordSaving(false)
    }
  }

  const inputClass = 'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = { backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = 'hsl(var(--primary))'; e.target.style.boxShadow = '0 0 0 3px hsl(var(--primary) / 0.08)' },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = 'hsl(var(--border))'; e.target.style.boxShadow = 'none' },
  }
  const labelClass = 'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' }

  const payField = (label: string, key: keyof typeof emptyPay, full = false) => (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className={labelClass} style={labelStyle}>{label}</label>
      <input type="text" value={pay[key]} onChange={(e) => setPay((p) => ({ ...p, [key]: e.target.value }))} className={inputClass} style={inputStyle} {...focusHandlers} />
    </div>
  )

  const card = { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }

  function SectionHeader({ icon: Icon, tint, title, subtitle }: { icon: any; tint: string; title: string; subtitle: string }) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `hsl(var(--${tint}) / 0.1)` }}>
          <Icon size={17} style={{ color: `hsl(var(--${tint}))` }} />
        </div>
        <div>
          <h2 className="font-display text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{title}</h2>
          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{subtitle}</p>
        </div>
      </div>
    )
  }

  function PaySaveButton() {
    return (
      <button type="submit" disabled={paySaving} className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
        style={{ backgroundColor: paySuccess ? 'hsl(var(--status-green) / 0.15)' : 'hsl(var(--primary))', color: paySuccess ? 'hsl(var(--status-green))' : 'hsl(var(--primary-foreground))' }}>
        {paySaving ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : paySuccess ? <><Check size={13} /> Saved</> : 'Save Changes'}
      </button>
    )
  }

  const navItems: { key: SectionKey; label: string; icon: any; desc: string; tint: string }[] = [
    { key: 'business', label: 'Business Profile', icon: Building2, desc: 'Identity on invoices', tint: 'primary' },
    { key: 'payments', label: 'Payment Details', icon: CreditCard, desc: 'Bank & wire info', tint: 'status-green' },
    { key: 'profile', label: 'Admin Profile', icon: Shield, desc: 'Your account', tint: 'status-blue' },
    { key: 'security', label: 'Security', icon: Lock, desc: 'Password & access', tint: 'status-violet' },
    { key: 'team', label: 'Team & Roles', icon: Users, desc: 'Seats & permissions', tint: 'status-amber' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Manage your business profile, billing details and account security
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Section nav — premium, adaptive (scrolls on mobile, rail on desktop) */}
        <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible scrollbar-none -mx-1 px-1 lg:mx-0 lg:px-0">
          {navItems.map(({ key, label, icon: Icon, desc, tint }) => {
            const active = section === key
            return (
              <button key={key} onClick={() => setSection(key)}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all flex-shrink-0 lg:w-full"
                style={{
                  backgroundColor: active ? 'hsl(var(--card))' : 'transparent',
                  border: active ? '1px solid hsl(var(--border))' : '1px solid transparent',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    backgroundColor: active ? `hsl(var(--${tint}) / 0.14)` : 'hsl(var(--secondary))',
                    border: active ? `1px solid hsl(var(--${tint}) / 0.25)` : '1px solid transparent',
                  }}>
                  <Icon size={15} style={{ color: active ? `hsl(var(--${tint}))` : 'hsl(var(--muted-foreground))' }} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold whitespace-nowrap lg:whitespace-normal"
                    style={{ color: active ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>{label}</span>
                  <span className="hidden lg:block text-[11px] truncate" style={{ color: 'hsl(var(--text-faint))' }}>{desc}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* Panel */}
        <div className="max-w-[880px]">
          {/* Business Profile */}
          {section === 'business' && (
            <form onSubmit={savePayment} className="p-6 rounded-xl space-y-5" style={card}>
              <SectionHeader icon={Building2} tint="primary" title="Business Profile" subtitle="Identity shown to clients on invoices and receipts" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {payField('Business name', 'business_name')}
                {payField('Business email', 'business_email')}
                {payField('Business address', 'business_address', true)}
              </div>
              {payError && <div className="flex items-center gap-2"><AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} /><p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{payError}</p></div>}
              <PaySaveButton />
            </form>
          )}

          {/* Payment Details */}
          {section === 'payments' && (
            <form onSubmit={savePayment} className="p-6 rounded-xl space-y-5" style={card}>
              <SectionHeader icon={CreditCard} tint="primary" title="Payment Details" subtitle="Shown to clients on unpaid invoices for bank / wire transfers" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {payField('Bank name', 'bank_name')}
                {payField('Account name', 'account_name')}
                {payField('Account number', 'account_number')}
                {payField('Routing number', 'routing_number')}
                {payField('SWIFT / BIC', 'swift')}
                {payField('Bank address', 'bank_address', true)}
                {payField('Business address', 'business_address', true)}
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Payment instructions</label>
                <textarea value={pay.payment_instructions} onChange={(e) => setPay((p) => ({ ...p, payment_instructions: e.target.value }))} rows={3}
                  placeholder="e.g. Pay in USD. Email or upload your receipt after transferring." className={inputClass} style={inputStyle} />
              </div>
              {payError && <div className="flex items-center gap-2"><AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} /><p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{payError}</p></div>}
              <PaySaveButton />
            </form>
          )}

          {/* Admin Profile */}
          {section === 'profile' && (
            <form onSubmit={saveProfile} className="p-6 rounded-xl space-y-5" style={card}>
              <SectionHeader icon={Shield} tint="primary" title="Admin Profile" subtitle={user.email ?? ''} />
              <div>
                <label className={labelClass} style={labelStyle}>Display Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputClass} style={inputStyle} {...focusHandlers} />
              </div>
              {profileError && <div className="flex items-center gap-2"><AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} /><p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{profileError}</p></div>}
              <button type="submit" disabled={profileSaving} className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                style={{ backgroundColor: profileSuccess ? 'hsl(var(--status-green) / 0.15)' : 'hsl(var(--primary))', color: profileSuccess ? 'hsl(var(--status-green))' : 'hsl(var(--primary-foreground))' }}>
                {profileSaving ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : profileSuccess ? <><Check size={13} /> Saved</> : 'Save Profile'}
              </button>
            </form>
          )}

          {/* Security */}
          {section === 'security' && (
            <form onSubmit={changePassword} className="p-6 rounded-xl space-y-5" style={card}>
              <SectionHeader icon={Lock} tint="status-blue" title="Change Password" subtitle="Use a strong password unique to this account" />
              <div>
                <label className={labelClass} style={labelStyle}>New Password</label>
                <div className="relative">
                  <input type={showNext ? 'text' : 'password'} value={passwordForm.next} onChange={(e) => setPasswordForm((p) => ({ ...p, next: e.target.value }))}
                    placeholder="Min 8 characters" className="w-full pl-4 pr-12 py-3 rounded-lg text-sm outline-none transition-all" style={inputStyle} {...focusHandlers} />
                  <button type="button" onClick={() => setShowNext(!showNext)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'hsl(var(--text-faint))' }}>
                    {showNext ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {passwordForm.next && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: passwordForm.next.length < 8 ? '25%' : passwordForm.next.length < 12 ? '60%' : '100%', backgroundColor: passwordForm.next.length < 8 ? 'hsl(var(--destructive))' : passwordForm.next.length < 12 ? 'hsl(var(--primary))' : 'hsl(var(--status-green))' }} />
                    </div>
                    <span className="text-[10px]" style={{ color: passwordForm.next.length < 8 ? 'hsl(var(--destructive))' : passwordForm.next.length < 12 ? 'hsl(var(--primary))' : 'hsl(var(--status-green))' }}>
                      {passwordForm.next.length < 8 ? 'Too short' : passwordForm.next.length < 12 ? 'Good' : 'Strong'}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Confirm New Password</label>
                <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} placeholder="Repeat new password" className={inputClass} style={inputStyle} {...focusHandlers} />
                {passwordForm.confirm && passwordForm.next && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {passwordForm.next === passwordForm.confirm
                      ? <><Check size={11} style={{ color: 'hsl(var(--status-green))' }} /><span className="text-[11px]" style={{ color: 'hsl(var(--status-green))' }}>Passwords match</span></>
                      : <><AlertCircle size={11} style={{ color: 'hsl(var(--destructive))' }} /><span className="text-[11px]" style={{ color: 'hsl(var(--destructive))' }}>Passwords do not match</span></>}
                  </div>
                )}
              </div>
              {passwordError && <div className="flex items-center gap-2"><AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} /><p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{passwordError}</p></div>}
              <button type="submit" disabled={passwordSaving || !passwordForm.next || !passwordForm.confirm} className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                style={{ backgroundColor: passwordSuccess ? 'hsl(var(--status-green) / 0.15)' : 'hsl(var(--secondary))', color: passwordSuccess ? 'hsl(var(--status-green))' : 'hsl(var(--foreground))', border: passwordSuccess ? '1px solid hsl(var(--status-green) / 0.3)' : '1px solid hsl(var(--border))' }}>
                {passwordSaving ? <><Loader2 size={13} className="animate-spin" /> Updating...</> : passwordSuccess ? <><Check size={13} /> Password Updated</> : <><Lock size={13} /> Update Password</>}
              </button>
            </form>
          )}

          {/* Team & Roles — SaaS roadmap */}
          {section === 'team' && (
            <div className="p-6 rounded-xl space-y-5" style={card}>
              <SectionHeader icon={Users} tint="status-violet" title="Team & Roles" subtitle="Invite teammates and assign roles across your workspace" />
              <div className="rounded-lg p-4" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold" style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>
                      {(user.user_metadata?.name ?? user.email ?? 'A').slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>{user.user_metadata?.name ?? user.email}</p>
                      <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{user.email}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>Owner</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg p-4" style={{ border: '1px dashed hsl(var(--border))' }}>
                <div className="flex items-center gap-2">
                  <Users size={15} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>Multi-seat teams & granular roles</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'hsl(var(--text-faint))' }}>Coming soon <ChevronRight size={13} /></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
