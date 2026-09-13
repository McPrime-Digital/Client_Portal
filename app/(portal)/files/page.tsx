import { can } from '@/lib/capabilities.server'
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
          {/* No client row means no organization, so there is genuinely no
              tenant to name here. The name is dropped rather than defaulted:
              printing one studio's name to another studio's client is the
              P-1 defect, and a stand-in reads worse than the sentence without
              it (S0-B §2). */}
        <p className="text-sm text-muted-foreground">
          Your account is being set up. Please contact your studio.
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
  // Resolved, not derived: `can()` subtracts DENIALS, which the deleted
  // clientCan() could not see.
  //
  // AND IT IS NO LONGER SKIPPED. This read `if (access && !(await can(…)))` —
  // so a session with NO active client_members row bypassed the guard entirely
  // and reached the page. It saw nothing (portalClientId returns the NO_CLIENT
  // sentinel, which matches no rows), so nothing leaked; but "we never asked"
  // is not the same as "we asked and the answer was no", and only one of those
  // is a guard.
  //
  // `can()` already answers false for that session — resolveCaps returns
  // `side: null` with an empty cap set when no active roster row exists on
  // either side — so the precondition was doing nothing except suppressing the
  // right answer. Two live identities are affected and both are documented
  // orphans that already resolve to nothing: the MD-4 external collaborator
  // (roster-less by design) and the `.con` typo'd address in HANDOFF §8.3
  // item 19. They now land on /dashboard, which carries no capability gate, so
  // there is no redirect loop.
  if (!(await can(user, 'portal.upload'))) redirect('/dashboard')
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
      <RealtimeRefresh tables={['files']} pollMs={300_000} />
      <AllFilesVault files={files ?? []} projects={projects ?? []} />
    </>
  )
}
