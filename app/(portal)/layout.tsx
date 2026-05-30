import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // 1. Get current session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  // 2. Redirect to login if unauthenticated
  if (sessionError || !session?.user) {
    redirect('/login')
  }

  // 3. Fetch the client record associated with this user
  const { data: clientData, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('user_id', session.user.id)
    .single()

  if (clientError && clientError.code !== 'PGRST116') {
    // If it's a real error (not just "row not found"), we log it
    console.error('Error fetching client data:', clientError.message)
  }

  // Note: if clientData is null, it might be an admin testing the portal 
  // or a newly created user that doesn't have a clients record yet.
  const fallbackClient = {
    name: session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'User',
    company: null,
    avatar_url: null,
  }

  const activeClient = clientData || fallbackClient

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        clientName={activeClient.name}
        clientCompany={(activeClient as any).company ?? null}
        clientId={(activeClient as any).id}
        clientAvatar={(activeClient as any).avatar_url ?? null}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar clientName={activeClient.name} clientId={(activeClient as any).id} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
