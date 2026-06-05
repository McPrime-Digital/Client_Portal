import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminSettings from '@/components/admin/AdminSettings'

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  return <AdminSettings user={user} />
}
