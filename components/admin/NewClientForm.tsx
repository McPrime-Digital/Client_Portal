'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  UserPlus,
  Mail,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react'

export default function NewClientForm() {
  const router = useRouter()

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    password: '',
    notes: '',
    useInviteLink: true,  // ← DEFAULT: magic link email
  })

  function updateForm(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function generatePassword() {
    const chars =
      'ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
    let password = ''
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(
        Math.floor(Math.random() * chars.length)
      )
    }
    updateForm('password', password)
    setShowPassword(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
  
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.')
      return
    }
  
    // Only require password if NOT using invite link
    if (
      !form.useInviteLink &&
      (!form.password || form.password.length < 8)
    ) {
      setError('Password must be at least 8 characters.')
      return
    }
  
    setSaving(true)
    setError('')
  
    try {
      const response = await fetch(
        '/api/admin/create-client',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.trim().toLowerCase(),
            password: form.useInviteLink
              ? undefined          // Supabase generates token
              : form.password,
            name: form.name.trim(),
            useInviteLink: form.useInviteLink,
            company: form.company.trim(),
            phone: form.phone.trim(),
            notes: form.notes.trim(),
          }),
        }
      )
  
      const result = await response.json()
  
      if (!response.ok) {
        throw new Error(
          result.error ?? 'Failed to create user account.'
        )
      }
  
      const { clientId } = result
  
      setDone(true)
      setTimeout(() => {
        router.push(`/admin/clients/${clientId}`)
      }, 2000)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.')
      setSaving(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--primary-foreground))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow =
        '0 0 0 3px hsl(var(--primary) / 0.08)'
    },
    onBlur: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }
  const labelClass =
    'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' }

  if (done) {
    return (
      <div className="max-w-[480px] flex flex-col 
        items-center justify-center py-20 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center 
          justify-center mb-5"
          style={{
            backgroundColor: 'hsl(var(--status-green) / 0.12)',
          }}
        >
          <Check size={28}
            style={{ color: 'hsl(var(--status-green))' }} />
        </div>
        <h2
          className="font-display text-xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Client Created
        </h2>
        <p className="text-sm mt-2 leading-relaxed"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          {form.useInviteLink ? (
            <>
              An invite link has been sent to{' '}
              <span style={{ color: 'hsl(var(--primary))' }}>
                {form.email}
              </span>{' '}
              via Resend. They'll click it to set 
              their password and enter the portal.
            </>
          ) : (
            <>
              {form.name}'s account is ready. Share 
              the credentials you generated directly 
              with your client.
            </>
          )}
        </p>
        <div
          className="mt-4 w-6 h-6 rounded-full border-2 
          animate-spin"
          style={{
            borderColor: 'hsl(var(--primary))',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-[560px] space-y-6">

      {/* Back */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-2 text-sm 
        transition-colors"
        style={{ color: 'hsl(var(--muted-foreground))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'hsl(var(--foreground))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
      >
        <ArrowLeft size={14} />
        Back to Clients
      </Link>

      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          New Client
        </h1>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Creates a portal login account and client profile
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Personal info */}
        <div
          className="p-6 rounded-xl space-y-4"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <h3
            className="font-display text-sm font-semibold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Client Information
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label
                className={labelClass}
                style={labelStyle}
              >
                Full Name *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) =>
                  updateForm('name', e.target.value)
                }
                placeholder="Jane Smith"
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div className="col-span-2">
              <label
                className={labelClass}
                style={labelStyle}
              >
                Email Address *
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) =>
                  updateForm('email', e.target.value)
                }
                placeholder="jane@company.com"
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Company
              </label>
              <input
                type="text"
                value={form.company}
                onChange={(e) =>
                  updateForm('company', e.target.value)
                }
                placeholder="Acme Corp"
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Phone
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  updateForm('phone', e.target.value)
                }
                placeholder="+1 (555) 000-0000"
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>
          </div>

          <div>
            <label
              className={labelClass}
              style={labelStyle}
            >
              Internal Notes
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) =>
                updateForm('notes', e.target.value)
              }
              placeholder="Referral source, preferences, 
