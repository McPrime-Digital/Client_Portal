export const DEFAULT_TASKS = [
  {
    title: 'Project kickoff call',
    category: 'milestone',
    priority: 'high',
    sort_order: 0,
    visible_to_client: true,
    description:
      'Initial call to align on vision, timeline, and deliverables.',
  },
  {
    title: 'Pre-production planning',
    category: 'milestone',
    priority: 'high',
    sort_order: 1,
    visible_to_client: true,
    description:
      'Script, shot list, locations, and scheduling confirmed.',
  },
  {
    title: 'Production / shoot days',
    category: 'deliverable',
    priority: 'high',
    sort_order: 2,
    visible_to_client: true,
    description:
      'All principal photography and b-roll capture completed.',
  },
  {
    title: 'Rough cut delivered',
    category: 'deliverable',
    priority: 'medium',
    sort_order: 3,
    visible_to_client: true,
    description:
      'First edit for structure and pacing review.',
  },
  {
    title: 'Client revision round 1',
    category: 'revision',
    priority: 'medium',
    sort_order: 4,
    visible_to_client: true,
    description:
      'Client feedback collected and incorporated.',
  },
  {
    title: 'Color grade + sound mix',
    category: 'deliverable',
    priority: 'medium',
    sort_order: 5,
    visible_to_client: true,
    description:
      'Final color grading and audio mixing completed.',
  },
  {
    title: 'Client final approval',
    category: 'approval',
    priority: 'high',
    sort_order: 6,
    visible_to_client: true,
    description:
      'Client signs off on the final cut.',
  },
  {
    title: 'Final files delivered',
    category: 'deliverable',
    priority: 'high',
    sort_order: 7,
    visible_to_client: true,
    description:
      'Master files, web exports, and all deliverables uploaded.',
  },
  {
    title: 'Invoice settled',
    category: 'milestone',
    priority: 'high',
    sort_order: 8,
    visible_to_client: false,
    description:
      'Final payment received. Internal tracking only.',
  },
]

import { SupabaseClient } from '@supabase/supabase-js'

// Call this after creating a new project
export async function seedDefaultTasks(
  supabase: SupabaseClient,
  projectId: string
) {
  const tasks = DEFAULT_TASKS.map((t) => ({
    ...t,
    project_id: projectId,
    status: 'pending',
  }))

  const { error } = await supabase
    .from('tasks')
    .insert(tasks)

  return error
}
