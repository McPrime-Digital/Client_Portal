'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import AuthShell from '@/components/auth/AuthShell'
import TenantLogo from '@/components/TenantLogo'
import type { WelcomeContext } from '@/lib/welcomeContext'

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

  // WHO WAS INVITED, resolved the moment the token becomes a session.
  // Null until then — and null is the honest state, not a loading artefact:
  // before the token is adopted there is no tenant to name (S0-B §2).
  const [ctx, setCtx] = useState<WelcomeContext | null>(null)
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

    /*
     * NOT an authorization gate — the one permitted getSession() in the app.
     * This is the password-recovery landing page: it reads whatever session
     * the client library just built from the URL hash, purely to decide
     * whether to render the form or keep waiting. Nothing is authorized off
     * it; the credential change itself goes through updateUser(), which the
     * auth server validates. getUser() here would round-trip before the hash
     * token has been adopted, report no user, and break the reset flow (see
     * CLAUDE.md on /set-password loops).
     */
    // eslint-disable-next-line no-restricted-syntax
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

  // The session cookie is what the endpoint reads, so this runs after the
  // token has been adopted rather than alongside it. Failure is silent by
  // design: the page falls back to neutral copy and the form still works —
  // branding must never stand between someone and their password.
  useEffect(() => {
    if (!sessionReady) return
    let active = true
    fetch('/api/auth/welcome-context')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (active && j) setCtx(j as WelcomeContext) })
      .catch(() => {})
    return () => { active = false }
  }, [sessionReady])

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

    // (A clients.user_id self-link write lived here. It was dead twice over:
    // both creation paths set user_id at INSERT via the service role, and
    // 0021's column grants exclude user_id — so this browser-client update
    // has errored, ignored, since 0021 applied. Removed in Batch 6 item 8;
    // client_members is the sole membership authority.)

    setSuccess(true)
    // Routed by AUDIENCE, resolved server-side. This used to push everyone to
    // /onboarding, which sent crew through a redirect chain to the studio and —
    // worse — dropped invited teammates into their company's setup wizard.
    setTimeout(() => router.push(ctx?.next ?? '/dashboard'), 1500)
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

  // WHAT THIS INVITE ACTUALLY IS. Three different relationships, and the copy
  // says which — a studio bringing on a client company, that company adding a
  // colleague, and a studio adding crew are not the same event and should not
  // read as one generic "set up your account".
  const studio = ctx?.studioName ?? null
  const company = ctx?.companyName ?? null
  const heading =
    ctx?.audience === 'crew'
      ? studio ? `Join the ${studio} team` : 'Join the team'
      : ctx?.audience === 'client_teammate'
        ? company ? `Join ${company} on the portal` : 'Join your team on the portal'
        : ctx?.audience === 'client_owner'
          ? 'Set up your client portal'
          : 'Set up your account'
  const blurb =
    ctx?.audience === 'crew'
      ? `Choose a password and you will land in the workspace${studio ? `, with the projects ${studio} has assigned you` : ''}.`
      : ctx?.audience === 'client_teammate'
        ? `Choose a password to join${company ? ` ${company}'s` : ' your team\u2019s'} workspace${studio ? ` with ${studio}` : ''}.`
        : ctx?.audience === 'client_owner'
          ? `Choose a password to open the portal${studio ? ` ${studio} has set up for you` : ''}.`
          : 'Create your password to access your portal.'

  return (
    // The mark sits centred ABOVE the card, and the form sits inside it — the
    // same frame as /login. This screen used to put its content straight onto
    // the page background, so an invited client's first impression was a
    // different-looking product from the one they signed into a minute later.
    //
    // Still the PRODUCT's mark, not a studio's: the invite token is not
    // exchanged until submit, so the tenant is unknowable here (S0-B §2).
    <AuthShell
      mark={
        // Before the token is adopted there is no session and so no tenant —
        // the product's mark is the honest answer (S0-B §2). After it, the
        // studio is known and this is THEIR client's first screen, so it wears
        // their brand. AuthShell falls back to the product mark when null.
        ctx && studio
          ? <TenantLogo name={studio} logoUrl={ctx.studioLogoUrl ?? null} height={56} rounded="rounded-2xl" />
          : undefined
      }
    >
      <>
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
              Please ask whoever invited you to send a new one.
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
            {/* The contact button is gone rather than repointed. It was a
                mailto to one studio's address on a page every tenant's invitees
                reach, and there is nothing correct to put in its place: the
                studio is unknown here, and a product support address would send
                an invitee to the wrong company. The copy above tells them who
                to ask — the person who invited them. */}
            <Link
              href="/login"
              className="block text-center text-sm py-3 rounded-lg font-medium transition-all"
              style={{
                backgroundColor: 'hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              Back to sign in
            </Link>
          </div>
        )}

        {/* Success state */}
        {!pageLoading && sessionReady && success && (
          <div className="space-y-4">
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {ctx?.firstName ? `You\u2019re all set, ${ctx.firstName}` : 'You\u2019re all set'}
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
              {ctx?.audience === 'crew'
                ? 'Opening your workspace…'
                : company
                  ? `Opening ${company}\u2019s portal…`
                  : 'Opening your portal…'}
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
              {heading}
            </h1>
            <p className="text-sm mb-8" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {blurb}
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
      </>
    </AuthShell>
  )
}
