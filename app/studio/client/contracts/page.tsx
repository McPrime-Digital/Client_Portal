import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileSignature, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { capGate } from '@/lib/capabilities.server'
import { listContracts, STATUS_LABEL } from '@/lib/contracts'
import NewContract from '@/components/studio/NewContract'

/**
 * CLIENT · CONTRACTS & SIGNATURES — `S3-b` §3, the surface.
 *
 * What a production actually signs: appearance and talent releases, location
 * agreements, crew deal memos, NDAs before a script goes out, music and stock
 * licences, client SOWs and change orders. Keeping them here rather than in a
 * separate e-signature product is not tidiness — it puts the agreement next to
 * the production, the files and the approval record it belongs to, and it gives
 * `rights.talent_consent` something that can substantiate it.
 */
export default async function ContractsPage() {
  await requireOrgFeature('client', 'contracts')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const denied = await capGate(user, 'record.contract.read')
  if (denied) redirect('/studio')

  const orgId = userOrgId(user)
  const [contracts, { data: companies }] = await Promise.all([
    listContracts(supabase, { orgId }),
    supabase.from('clients').select('id, name, company').order('name').limit(200),
  ])

  const outstanding = contracts.filter(
    (c) => c.status === 'sent' || c.status === 'viewed' || c.status === 'partially_signed'
  )

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <FileSignature size={24} className="text-primary" />
            Contracts &amp; Signatures
          </h1>
          {/* SS-5 — the number that decides what you do next. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {outstanding.length === 0
              ? 'Nothing is waiting on a signature.'
              : `${outstanding.length} document${outstanding.length === 1 ? '' : 's'} out for signature.`}
          </p>
        </div>
        <NewContract
          companies={(companies ?? []).map((c) => ({
            id: c.id as string,
            name: (c.company as string) || (c.name as string),
          }))}
        />
      </div>

      {contracts.length === 0 ? (
        <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Nothing yet. Releases, deal memos, location agreements and NDAs live here —
          each one keeps a timestamped record of who signed it and when.
        </p>
      ) : (
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/studio/client/contracts/${c.id}`}
                className="squircle group flex items-center gap-3 border border-border bg-card px-4 py-3 outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {STATUS_LABEL[c.status]} · created{' '}
                    {new Date(c.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </span>
                <ChevronRight
                  size={15}
                  className="shrink-0 text-faint transition-transform duration-[--dur-pop] group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
