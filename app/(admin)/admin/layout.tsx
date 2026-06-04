import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopbar from '@/components/admin/AdminTopbar'
import PresencePulse from '@/components/shared/PresencePulse'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role = user.user_metadata?.role
  if (role !== 'admin') redirect('/dashboard')

  // Agency/company name shown beside the logo (top-left). Falls back to the
  // McPrime brand if business settings haven't been filled in.
  let companyName = 'McPrime Digital'
  try {
    const { data: biz } = await supabaseAdmin
      .from('business_settings')
      .select('business_name')
      .limit(1)
      .single()
    if (biz?.business_name) companyName = biz.business_name
  } catch {
    // best-effort
  }

  const adminName = user.user_metadata?.name ?? 'Admin'
  const adminRole = user.user_metadata?.title || 'Owner'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresencePulse role="admin" userId={user.id} clientId={null} />
      <AdminSidebar adminName={adminName} companyName={companyName} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopbar adminName={adminName} adminRole={adminRole} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
