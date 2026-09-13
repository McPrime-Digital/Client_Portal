import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileSignature, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import { listContracts, STATUS_LABEL } from '@/lib/contracts'

/**
 * Documents this company has been asked to sign.
 *
 * RLS decides what appears: `contracts_client_read` admits a contract addressed
 * to your company, on a production you can see, and NEVER a draft — a draft is
 * the studio's working copy and showing it would leak terms nobody has agreed
 * to send. That predicate lives in 0068/0073, not here.
 */
export default async function PortalContractsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await can(user, 'portal.view'))) redirect('/dashboard')

  const contracts = await listContracts(supabase, {})

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
        <FileSignature size={24} className="text-primary" />
        Documents to sign
      </h1>

      {contracts.length === 0 ? (
        <p className="squircle mt-6 border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Nothing to sign right now. Releases, agreements and statements of work
          appear here when they are sent to you.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/contracts/${c.id}`}
                className="squircle group flex items-center gap-3 border border-border bg-card px-4 py-3 outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{c.title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {STATUS_LABEL[c.status]}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-faint transition-transform duration-[--dur-pop] group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