anything to remember..."
              className="w-full px-4 py-3 rounded-lg 
              text-sm outline-none transition-all resize-none"
              style={inputStyle}
              {...focusHandlers}
            />
          </div>
        </div>

        {/* Portal access */}
        <div
          className="p-6 rounded-xl space-y-4"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <h3
            className="font-display text-sm font-semibold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Portal Access
          </h3>

          {/* Toggle — invite link vs manual password */}
          <div
            className="p-1 rounded-xl flex gap-1"
            style={{ backgroundColor: 'hsl(var(--primary-foreground))' }}
          >
            {/* Option A — Invite Link (DEFAULT) */}
            <button
              type="button"
              onClick={() => updateForm('useInviteLink', true)}
              className="flex-1 flex items-center justify-center 
              gap-2 px-4 py-3 rounded-lg text-sm font-semibold 
              transition-all"
              style={{
                backgroundColor: form.useInviteLink
                  ? 'hsl(var(--card))'
                  : 'transparent',
                color: form.useInviteLink
                  ? 'hsl(var(--foreground))'
                  : 'hsl(var(--text-faint))',
                border: form.useInviteLink
                  ? '1px solid hsl(var(--border))'
                  : '1px solid transparent',
              }}
            >
              <Mail size={14} />
              Send Invite Link
              {form.useInviteLink && (
                <span
                  className="text-[10px] px-1.5 py-0.5 
                  rounded-full font-bold ml-1"
                  style={{
                    backgroundColor: 'hsl(var(--status-green) / 0.15)',
                    color: 'hsl(var(--status-green))',
                  }}
                >
                  Recommended
                </span>
              )}
            </button>

            {/* Option B — Manual Password */}
            <button
              type="button"
              onClick={() => updateForm('useInviteLink', false)}
              className="flex-1 flex items-center justify-center 
              gap-2 px-4 py-3 rounded-lg text-sm font-semibold 
              transition-all"
              style={{
                backgroundColor: !form.useInviteLink
                  ? 'hsl(var(--card))'
                  : 'transparent',
                color: !form.useInviteLink
                  ? 'hsl(var(--foreground))'
                  : 'hsl(var(--text-faint))',
                border: !form.useInviteLink
                  ? '1px solid hsl(var(--border))'
                  : '1px solid transparent',
              }}
            >
              <Eye size={14} />
              Set Password Manually
            </button>
          </div>

          {/* Invite link mode — description */}
          {form.useInviteLink && (
            <div
              className="flex items-start gap-3 p-4 rounded-xl"
              style={{
                backgroundColor: 'hsl(var(--status-green) / 0.06)',
                border: '1px solid hsl(var(--status-green) / 0.15)',
              }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center 
                justify-center flex-shrink-0 mt-0.5"
                style={{
                  backgroundColor: 'hsl(var(--status-green) / 0.12)',
                }}
              >
                <Mail size={13}
                  style={{ color: 'hsl(var(--status-green))' }} />
              </div>
              <div>
                <p
                  className="text-sm font-semibold"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  Invite email will be sent automatically
                </p>
                <p className="text-xs mt-1 leading-relaxed"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Resend will deliver a secure invite link to{' '}
                  <span style={{ color: 'hsl(var(--primary))' }}>
                    {form.email || 'the client\'s email'}
                  </span>
                  . They click it and set their own password.
                  No credentials to share manually.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Check size={11}
                    style={{ color: 'hsl(var(--status-green))' }} />
                  <span className="text-[11px]"
                    style={{ color: 'hsl(var(--status-green))' }}>
                    Sent via Resend from your McPrime domain
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Check size={11}
                    style={{ color: 'hsl(var(--status-green))' }} />
                  <span className="text-[11px]"
                    style={{ color: 'hsl(var(--status-green))' }}>
                    Link expires after 24 hours for security
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Check size={11}
                    style={{ color: 'hsl(var(--status-green))' }} />
                  <span className="text-[11px]"
                    style={{ color: 'hsl(var(--status-green))' }}>
                    Client sets their own password on first login
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Manual password mode */}
          {!form.useInviteLink && (
            <div className="space-y-4">
              <div
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{
                  backgroundColor: 'hsl(var(--primary) / 0.06)',
                  border: '1px solid hsl(var(--primary) / 0.12)',
                }}
              >
                <AlertCircle size={13}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: 'hsl(var(--primary))' }} />
                <p className="text-xs leading-relaxed"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Use this only when the client hasn't received 
                  their invite email or needs immediate access. 
                  Share credentials securely — not over email.
                </p>
              </div>

              {/* Password input */}
              <div>
                <div className="flex items-center 
                  justify-between mb-2">
                  <label
                    className={labelClass}
                    style={labelStyle}
                  >
                    Temporary Password *
                  </label>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="text-xs transition-colors"
                    style={{ color: 'hsl(var(--primary))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--primary))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--primary))'
                    }}
                  >
                    Generate password
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) =>
                      updateForm('password', e.target.value)
                    }
                    placeholder="Min 8 characters"
                    className="w-full pl-4 pr-12 py-3 rounded-lg 
                    text-sm outline-none transition-all"
                    style={inputStyle}
                    {...focusHandlers}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(!showPassword)
                    }
                    className="absolute right-3 top-1/2 
                    -translate-y-1/2 transition-colors"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--foreground))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'hsl(var(--text-faint))'
                    }}
                  >
                    {showPassword ? (
                      <EyeOff size={15} />
                    ) : (
                      <Eye size={15} />
                    )}
                  </button>
                </div>

                {/* Strength bar */}
                {form.password && (
                  <div className="flex items-center gap-2 mt-2">
                    <div
                      className="flex-1 h-1 rounded-full 
                      overflow-hidden"
                      style={{ backgroundColor: 'hsl(var(--secondary))' }}
                    >
                      <div
                        className="h-full rounded-full 
                        transition-all"
                        style={{
                          width:
                            form.password.length < 8
                              ? '25%'
                              : form.password.length < 12
                              ? '60%'
                              : '100%',
                          backgroundColor:
                            form.password.length < 8
                              ? 'hsl(var(--destructive))'
                              : form.password.length < 12
                              ? 'hsl(var(--primary))'
                              : 'hsl(var(--status-green))',
                        }}
                      />
                    </div>
                    <span
                      className="text-[10px]"
                      style={{
                        color:
                          form.password.length < 8
                            ? 'hsl(var(--destructive))'
                            : form.password.length < 12
                            ? 'hsl(var(--primary))'
                            : 'hsl(var(--status-green))',
                      }}
                    >
                      {form.password.length < 8
                        ? 'Too short'
                        : form.password.length < 12
                        ? 'Good'
                        : 'Strong'}
                    </span>
                  </div>
                )}
              </div>

              {/* Credentials copy box */}
              {form.email && form.password && (
                <div
                  className="p-4 rounded-xl space-y-2"
                  style={{
                    backgroundColor: 'hsl(var(--primary) / 0.05)',
                    border: '1px solid hsl(var(--primary) / 0.15)',
                  }}
                >
                  <p
                    className="text-xs font-semibold uppercase 
                    tracking-wider"
                    style={{ color: 'hsl(var(--primary))' }}
                  >
                    Share with client directly
                  </p>
                  <div className="space-y-1.5">
                    {[
                      {
                        label: 'Portal URL',
                        value:
                          typeof window !== 'undefined'
                            ? `${window.location.origin}/login`
                            : 'your-domain.com/login',
                      },
                      { label: 'Email', value: form.email },
                      {
                        label: 'Password',
                        value: showPassword
                          ? form.password
                          : '••••••••••••',
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="flex items-center 
                        justify-between gap-4"
                      >
                        <span className="text-xs"
                          style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {label}
                        </span>
                        <span
                          className="text-xs font-mono 
                          truncate"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2"
                    style={{ color: 'hsl(var(--text-faint))' }}>
                    Send via text or DM — never plain email
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2">
            <AlertCircle size={14}
              style={{ color: 'hsl(var(--destructive))' }} />
            <p className="text-sm"
              style={{ color: 'hsl(var(--destructive))' }}>
              {error}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/clients"
            className="px-5 py-3 rounded-lg text-sm 
            font-medium transition-all"
            style={{
              backgroundColor: 'hsl(var(--secondary))',
              color: 'hsl(var(--muted-foreground))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 flex items-center 
            justify-center gap-2 py-3 rounded-lg text-sm 
            font-semibold transition-all disabled:opacity-60"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
            onMouseEnter={(e) => {
              if (!saving)
                e.currentTarget.style.backgroundColor =
                  'hsl(var(--primary))'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                'hsl(var(--primary))'
            }}
          >
            {saving ? (
              <>
                <Loader2 size={14}
                  className="animate-spin" />
                Creating account...
              </>
            ) : (
              <>
                <UserPlus size={14} />
                Create Client Account
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
