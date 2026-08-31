'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import AuthShell from '@/components/auth/AuthShell'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    // This page already had the right frame; AuthShell is that frame extracted,
    // so /set-password and /reset-password stop being a different product.
    <AuthShell
      footer={
        <Link
          href="/reset-password"
          className="text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          Forgot your password?
        </Link>
      }
    >
      <>
        <div>
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="font-display text-[28px] font-bold text-brand-text tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-brand-muted leading-relaxed">
              Sign in to access your portal
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-brand-muted uppercase tracking-wider mb-2"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 px-4 rounded-lg bg-brand-bg border border-brand-border text-brand-text text-sm placeholder:text-brand-muted/50 outline-none transition-all duration-200 focus:border-brand-gold focus:ring-2 focus:ring-brand-gold/25"
                placeholder="you@company.com"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-brand-muted uppercase tracking-wider mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 pr-12 rounded-lg bg-brand-bg border border-brand-border text-brand-text text-sm placeholder:text-brand-muted/50 outline-none transition-all duration-200 focus:border-brand-gold focus:ring-2 focus:ring-brand-gold/25"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-brand-muted hover:text-brand-text transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-lg bg-brand-gold hover:bg-brand-gold-hover text-brand-bg font-semibold text-sm tracking-wide transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <LoadingSpinner />
                  <span>Signing in…</span>
                </>
              ) : (
                'Sign in to portal'
              )}
            </button>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-brand-error/10 border border-brand-error/20">
                <ErrorIcon />
                <p className="text-sm text-brand-error leading-snug">{error}</p>
              </div>
            )}
          </form>
        </div>

        {/* "Forgot your password?" moved to AuthShell's footer — a secondary
            action belongs under the card, not inside it.

            No copyright line. It said "© McPrime Digital" to every tenant's
            clients, and the correct replacement is not knowable yet: S0-B §7
            leaves the legal entity unresolved and names the copyright line on
            product surfaces as a consequence to settle when it lands. An
            unowned © claim is worse than none. */}
      </>
    </AuthShell>
  )
}

/* ─── Inline SVG Components ──────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--destructive))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
