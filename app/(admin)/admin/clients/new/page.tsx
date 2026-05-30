import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NewClientForm from
  '@/components/admin/NewClientForm'

export default async function NewClientPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  return <NewClientForm />
}
