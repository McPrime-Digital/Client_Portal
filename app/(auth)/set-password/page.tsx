'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import McPrimeLogo from '@/components/McPrimeLogo'

export default function SetPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  // One client instance for the whole page, so the session established
  // here from the invite link is the same one used at submit. Creating
  // a second client in handleSubmit is what caused "Auth session missing".
  const [supabase] = useState(() => createClient())

  useEffect(() => {
    let active = true

    // Invite/recovery links carry the session in the URL. The browser
    // client auto-detects it and emits SIGNED_IN; we adopt the session
    // from whichever source resolves first.
    function adopt(session: Session | null): boolean {
      if (!active || !session?.user?.email) return false
      setEmail(session.user.email)
      setSessionReady(true)
      setPageLoading(false)
      // Strip the token from the address bar now it's been consumed.
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState({}, document.title, window.location.pathname)
      }
      return true
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { adopt(session) }
    )

    supabase.auth.getSession().then(async ({ data }) => {
      if (adopt(data.session)) return

      // Fallback: token arrived in the hash but wasn't auto-detected —
      // set the session from it manually.
      if (typeof window !== 'undefined' && window.location.hash) {
        const p = new URLSearchParams(window.location.hash.substring(1))
        const access_token = p.get('access_token')
        const refresh_token = p.get('refresh_token')
        if (access_token && refresh_token) {
          const { data: setData } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          })
          if (adopt(setData.session)) return
        }
      }

      // Give auto-detection a brief moment before declaring failure.
      setTimeout(() => {
        if (active) setPageLoading(false)
      }, 1500)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
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

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    // Link auth user to client record
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const clientId = user.user_metadata?.client_id
      if (clientId) {
        await supabase
          .from('clients')
          .update({ user_id: user.id })
          .eq('id', clientId)
      }
    }

    setSuccess(true)
    // New clients land in the self-serve onboarding wizard first.
    setTimeout(() => router.push('/onboarding'), 1500)
  }

  const inputStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }

  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow = '0 0 0 3px hsl(var(--primary) / 0.12)'
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'hsl(var(--background))' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8">
          <McPrimeLogo height={56} rounded="rounded-2xl" />
        </div>

        {/* Page loading state */}
        {pageLoading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2
              size={28}
              className="animate-spin mb-4"
              style={{ color: 'hsl(var(--primary))' }}
            />
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Setting up your account...
            </p>
          </div>
        )}

        {/* Session error — token expired or invalid */}
        {!pageLoading && !sessionReady && (
          <div className="space-y-4">
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Link expired
            </h1>
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              This invite link has expired or has already been used.
              Please contact McPrime Digital for a new invite.
            </p>
            <div
              className="p-4 rounded-lg text-sm"
              style={{
                backgroundColor: 'hsl(var(--destructive) / 0.08)',
                border: '1px solid hsl(var(--destructive) / 0.2)',
                color: 'hsl(var(--destructive))',
              }}
            >
              For your security, invite links can only be used once and
              expire after a short time. Reach out and we&apos;ll send a
              fresh one.
            </div>
            <a
              href="mailto:hello@mcprimedigital.com"
              className="block text-center text-sm py-3 rounded-lg 
              font-medium transition-all"
              style={{
                backgroundColor: 'hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              Contact McPrime Digital
            </a>
          </div>
        )}

        {/* Success state */}
        {!pageLoading && sessionReady && success && (
          <div className="space-y-4">
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Account created! 🎉
            </h1>
            <div
              className="p-4 rounded-lg text-sm flex items-center 
              gap-3"
              style={{
                backgroundColor: 'hsl(var(--status-green) / 0.12)',
                color: 'hsl(var(--status-green))',
                border: '1px solid hsl(var(--status-green) / 0.3)',
              }}
            >
              <Loader2 size={14} className="animate-spin flex-shrink-0" />
              Setting up your workspace...
            </div>
          </div>
        )}

        {/* Form */}
        {!pageLoading && sessionReady && !success && (
          <>
            <h1
              className="font-display text-2xl font-bold mb-2"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Set up your account
            </h1>
            <p className="text-sm mb-8" style={{ color: 'hsl(var(--muted-foreground))' }}>
              Welcome to McPrime Digital. Create your password 
              to access your portal.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email read only */}
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
                  readOnly
                  className="w-full px-4 py-3 rounded-lg text-sm 
                  cursor-not-allowed"
                  style={{
                    backgroundColor: 'hsl(var(--border))',
                    border: '1px solid hsl(var(--border))',
                    color: 'hsl(var(--text-faint))',
                  }}
                />
              </div>

              {/* Password */}
              <div>
                <label
                  className="block text-xs font-semibold uppercase 
                  tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    required
                    className="w-full px-4 py-3 rounded-lg text-sm 
                    pr-10 outline-none transition-all"
                    style={inputStyle}
                    {...focusHandlers}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 
                    -translate-y-1/2"
                    style={{ color: 'hsl(var(--text-faint))' }}
                  >
                    {showPass
                      ? <EyeOff size={15} />
                      : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Confirm */}
              <div>
                <label
                  className="block text-xs font-semibold uppercase 
                  tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    required
                    className="w-full px-4 py-3 rounded-lg text-sm 
                    pr-10 outline-none transition-all"
                    style={inputStyle}
                    {...focusHandlers}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 
                    -translate-y-1/2"
                    style={{ color: 'hsl(var(--text-faint))' }}
                  >
                    {showConfirm
                      ? <EyeOff size={15} />
                      : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm 
                font-semibold transition-all disabled:opacity-60 
                flex items-center justify-center gap-2"
                style={{
                  backgroundColor: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
                onMouseEnter={(e) => {
                  if (!loading)
                    e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
                }}
              >
                {loading && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                {loading ? 'Creating account...' : 'Create my account →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
