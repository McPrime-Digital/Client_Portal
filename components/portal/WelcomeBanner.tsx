'use client'

import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'

export default function WelcomeBanner({
  clientName,
  studioName,
  companyName,
  memberRole,
  dismissed,
}: {
  clientName: string
  /** The studio whose portal this is (S0-B §3) — never the product's name. */
  studioName: string
  /** The client company this person belongs to. */
  companyName?: string | null
  /**
   * Owner or colleague. The two arrived here by different routes and are
   * being welcomed to different things: an owner was invited BY the studio and
   * this portal is their company's; a teammate was invited by their own
   * colleague and is joining a workspace that already existed. One greeting for
   * both is how a product reads as generic (the owner's word: "done just like
   * that").
   */
  memberRole?: 'owner' | 'approver' | 'member' | 'viewer'
  // Server-persisted: once the client closes the banner it never returns.
  dismissed: boolean
}) {
  const [visible, setVisible] = useState(!dismissed)

  if (!visible) return null

  function close() {
    // Hide immediately, then persist the dismissal. The banner stays gone
    // across reloads/devices once `welcome_dismissed_at` is stored.
    setVisible(false)
    fetch('/api/portal/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss_welcome' }),
    }).catch(() => {})
  }

  return (
    <div
      className="relative p-5 rounded-2xl
      overflow-hidden mb-6"
      style={{
        background:
          'linear-gradient(135deg, ' +
          'hsl(var(--primary) / 0.12) 0%, ' +
          'hsl(var(--primary) / 0.04) 100%)',
        border:
          '1px solid hsl(var(--primary) / 0.25)',
      }}
    >
      {/* Dismiss */}
      <button
        onClick={close}
        aria-label="Dismiss welcome message"
        className="absolute top-4 right-4
        p-1 rounded-lg transition-all"
        style={{ color: 'hsl(var(--text-faint))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'hsl(var(--foreground))'
          e.currentTarget.style.backgroundColor
            = 'hsl(var(--secondary))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'hsl(var(--text-faint))'
          e.currentTarget.style.backgroundColor
            = 'transparent'
        }}
      >
        <X size={14} />
      </button>

      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-xl
          flex items-center justify-center
          flex-shrink-0"
          style={{
            backgroundColor:
              'hsl(var(--primary) / 0.15)',
          }}
        >
          <Sparkles
            size={18}
            style={{ color: 'hsl(var(--primary))' }}
          />
        </div>

        <div className="pr-6">
          <h2
            className="font-display text-base
            font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            {memberRole && memberRole !== 'owner' && companyName
              ? <>Welcome to {companyName}&rsquo;s workspace, {clientName.split(' ')[0]} 👋</>
              : <>Welcome to {studioName}, {clientName.split(' ')[0]} 👋</>}
          </h2>
          <p
            className="text-sm mt-1.5
            leading-relaxed"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            {memberRole && memberRole !== 'owner'
              ? <>You have been added to this workspace by your team. It is where{' '}
                  {studioName} keeps progress, files, approvals and conversation for
                  your projects — what you can see and do here follows the access
                  your team gave you.</>
              : <>This is your project portal — your single place to track progress,
                  review files, send messages, and manage payments. Your project
                  manager at {studioName} will keep everything updated here.</>}
          </p>
          <div className="flex flex-wrap gap-4
            mt-3">
            {/* Invoices are owner/approver-gated (clientCan 'invoices'), so
                promising a viewer they can pay one is a broken promise in the
                first thing they read. */}
            {(memberRole && memberRole !== 'owner'
              ? [
                  { label: 'View your projects', icon: '📁' },
                  { label: 'Download deliverables', icon: '⬇️' },
                  { label: 'Send a message', icon: '💬' },
                ]
              : [
                  { label: 'View your projects', icon: '📁' },
                  { label: 'Download deliverables', icon: '⬇️' },
                  { label: 'Send a message', icon: '💬' },
                  { label: 'Pay invoices', icon: '💳' },
                ]
            ).map((item) => (
              <div
                key={item.label}
                className="flex items-center
                gap-1.5"
              >
                <span className="text-sm">
                  {item.icon}
                </span>
                <span
                  className="text-xs"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
