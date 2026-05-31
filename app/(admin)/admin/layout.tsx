import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopbar from '@/components/admin/AdminTopbar'

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar adminName={user.user_metadata?.name ?? 'Admin'} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminTopbar adminName={user.user_metadata?.name ?? 'Admin'} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
