import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminSettings from '@/components/admin/AdminSettings'
import { tenantBrand } from '@/lib/tenantBrand'
import { userOrgId } from '@/lib/auth/role'

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // This studio's own brand — the logo field needs its current value, and the
  // initial fallback needs its name (S-C §6).
  const brand = await tenantBrand(userOrgId(user))

  return <AdminSettings user={user} studioName={brand.name} studioLogoUrl={brand.logoUrl} />
}
