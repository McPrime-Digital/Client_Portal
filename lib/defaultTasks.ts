import { SupabaseClient } from '@supabase/supabase-js'

// ── Default task processes, grouped per production phase ───────────────────
// Each project phase is broken into a step-by-step process. Critical steps
// are *approval gates* (`requires_approval`): the client must Approve or
// Request changes before the project advances. Clients see every visible
// step (read-only) and can only act on approval gates.

export type TaskTemplate = {
  title: string
  category: 'milestone' | 'deliverable' | 'revision' | 'approval' | 'task'
  priority: 'low' | 'medium' | 'high'
  requires_approval?: boolean
  visible_to_client?: boolean
  description?: string
}

// Canonical phase keys → the process for that phase.
const PROCESSES: Record<string, TaskTemplate[]> = {
  discovery: [
    { title: 'Kickoff call & creative brief', category: 'milestone', priority: 'high', visible_to_client: true,
      description: 'Align on vision, audience, timeline and success metrics.' },
    { title: 'Goals, references & assets gathered', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Collect brand assets, references and source material.' },
    { title: 'Creative direction & moodboard', category: 'approval', priority: 'high', requires_approval: true, visible_to_client: true,
      description: 'Approve the overall creative direction before we build.' },
  ],
  prepro: [
    { title: 'Script & narrative draft', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'First draft of the script and narrative structure.' },
    { title: 'Script approval', category: 'approval', priority: 'high', requires_approval: true, visible_to_client: true,
      description: 'Sign off on the script so production can begin.' },
    { title: 'Shot list, storyboard & schedule', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Storyboard, shot list and production schedule confirmed.' },
  ],
  g1: [
    { title: 'AI scene generation — first pass', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'Generate core scenes and candidate environments.' },
    { title: 'Environments & characters locked', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Finalize environment and character design language.' },
  ],
  g2: [
    { title: 'Cinematic composition & motion pass', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'Compose shots and add camera motion and pacing.' },
    { title: 'Visual style frames', category: 'approval', priority: 'high', requires_approval: true, visible_to_client: true,
      description: 'Approve the look & feel via representative style frames.' },
  ],
  post: [
    { title: 'Assembly / rough cut', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'First edit assembled for structure and pacing.' },
    { title: 'Rough cut review', category: 'approval', priority: 'high', requires_approval: true, visible_to_client: true,
      description: 'Review the rough cut and approve or request changes.' },
    { title: 'Sound design, VO & audio master', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Voiceover, music, sound design and audio mastering.' },
    { title: 'Color grade & visual polish', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Final color grading and visual finishing.' },
  ],
  revisions: [
    { title: 'Revision round 1', category: 'revision', priority: 'medium', visible_to_client: true,
      description: 'Incorporate consolidated client feedback.' },
    { title: 'Platform formatting & versions', category: 'task', priority: 'medium', visible_to_client: true,
      description: 'Export aspect ratios and versions for each platform.' },
    { title: 'Final cut approval', category: 'approval', priority: 'high', requires_approval: true, visible_to_client: true,
      description: 'Approve the final cut for delivery.' },
  ],
  delivery: [
    { title: 'Master files & exports prepared', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'Masters and web exports rendered to spec.' },
    { title: 'Deliverables uploaded to vault', category: 'deliverable', priority: 'high', visible_to_client: true,
      description: 'All final files delivered to your File Vault.' },
    { title: 'Project wrap & invoice settled', category: 'milestone', priority: 'high', visible_to_client: false,
      description: 'Final payment received. Internal tracking only.' },
  ],
}

// Map a (possibly custom) phase name to a canonical process key.
function phaseKey(name: string): keyof typeof PROCESSES | null {
  const n = name.toLowerCase()
  if (n.includes('discovery') || n.includes('brief')) return 'discovery'
  if (n.includes('pre')) return 'prepro'
  if (n.includes('g1') || n.includes('generation 1')) return 'g1'
  if (n.includes('g2') || n.includes('generation 2')) return 'g2'
  if (n.includes('post')) return 'post'
  if (n.includes('revis')) return 'revisions'
  if (n.includes('final') || n.includes('deliver')) return 'delivery'
  return null
}

// Flat list (legacy/back-compat) used when no phases exist to attach to.
export const DEFAULT_TASKS = Object.values(PROCESSES).flat()

type SeedPhase = { id: string; name: string; sort_order?: number | null }

// Seed a new project's tasks. When `phases` are supplied, tasks are attached
// to their phase (phase_id) following each phase's process; otherwise a flat
// checklist is seeded as a fallback.
export async function seedDefaultTasks(
  supabase: SupabaseClient,
  projectId: string,
  phases?: SeedPhase[]
) {
  let rows: any[] = []

  if (phases && phases.length > 0) {
    const ordered = [...phases].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )
    let sort = 0
    for (const phase of ordered) {
      const key = phaseKey(phase.name)
      const templates: TaskTemplate[] = key
        ? PROCESSES[key]
        : [{
            title: `${phase.name} — in progress`,
            category: 'task',
            priority: 'medium',
            visible_to_client: true,
            description: `Work for the ${phase.name} phase.`,
          }]
      for (const t of templates) {
        rows.push({
          project_id: projectId,
          phase_id: phase.id,
          title: t.title,
          category: t.category,
          priority: t.priority,
          visible_to_client: t.visible_to_client ?? true,
          description: t.description ?? null,
          requires_approval: t.requires_approval ?? false,
          approval_status: t.requires_approval ? 'pending' : null,
          status: 'pending',
          sort_order: sort++,
        })
      }
    }
  } else {
    rows = DEFAULT_TASKS.map((t, i) => ({
      project_id: projectId,
      title: t.title,
      category: t.category,
      priority: t.priority,
      visible_to_client: t.visible_to_client ?? true,
      description: t.description ?? null,
      requires_approval: t.requires_approval ?? false,
      approval_status: t.requires_approval ? 'pending' : null,
      status: 'pending',
      sort_order: i,
    }))
  }

  const { error } = await supabase.from('tasks').insert(rows)
  return error
}
