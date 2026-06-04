import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import AllFilesVault from '@/components/portal/AllFilesVault'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function FilesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve the caller's client record, then pull every file across
  // all of their projects (the "synced" vault).
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <AlertCircle size={40} className="text-faint" />
        <p className="text-sm text-muted-foreground">
          Your account is being set up. Please contact McPrime Digital.
        </p>
      </div>
    )
  }

  const [{ data: files }, { data: projects }] = await Promise.all([
    supabaseAdmin
      .from('files')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('projects')
      .select('id, title')
      .eq('client_id', client.id),
  ])

  // NOTE: storage usage is intentionally NOT shown to clients — only the admin
  // File Vault surfaces the storage meter.
  return (
    <>
      {/* Live: new task media / deliverables / uploads appear without a reload. */}
      <RealtimeRefresh tables={['files']} pollMs={15000} />
      <AllFilesVault files={files ?? []} projects={projects ?? []} />
    </>
  )
}
