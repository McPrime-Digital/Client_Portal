import { createClient } from
  '@/lib/supabase/server'
import { supabaseAdmin } from
  '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import ClientsTable from
  '@/components/admin/ClientsTable'

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()

  if (
    !user ||
    user.user_metadata?.role !== 'admin'
  ) {
    redirect('/login')
  }

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select(`
      id,
      name,
      email,
      company,
      phone,
      is_active,
      invited_at,
      onboarded_at,
      created_at,
      projects (
        id,
        title,
        status
      )
    `)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
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
