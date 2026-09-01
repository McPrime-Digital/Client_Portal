import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminSettings from '@/components/admin/AdminSettings'
import { tenantBrand } from '@/lib/tenantBrand'
import { userOrgId } from '@/lib/auth/role'
import { orgRolesOf } from '@/lib/team'
import { planAllows } from '@/lib/billing/plans'

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // This studio's own brand — the logo field needs its current value, and the
  // initial fallback needs its name (S-C §6).
  const brand = await tenantBrand(userOrgId(user))

  // Data & Privacy (erasure) shows only for an OWNER on the platform
  // operator's plan — the plan decides, never the org id (lib/billing/plans.ts);
  // /api/admin/erase-person re-checks both gates server-side.
  const roles = await orgRolesOf(user)
  const canErase = roles.includes('owner') && planAllows(brand.plan, 'platform.erasure')

  return <AdminSettings user={user} studioName={brand.name} studioLogoUrl={brand.logoUrl} canErase={canErase} />
}
