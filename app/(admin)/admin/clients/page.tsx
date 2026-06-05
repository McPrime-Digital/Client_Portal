import { isAdmin } from '@/lib/auth/role'
import { createClient } from
  '@/lib/supabase/server'
import { supabaseAdmin } from
  '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import ClientsTable from
  '@/components/admin/ClientsTable'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()

  if (
    !user ||
    !isAdmin(user)
  ) {
    redirect('/login')
  }

  const { data: clients } = await supabaseAdmin
    .from('clients')
    // Select * (not an explicit column list) so a not-yet-migrated
    // column like invite_count can't blank the whole clients list.
    .select(`
      *,
      projects (
        id,
        title,
        status
      )
    `)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <RealtimeRefresh tables={['clients', 'projects']} pollMs={45000} />
      <div className="flex items-center
        justify-between">
        <div>
          <h1
            className="font-display text-2xl
            font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Clients
          </h1>
          <p className="text-sm mt-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {clients?.length ?? 0} total clients
          </p>
        </div>
        <a
          href="/admin/clients/new"
          className="flex items-center gap-2
          px-4 py-2.5 rounded-lg text-sm
          font-semibold transition-all"
          style={{
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          + Invite Client
        </a>
      </div>

      <ClientsTable
        clients={clients ?? []}
      />
    </div>
  )
}
