import { clientCan } from '@/lib/permissions'
import { portalClientId, portalAccess } from '@/lib/team'
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
    .eq('id', await portalClientId(user))
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

  const [{ data: allFiles }, { data: allProjects }] = await Promise.all([
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

  // Member scoping — restricted members see only their listed projects' files
  // (company-level files with no project stay visible). Viewers don't get the
  // vault at all — project pages carry what they may see.
  const access = await portalAccess(user)
  if (access && !clientCan(access.role, 'upload')) redirect('/dashboard')
  const projects = (allProjects ?? []).filter(
    (p) => !access?.projectIds || access.projectIds.includes(p.id)
  )
  const files = (allFiles ?? []).filter(
    (f) => !access?.projectIds || !f.project_id || access.projectIds.includes(f.project_id)
  )

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
