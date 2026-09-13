import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ShieldCheck, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import { readContract, isSignersTurn, STATUS_LABEL, CONSENT_TEXT } from '@/lib/contracts'
import SignContract from '@/components/portal/SignContract'

/**
 * Read it, then sign it.
 *
 * WHY THIS PAGE CAN BE TRUSTED TO SHOW WHAT WAS SIGNED: the text rendered here
 * is the same text `content_hash` was taken over at send, and after send the
 * body is not editable through `lib/contracts.ts`. A document whose words can
 * change after it goes out has a hash that lies.
 *
 * WHOSE TURN IT IS is computed, not guessed. `seq` is a signing ORDER, so a
 * later signer is not merely "pending" — they are blocked on somebody, and being
 * told which is the difference between waiting and chasing.
 */
export default async function PortalContractPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await can(user, 'portal.view'))) redirect('/dashboard')

  const detail = await readContract(supabase, id)
  if (!detail) redirect('/dashboard/contracts')

  const { contract, signers, events } = detail
  const me = signers.find((s) => s.user_id === user.id) ?? null

  const alreadyConsented = !!me && events.some(
    (e) => e.event === 'consented' && e.signer_id === me.id
  )

  let disabledReason: string | null = null
  if (!me) disabledReason = 'You are not a signer on this document.'
  else if (me.status === 'signed') disabledReason = null
  else if (me.status === 'declined') disabledReason = 'You declined this document.'
  else if (!['sent', 'viewed', 'partially_signed'].includes(contract.status)) {
    disabledReason = 'This document is not open for signature.'
  } else if (!isSignersTurn(signers, me.id)) {
    const ahead = signers
      .filter((s) => s.seq < me.seq && s.status !== 'signed' && s.status !== 'declined')
      .map((s) => s.name)
    disabledReason = `Waiting on ${ahead.join(', ') || 'an earlier signer'} to sign first.`
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/contracts"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} /> Documents
      </Link>

      <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {contract.title}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{STATUS_LABEL[contract.status]}</p>

      {contract.content_hash && (
        <p className="mt-2 flex items-center gap-1.5 break-all text-[11px] text-faint">
          <ShieldCheck size={12} className="shrink-0 text-primary" />
          SHA-256 {contract.content_hash}
        </p>
      )}

      <section className="squircle mt-6 border border-border bg-card p-5">
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground">
          {contract.body?.text ?? ''}
        </pre>
      </section>

      <div className="mt-6">
        {me?.status === 'signed' ? (
          <p className="inline-flex items-center gap-2 text-[13px] text-foreground">
            <Check size={15} className="text-primary" />
            You signed this{me.signed_at ? ` on ${new Date(me.signed_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
            })}` : ''}.
          </p>
        ) : (
          <SignContract
            contractId={contract.id}
            consentText={CONSENT_TEXT}
            alreadyConsented={alreadyConsented}
            disabledReason={disabledReason}
          />
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">Who signs</h2>
        <ol className="space-y-1.5">
          {signers.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate text-foreground">{s.seq + 1}. {s.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {s.status === 'signed' ? 'Signed' : s.status === 'declined' ? 'Declined' : 'Waiting'}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
