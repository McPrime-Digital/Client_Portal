'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import {
  Shield,
  Lock,
  Check,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react'

type Props = {
  user: User
}

export default function AdminSettings({ user }: Props) {
  const supabase = createClient()

  // Profile state — admin display name lives in auth user_metadata
  const [name, setName] = useState<string>(
    user.user_metadata?.name ?? ''
  )
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Password state
  const [passwordForm, setPasswordForm] = useState({
    next: '',
    confirm: '',
  })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [showNext, setShowNext] = useState(false)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess(false)

    try {
      const { error } = await supabase.auth.updateUser({
        data: { name: name.trim() },
      })
      if (error) throw error

      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      setProfileError(err.message ?? 'Failed to save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (passwordForm.next.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('Passwords do not match.')
      return
    }

    setPasswordSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.next,
      })
      if (error) throw error

      setPasswordSuccess(true)
      setPasswordForm({ next: '', confirm: '' })
      setTimeout(() => setPasswordSuccess(false), 4000)
    } catch (err: any) {
      setPasswordError(err.message ?? 'Failed to update password.')
    } finally {
      setPasswordSaving(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--background))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow = '0 0 0 3px hsl(var(--primary) / 0.08)'
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }
  const labelClass =
    'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' }

  return (
    <div className="space-y-6 max-w-[560px]">

      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Manage your admin profile and account security
        </p>
      </div>

      {/* ── Profile ── */}
      <form
        onSubmit={saveProfile}
        className="p-6 rounded-xl space-y-5"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}
          >
            <Shield size={17} style={{ color: 'hsl(var(--primary))' }} />
          </div>
          <div>
            <h2
              className="font-display text-base font-semibold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Admin Profile
            </h2>
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {user.email}
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>
            Display Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className={inputClass}
            style={inputStyle}
            {...focusHandlers}
          />
        </div>

        {profileError && (
          <div className="flex items-center gap-2">
            <AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} />
            <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>
              {profileError}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={profileSaving}
          className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{
            backgroundColor: profileSuccess
              ? 'hsl(var(--status-green) / 0.15)'
              : 'hsl(var(--primary))',
            color: profileSuccess
              ? 'hsl(var(--status-green))'
              : 'hsl(var(--primary-foreground))',
            border: profileSuccess
              ? '1px solid hsl(var(--status-green) / 0.3)'
              : 'none',
          }}
        >
          {profileSaving ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Saving...
            </>
          ) : profileSuccess ? (
            <>
              <Check size={13} />
              Saved
            </>
          ) : (
            'Save Profile'
          )}
        </button>
      </form>

      {/* ── Password ── */}
      <form
        onSubmit={changePassword}
        className="p-6 rounded-xl space-y-5"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'hsl(var(--status-blue) / 0.1)' }}
          >
            <Lock size={17} style={{ color: 'hsl(var(--status-blue))' }} />
          </div>
          <div>
            <h2
              className="font-display text-base font-semibold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Change Password
            </h2>
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Use a strong password unique to this account
            </p>
          </div>
        </div>

        {/* New password */}
        <div>
          <label className={labelClass} style={labelStyle}>
            New Password
          </label>
          <div className="relative">
            <input
              type={showNext ? 'text' : 'password'}
              value={passwordForm.next}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, next: e.target.value }))
              }
              placeholder="Min 8 characters"
              className="w-full pl-4 pr-12 py-3 rounded-lg text-sm outline-none transition-all"
              style={inputStyle}
              {...focusHandlers}
            />
            <button
              type="button"
              onClick={() => setShowNext(!showNext)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              {showNext ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {/* Strength */}
          {passwordForm.next && (
            <div className="flex items-center gap-2 mt-2">
              <div
                className="flex-1 h-1 rounded-full overflow-hidden"
                style={{ backgroundColor: 'hsl(var(--secondary))' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width:
                      passwordForm.next.length < 8
                        ? '25%'
                        : passwordForm.next.length < 12
                        ? '60%'
                        : '100%',
                    backgroundColor:
                      passwordForm.next.length < 8
                        ? 'hsl(var(--destructive))'
                        : passwordForm.next.length < 12
                        ? 'hsl(var(--primary))'
                        : 'hsl(var(--status-green))',
                  }}
                />
              </div>
              <span
                className="text-[10px]"
                style={{
                  color:
                    passwordForm.next.length < 8
                      ? 'hsl(var(--destructive))'
                      : passwordForm.next.length < 12
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--status-green))',
                }}
              >
                {passwordForm.next.length < 8
                  ? 'Too short'
                  : passwordForm.next.length < 12
                  ? 'Good'
                  : 'Strong'}
              </span>
            </div>
          )}
        </div>

        {/* Confirm */}
        <div>
          <label className={labelClass} style={labelStyle}>
            Confirm New Password
          </label>
          <input
            type="password"
            value={passwordForm.confirm}
            onChange={(e) =>
              setPasswordForm((p) => ({ ...p, confirm: e.target.value }))
            }
            placeholder="Repeat new password"
            className={inputClass}
            style={inputStyle}
            {...focusHandlers}
          />
          {passwordForm.confirm && passwordForm.next && (
            <div className="flex items-center gap-1.5 mt-2">
              {passwordForm.next === passwordForm.confirm ? (
                <>
                  <Check size={11} style={{ color: 'hsl(var(--status-green))' }} />
                  <span className="text-[11px]" style={{ color: 'hsl(var(--status-green))' }}>
                    Passwords match
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={11} style={{ color: 'hsl(var(--destructive))' }} />
                  <span className="text-[11px]" style={{ color: 'hsl(var(--destructive))' }}>
                    Passwords do not match
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {passwordError && (
          <div className="flex items-center gap-2">
            <AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} />
            <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>
              {passwordError}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={passwordSaving || !passwordForm.next || !passwordForm.confirm}
          className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
          style={{
            backgroundColor: passwordSuccess
              ? 'hsl(var(--status-green) / 0.15)'
              : 'hsl(var(--secondary))',
            color: passwordSuccess
              ? 'hsl(var(--status-green))'
              : 'hsl(var(--foreground))',
            border: passwordSuccess
              ? '1px solid hsl(var(--status-green) / 0.3)'
              : '1px solid hsl(var(--border))',
          }}
        >
          {passwordSaving ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Updating...
            </>
          ) : passwordSuccess ? (
            <>
              <Check size={13} />
              Password Updated
            </>
          ) : (
            <>
              <Lock size={13} />
              Update Password
            </>
          )}
        </button>
      </form>
    </div>
  )
}
