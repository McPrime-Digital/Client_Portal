import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NewClientForm from
  '@/components/admin/NewClientForm'

export default async function NewClientPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  return <NewClientForm />
}
