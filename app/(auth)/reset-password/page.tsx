'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import ProductMark from '@/components/ProductMark'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
      }
    })
  }, [])

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    // Posts to our own route rather than calling Supabase directly, so the
    // email can be resolved to the person's studio and sent with that studio's
    // branding (S-C CM-5). The endpoint answers identically whether or not the
    // address has an account, so there is no error branch to render — showing
    // one would turn this form into an account-existence oracle.
    try {
      await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Same outcome either way — see above.
    }
    setSent(true)
    setLoading(false)
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setUpdated(true)
    setTimeout(() => router.push('/login'), 2000)
  }

  const inputStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'hsl(var(--background))' }}
    >
      <div className="w-full max-w-sm">
        {/* Product mark — pre-auth, no tenant to resolve (S0-B §2). */}
        <div className="mb-8">
          <ProductMark size={52} showName />
        </div>

        {updated ? (
          <div
            className="p-4 rounded-lg text-sm"
            style={{
              backgroundColor: 'hsl(var(--status-green) / 0.12)',
              color: 'hsl(var(--status-green))',
              border: '1px solid hsl(var(--status-green) / 0.3)',
            }}
          >
            Password updated. Redirecting to login...
          </div>
        ) : isRecovery ? (
          <>
            <h1
              className="font-display text-2xl font-bold mb-2"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Set new password
            </h1>
            <p className="text-sm mb-8" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Choose a strong password for your account.
            </p>
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div>
                <label
                  className="block text-xs font-semibold uppercase 
                  tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full px-4 py-3 rounded-lg text-sm 
                    pr-10 outline-none transition-all"
                    style={inputStyle}
                    onFocus={(e) => {
                      e.target.style.borderColor = 'hsl(var(--primary))'
                      e.target.style.boxShadow =
                        '0 0 0 3px hsl(var(--primary) / 0.12)'
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = 'hsl(var(--border))'
                      e.target.style.boxShadow = 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'hsl(var(--text-faint))' }}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label
                  className="block text-xs font-semibold uppercase 
                  tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full px-4 py-3 rounded-lg text-sm 
                  outline-none transition-all"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'hsl(var(--primary))'
                    e.target.style.boxShadow =
                      '0 0 0 3px hsl(var(--primary) / 0.12)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'hsl(var(--border))'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
              {error && (
                <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm font-semibold 
                transition-all disabled:opacity-60"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {loading ? 'Updating...' : 'Update password →'}
              </button>
            </form>
          </>
        ) : sent ? (
          <>
            <h1
              className="font-display text-2xl font-bold mb-2"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Check your email
            </h1>
            <p className="text-sm mb-8" style={{ color: 'hsl(var(--muted-foreground))' }}>
              We sent a reset link to{' '}
              <span style={{ color: 'hsl(var(--primary))' }}>{email}</span>. 
              Click the link in the email to set a new password.
            </p>
            <Link
              href="/login"
              className="text-sm"
              style={{ color: 'hsl(var(--primary))' }}
            >
              ← Back to login
            </Link>
          </>
        ) : (
          <>
            <h1
              className="font-display text-2xl font-bold mb-2"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Reset your password
            </h1>
            <p className="text-sm mb-8" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Enter your email and we will send you a reset link.
            </p>
            <form onSubmit={handleRequestReset} className="space-y-5">
              <div>
                <label
                  className="block text-xs font-semibold uppercase 
                  tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@company.com"
                  required
                  className="w-full px-4 py-3 rounded-lg text-sm 
                  outline-none transition-all"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'hsl(var(--primary))'
                    e.target.style.boxShadow =
                      '0 0 0 3px hsl(var(--primary) / 0.12)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'hsl(var(--border))'
                    e.target.style.boxShadow = 'none'
                  }}
                />
              </div>
              {error && (
                <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm font-semibold 
                transition-all disabled:opacity-60"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                onMouseEnter={(e) => {
                  if (!loading)
                    e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
                }}
              >
                {loading ? 'Sending...' : 'Send reset link →'}
              </button>
              <div className="text-center">
                <Link
                  href="/login"
                  className="text-sm"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  ← Back to login
                </Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
