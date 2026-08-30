import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopbar from '@/components/admin/AdminTopbar'
import PresencePulse from '@/components/shared/PresencePulse'
import { tenantBrand } from '@/lib/tenantBrand'
import { userRole, userOrgId } from '@/lib/auth/role'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role = userRole(user)
  if (role !== 'admin') redirect('/dashboard')

  // The studio's own name and logo beside the product wordmark (S0-B §3).
  // The fallback was the literal 'McPrime Digital', so an unfilled
  // business_settings row put one studio's name in every studio's chrome.
  const brand = await tenantBrand(userOrgId(user))

  const adminName = user.user_metadata?.name ?? 'Admin'
  const adminRole = user.user_metadata?.title || 'Owner'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Unreachable in practice — the proxy redirects every /admin URL to
          /studio — but it still compiles, so it carries the tenant scope too. */}
      <PresencePulse role="admin" userId={user.id} clientId={null} orgId={userOrgId(user)} />
      <AdminSidebar adminName={adminName} companyName={brand.name} companyLogoUrl={brand.logoUrl} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopbar adminName={adminName} adminRole={adminRole} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
