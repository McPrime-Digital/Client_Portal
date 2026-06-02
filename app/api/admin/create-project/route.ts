import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { seedDefaultTasks } from '@/lib/defaultTasks'

const DEFAULT_PHASES = [
  { name: 'Discovery & Brief', description: 'Concept development and narrative architecture', sort_order: 0 },
  { name: 'Pre-Production', description: 'Script design and creative alignment with brand', sort_order: 1 },
  { name: 'Production G1', description: 'AI-powered scene generation and environment design', sort_order: 2 },
  { name: 'Production G2', description: 'Cinematic visual composition and motion design', sort_order: 3 },
  { name: 'Post-Production', description: 'Visual refinement, editing, sound design, voiceover, and audio mastering', sort_order: 4 },
  { name: 'Revisions', description: 'Commercial campaign formatting for distribution platforms', sort_order: 5 },
  { name: 'Final Delivery', description: 'Final masters delivered across agreed formats', sort_order: 6 },
]

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      client_id,
      title,
      type,
      status,
      progress,
      brief,
      kickoff_date,
      due_date,
      stripe_payment_url,
      invoice_amount,
      image_url,
      phases,
      tasks,
    } = body

    if (!client_id || !title) {
      return NextResponse.json(
        { error: 'client_id and title are required' },
        { status: 400 }
      )
    }

    // 1. Create the project using service_role (bypasses RLS)
    const { data: project, error: projectError } =
      await supabaseAdmin
        .from('projects')
        .insert({
          client_id,
          title: title.trim(),
          type: type ?? 'Other',
          status: status ?? 'Onboarding',
          progress: Number(progress) || 0,
          brief: brief || null,
          kickoff_date: kickoff_date || null,
          due_date: due_date || null,
          stripe_payment_url: stripe_payment_url || null,
          invoice_amount: invoice_amount ?? null,
        })
        .select()
        .single()

    if (projectError || !project) {
      console.error('[create-project] Project insert error:', projectError)
      return NextResponse.json(
        { error: 'Failed to create project: ' + (projectError?.message ?? 'Unknown error') },
        { status: 500 }
      )
    }

    // Set the project image as a best-effort update so creation never fails if
    // the image_url column hasn't been migrated yet (run phase9 to enable it).
    if (image_url) {
      const { error: imgError } = await supabaseAdmin
        .from('projects')
        .update({ image_url })
        .eq('id', project.id)
      if (imgError) console.error('[create-project] image_url update skipped:', imgError.message)
      else (project as any).image_url = image_url
    }

    // 2. Create project phases
    const phasesToInsert = phases && Array.isArray(phases) && phases.length > 0
      ? phases.map((p: any, i: number) => ({
          project_id: project.id,
          name: p.name,
          description: p.description ?? null,
          sort_order: i,
          progress: 0,
          is_complete: false,
        }))
      : DEFAULT_PHASES.map((phase) => ({
          project_id: project.id,
          name: phase.name,
          description: phase.description,
          sort_order: phase.sort_order,
          progress: 0,
          is_complete: false,
        }))

    const { data: insertedPhases, error: phasesError } = await supabaseAdmin
      .from('project_phases')
      .insert(phasesToInsert)
      .select('id, name, sort_order')

    if (phasesError) {
      console.error('[create-project] Phases insert error:', phasesError)
    }

    // 3. Create tasks. ALWAYS seed the per-phase production process (with
    //    client approval gates), attaching each step to its phase — so the
    //    full process is never lost. THEN append any admin-entered deliverables
    //    as their own visible tasks, so nothing the admin typed is dropped.
    const seedError = await seedDefaultTasks(
      supabaseAdmin,
      project.id,
      insertedPhases ?? undefined
    )
    if (seedError) {
      console.error('[create-project] Default tasks seed error:', seedError)
    }

    const deliverables = Array.isArray(tasks)
      ? (tasks as string[]).map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
      : []
    if (deliverables.length > 0) {
      // Continue the sort sequence after the seeded process tasks.
      const { count: seededCount } = await supabaseAdmin
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
      const base = seededCount ?? 0
      const { error: tasksError } = await supabaseAdmin
        .from('tasks')
        .insert(
          deliverables.map((title, i) => ({
            project_id: project.id,
            title,
            status: 'pending',
            sort_order: base + i,
            category: 'deliverable',
            priority: 'medium',
            visible_to_client: true,
            requires_approval: false,
          }))
        )
      if (tasksError) {
        console.error('[create-project] Deliverables insert error:', tasksError)
      }
    }

    // 4. Create invoice if amount provided
    if (invoice_amount && Number(invoice_amount) > 0) {
      const { error: invoiceError } = await supabaseAdmin
        .from('invoices')
        .insert({
          project_id: project.id,
          client_id,
          title: `${title.trim()} — Project Fee`,
          amount: Number(invoice_amount),
          status: 'unpaid',
          stripe_payment_url: stripe_payment_url || null,
        })

      if (invoiceError) {
        console.error('[create-project] Invoice insert error:', invoiceError)
      }
    }

    return NextResponse.json({
      success: true,
      project,
    })
  } catch (error: any) {
    console.error('[create-project] Server error:', error)
    return NextResponse.json(
      { error: 'Internal server error: ' + (error?.message ?? '') },
      { status: 500 }
    )
  }
}
