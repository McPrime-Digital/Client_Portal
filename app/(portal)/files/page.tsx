import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import AllFilesVault from '@/components/portal/AllFilesVault'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import StorageMeter from '@/components/shared/StorageMeter'

const GB = 1024 ** 3
// Soft storage quota guide (overridable via env).
const CLIENT_QUOTA = (Number(process.env.NEXT_PUBLIC_STORAGE_QUOTA_GB) || 25) * GB

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

  const all = files ?? []
  const r2Bytes = all.filter((f) => f.bucket === 'r2').reduce((a, f) => a + (f.file_size || 0), 0)
  const supabaseBytes = all.filter((f) => f.bucket !== 'r2').reduce((a, f) => a + (f.file_size || 0), 0)

  return (
    <>
      {/* Live: new task media / deliverables / uploads appear without a reload. */}
      <RealtimeRefresh tables={['files']} pollMs={15000} />
      <div className="mb-6">
        <StorageMeter
          r2Bytes={r2Bytes}
          supabaseBytes={supabaseBytes}
          fileCount={all.length}
          quotaBytes={CLIENT_QUOTA}
        />
      </div>
      <AllFilesVault files={all} projects={projects ?? []} />
    </>
  )
}
