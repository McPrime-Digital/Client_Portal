import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { portalAccess } from '@/lib/team'
import { clientCanApproval } from '@/lib/permissions'
import { readApproval } from '@/lib/approvals'
import { tenantBrandForClient } from '@/lib/tenantBrand'
import ApprovalCertificate from '@/components/shared/ApprovalCertificate'

/**
 * The printable record of a decision — Batch 22 item 10 (S-F §3.3, S3-c §2.3).
 *
 * SCOPE: an HTML print view, not a PDF pipeline. PDF generation is a
 * files-and-queue question (I-4 — there is no queue) and is not in this batch.
 * The browser's own "Print to PDF" is the export path, which is also why the
 * page carries print styles rather than a download button.
 *
 * Server-rendered, and deliberately so: the certificate is the artifact
 * somebody attaches to a dispute, so what it says must come from the database
 * on the request that renders it — not from a client cache that could be
 * showing yesterday's state.
 */
export default async function PortalCertificatePage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const access = await portalAccess(user)
  if (!access) redirect('/dashboard')
  if (!clientCanApproval(access.role, 'decide', access.extraCaps)) redirect('/dashboard')

  // RLS is the filter: an approval outside this company — or an INTERNAL one —
  // simply is not returned (0038), so there is no branch here that could get
  // the check wrong.
  const detail = await readApproval(supabase, id)
  if (!detail) redirect('/approvals')

  // The certificate wears the STUDIO's brand, not the product's (S0-B §2): a
  // client of a studio bought from that studio.
  const brand = await tenantBrandForClient(detail.approval.client_id)

  return <ApprovalCertificate detail={detail} studioName={brand.name} logoUrl={brand.logoUrl} />
}
