import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ShieldCheck, Clock, Check, X as XIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { capGate } from '@/lib/capabilities.server'
import { readContract, STATUS_LABEL } from '@/lib/contracts'
import ActionButton from '@/components/studio/ActionButton'
import AddSigner from '@/components/studio/AddSigner'

/**
 * ONE CONTRACT, and its certificate of completion.
 *
 * `S3-b` §3.5 is explicit about what a certificate must contain: signer
 * identity, verified email, IP, and timestamps for sent, viewed and completed.
 * That is the timeline at the bottom of this page — it is not a debug view, it
 * is the artifact the whole table exists to produce.
 *
 * THE RECORD CANNOT BE EDITED FROM HERE, OR ANYWHERE. `contract_events` is
 * append-only by trigger for everyone including the service role (0068), with
 * one narrow exception for the AD-003 tombstone (0071). A page that offered an
 * edit control would be offering something the database refuses.
 */

function ts(s: string) {
  return new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Drafted',
  sent: 'Sent for signature',
  opened: 'Opened',
  viewed: 'Opened',
  consented: 'Agreed to sign electronically',
  field_filled: 'Field completed',
  signed: 'Signed',
  declined: 'Declined',
  reminded: 'Reminder sent',
  expired: 'Expired',
  voided: 'Voided',
}

export default async function ContractRecordPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requireOrgFeature('client', 'contracts')
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const denied = await capGate(user, 'record.contract.read')
  if (denied) redirect('/studio')

  const detail = await readContract(supabase, id)
  // Absent rather than forbidden — RLS makes a foreign contract invisible, and
  // the redirect cannot tell the two apart either (R-6).
  if (!detail) redirect('/studio/client/contracts')

  const { contract, signers, events } = detail
  const isDraft = contract.status === 'draft'
  const signedCount = signers.filter((s) => s.status === 'signed').length

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/studio/client/contracts"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} /> Contracts
      </Link>

      <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {contract.title}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {STATUS_LABEL[contract.status]}
        {signers.length > 0 && ` · ${signedCount} of ${signers.length} signed`}
      </p>

      {contract.content_hash && (
        // §3.6 "association with the record". The hash is taken at SEND over the
        // exact bytes presented, and never recomputed — a hash that moved with
        // the document would prove the opposite of what it is for.
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

      <section className="mt-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">Signers</h2>
        {signers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nobody yet. A contract cannot be sent without at least one — it would
            complete the moment it was opened.
          </p>
        ) : (
          <ol className="space-y-2">
            {signers.map((s) => (
              <li key={s.id} className="squircle-sm flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-border bg-card px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-foreground">
                    {s.seq + 1}. {s.name}
                  </span>
                  <span className="block truncate text-[11px] text-faint">{s.email}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                  {s.status === 'signed' && <Check size={12} className="text-primary" />}
                  {s.status === 'declined' && <XIcon size={12} className="text-destructive" />}
                  {s.status === 'signed' && s.signed_at ? `Signed ${ts(s.signed_at)}` : s.status}
                </span>
              </li>
            ))}
          </ol>
        )}
        {isDraft && <AddSigner contractId={contract.id} />}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {isDraft && signers.length > 0 && (
          <ActionButton
            endpoint="/api/studio/contracts"
            body={{ action: 'send', contractId: contract.id }}
            label="Send for signature"
            confirm="Send this for signature? The text is frozen and hashed at that moment."
          />
        )}
        {contract.status !== 'completed' && contract.status !== 'voided' && (
          <ActionButton
            endpoint="/api/studio/contracts"
            body={{ action: 'void', contractId: contract.id }}
            label="Void"
            tone="danger"
            confirm="Void this contract? The record stays; the document stops being signable."
          />
        )}
      </div>

      <section className="mt-8">
        <h2 className="mb-1 font-display text-sm font-semibold text-foreground">
          Certificate of completion
        </h2>
        <p className="mb-3 text-[12px] text-muted-foreground">
          Every action on this document, timestamped and attributed. Append-only —
          nobody can edit or remove an entry, including an owner.
        </p>
        {events.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2.5 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]" />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">
                    <strong className="font-medium">{e.actor_name}</strong> ·{' '}
                    {EVENT_LABEL[e.event] ?? e.event}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-faint">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={9} /> {ts(e.occurred_at)}
                    </span>
                    {e.ip_address && <span>IP {e.ip_address}</span>}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
