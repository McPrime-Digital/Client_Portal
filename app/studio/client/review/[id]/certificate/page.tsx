import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { readApproval } from '@/lib/approvals'
import { tenantBrand } from '@/lib/tenantBrand'
import ApprovalCertificate from '@/components/shared/ApprovalCertificate'

/**
 * The studio's copy of the certificate — Batch 22 item 10.
 *
 * Same component, same sentence, same record. Two routes rather than one with
 * a role flag, because the two sides have different gates: the portal checks
 * the client capability matrix, this checks the studio feature gate and the
 * crew roster. A single route branching on role is how one of those checks
 * eventually goes missing.
 *
 * It carries the STUDIO's brand here too — the studio printing its own record
 * of what its client agreed to.
 */
export default async function StudioCertificatePage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requireOrgFeature('client', 'review')
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  // RLS does the scoping (0038 approvals_crew_read: org match, membership and
  // project scope), so a foreign approval is absent rather than forbidden.
  const detail = await readApproval(supabase, id)
  if (!detail) redirect('/studio/client/review')

  const brand = await tenantBrand(userOrgId(user))
  return <ApprovalCertificate detail={detail} studioName={brand.name} logoUrl={brand.logoUrl} />
}
