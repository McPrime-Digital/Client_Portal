import { isAdmin } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { computeProjectProgress, deriveProjectStatus } from '@/lib/projectProgress'
import { createNotification, clientIdForProject, pushMessageAlert } from '@/lib/notify'
import { messagePreview } from '@/lib/messagePreview'
import { recordActivity } from '@/lib/logActivity'
import { seedDefaultTasks, buildPhaseTaskRows, safeCategory } from '@/lib/defaultTasks'

// Records an approval-gate send into the Approvals & Records ledger when a
// visible approval gate enters review (first send OR a resend for re-approval).
async function recordGateSent(task: { id: string; title: string; project_id: string; visible_to_client?: boolean; requires_approval?: boolean; category?: string }, actorId: string, resend = false) {
  const isGate = task.requires_approval || task.category === 'approval'
  if (!isGate || task.visible_to_client === false) return
  await recordActivity({
    projectId: task.project_id, clientId: await clientIdForProject(task.project_id),
    actorId, actorName: 'McPrime Digital', actorRole: 'admin',
    eventType: 'approval_requested',
    title: `${resend ? 'Re-sent for approval' : 'Approval requested'}: “${task.title}”`,
    body: null,
    meta: { task_id: task.id, resend },
  })
}

// Verify the calling user is an admin
async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return null
  }
  return user
}

// Recompute a project's overall progress AND live status from its phases, and
// persist both to the projects row so the pipeline/overview/badges stay live.
// Returns the new { progress, status } (status null when unchanged/no phases).
async function syncProjectFromPhases(projectId: string): Promise<{ progress: number; status: string | null }> {
  const { data: phases } = await supabaseAdmin
    .from('project_phases')
    .select('name, progress, is_complete, sort_order')
    .eq('project_id', projectId)
  const progress = computeProjectProgress(phases, 0)

  const { data: proj } = await supabaseAdmin
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .single()

  const nextStatus = deriveProjectStatus(phases ?? [], proj?.status)
  const statusChanged = !!proj && nextStatus !== proj.status

  await supabaseAdmin
    .from('projects')
    .update({ progress, updated_at: new Date().toISOString(), ...(statusChanged ? { status: nextStatus } : {}) })
    .eq('id', projectId)

  if (statusChanged) {
    await createNotification({
      clientId: await clientIdForProject(projectId),
      projectId,
      type: 'status_change',
      title: `Project status updated: ${nextStatus}`,
      body: null,
    })
  }
  return { progress, status: statusChanged ? nextStatus : null }
}

export async function POST(req: NextRequest) {
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { action } = body

  try {
    switch (action) {

      // ── Update project settings ──────────────────────────
      case 'update_project': {
        const { project_id, updates } = body
        const { data, error } = await supabaseAdmin
          .from('projects')
          .update(updates)
          .eq('id', project_id)
          .select()
          .single()
        if (error) throw error
        if (updates && updates.status) {
          await createNotification({
            clientId: data.client_id,
            projectId: project_id,
            type: 'status_change',
            title: `Project status updated: ${updates.status}`,
            body: data.title ?? null,
          })
        }
        return NextResponse.json({ project: data })
      }

      // ── Send a message ──────────────────────────────────
      case 'send_message': {
        const {
          project_id,
          body: msgBody,
          attachment_url,
          attachment_name,
          reply_to_id,
        } = body
        const { data, error } = await supabaseAdmin
          .from('messages')
          .insert({
            project_id,
            sender_id: user.id,
            sender_role: 'admin',
            sender_name: 'McPrime Digital',
            body: msgBody,
            attachment_url: attachment_url || null,
            attachment_name: attachment_name || null,
            reply_to_id: reply_to_id || null,
          })
          .select()
          .single()
        if (error) throw error
        // No in-app bell entry for plain chat (the Messages badge carries
        // unread). But push the client's device instantly IF they're away —
        // an active, in-app client is left alone (they see it live). Email/SMS
        // stay on the 5h nudge cron so a live thread never spams them.
        await pushMessageAlert({
          recipient: 'client',
          projectId: project_id,
          senderName: 'McPrime Digital',
          preview: messagePreview({ body: msgBody, attachment_name }),
        })
        return NextResponse.json({ message: data })
      }

      // ── Register uploaded file ──────────────────────────
      case 'insert_file': {
        const { project_id, client_id, file_name, file_path,
                file_size, file_type, direction, bucket } = body
        const { data, error } = await supabaseAdmin
          .from('files')
          .insert({
            project_id,
            client_id,
            file_name,
            file_path,
            file_size,
            file_type,
            direction,
            bucket,
            uploaded_by: user.id,
          })
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ file: data })
      }

      // ── Delete file record ──────────────────────────────
      case 'delete_file': {
        const { file_id } = body
        const { error } = await supabaseAdmin
          .from('files')
          .delete()
          .eq('id', file_id)
        if (error) throw error
        return NextResponse.json({ success: true })
      }

      // ── Update phase progress ───────────────────────────
      case 'update_phase': {
        const { phase_id, progress } = body
        const isComplete = progress === 100
        const { data, error } = await supabaseAdmin
          .from('project_phases')
          .update({ progress, is_complete: isComplete })
          .eq('id', phase_id)
          .select()
          .single()
        if (error) throw error

        // Keep projects.progress (what every list/overview reads) AND the live
        // pipeline status in sync with this project's phases, so the number and
        // the status badge are identical across admin, client, detail + overview.
        let overall: number | null = null
        let status: string | null = null
        if (data?.project_id) {
          const synced = await syncProjectFromPhases(data.project_id)
          overall = synced.progress
          status = synced.status
        }

        return NextResponse.json({ phase: data, overall, status })
      }

      // ── Add a production phase ──────────────────────────
      case 'add_phase': {
        const { project_id, name, description } = body
        const { data: maxRow } = await supabaseAdmin
          .from('project_phases')
          .select('sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: false })
          .limit(1)
          .maybeSingle()
        const sort_order = ((maxRow?.sort_order ?? -1) as number) + 1
        const { data, error } = await supabaseAdmin
          .from('project_phases')
          .insert({ project_id, name, description: description || null, sort_order, progress: 0, is_complete: false })
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ phase: data })
      }

      // ── Rename / edit a phase ───────────────────────────
      case 'rename_phase': {
        const { phase_id, name, description } = body
        const { data, error } = await supabaseAdmin
          .from('project_phases')
          .update({ name, description: description ?? null })
          .eq('id', phase_id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ phase: data })
      }

      // ── Delete a phase (then recompute project progress) ─
      case 'delete_phase': {
        const { phase_id } = body
        const { data: ph } = await supabaseAdmin
          .from('project_phases').select('project_id').eq('id', phase_id).single()
        const { error } = await supabaseAdmin
          .from('project_phases').delete().eq('id', phase_id)
        if (error) throw error
        let status: string | null = null
        if (ph?.project_id) {
          status = (await syncProjectFromPhases(ph.project_id)).status
        }
        return NextResponse.json({ success: true, status })
      }

      // ── Generate the per-phase production process into an EXISTING ──
      //    project. The trigger is always available to the admin; how a
      //    re-trigger reconciles with an existing process is controlled by
      //    `mode`:
      //      • fill    (default) — only populate phases that have no tasks yet.
      //      • merge   — keep everything, add only process steps that are
      //                  missing (matched by title within each phase).
      //      • replace — discard the current phase-attached process and
      //                  regenerate it fresh. Unphased custom deliverables and
      //                  manually-added tasks (phase_id = null) are preserved.
      case 'seed_phase_tasks': {
        const { project_id, mode = 'fill' } = body
        const { data: phases } = await supabaseAdmin
          .from('project_phases')
          .select('id, name, sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: true })
        if (!phases || phases.length === 0) {
          return NextResponse.json(
            { error: 'Add production phases first, then generate the process.' },
            { status: 400 }
          )
        }

        const { data: existing } = await supabaseAdmin
          .from('tasks').select('id, phase_id, title, sort_order').eq('project_id', project_id)
        const rows = existing ?? []
        let seeded = 0

        if (mode === 'replace') {
          // Remove every phase-attached task, then regenerate the full process.
          const phaseIds = phases.map((p) => p.id)
          await supabaseAdmin
            .from('tasks').delete().eq('project_id', project_id).in('phase_id', phaseIds)
          const fresh = buildPhaseTaskRows(project_id, phases)
          if (fresh.length > 0) {
            const { error } = await supabaseAdmin.from('tasks').insert(fresh)
            if (error) throw error
          }
          seeded = fresh.length
        } else if (mode === 'merge') {
          // Add only steps that don't already exist in each phase (by title).
          const titlesByPhase = new Map<string, Set<string>>()
          for (const t of rows) {
            if (!t.phase_id) continue
            const set = titlesByPhase.get(t.phase_id) ?? new Set<string>()
            set.add((t.title ?? '').trim().toLowerCase())
            titlesByPhase.set(t.phase_id, set)
          }
          const maxSort = rows.reduce((m, t) => Math.max(m, t.sort_order ?? 0), -1)
          const fresh = buildPhaseTaskRows(project_id, phases, {
            startSort: maxSort + 1,
            skip: (phaseId, title) => titlesByPhase.get(phaseId)?.has(title.trim().toLowerCase()) ?? false,
          })
          if (fresh.length > 0) {
            const { error } = await supabaseAdmin.from('tasks').insert(fresh)
            if (error) throw error
          }
          seeded = fresh.length
        } else {
          // fill — only phases with no tasks yet.
          const populated = new Set(rows.map((t) => t.phase_id).filter(Boolean))
          const emptyPhases = phases.filter((p) => !populated.has(p.id))
          if (emptyPhases.length > 0) {
            const seedErr = await seedDefaultTasks(supabaseAdmin, project_id, emptyPhases)
            if (seedErr) throw seedErr
            seeded = emptyPhases.length
          }
        }

        const { data: tasks } = await supabaseAdmin
          .from('tasks').select('*').eq('project_id', project_id)
          .order('sort_order', { ascending: true })
        return NextResponse.json({ seeded, mode, tasks: tasks ?? [] })
      }

      // ── Add task ────────────────────────────────────────
      case 'add_task': {
        const {
          project_id, title, sort_order,
          priority, category, due_date, description, visible_to_client,
          requires_approval, phase_id,
        } = body
        // New tasks default to INTERNAL (admin-only) — the admin reveals them
        // to the client manually. Only an explicit `true` makes one visible.
        const isVisible = visible_to_client === true
        const isGate = requires_approval ?? false
        // A visible approval gate is immediately the client's to act on — start
        // it in 'review' (stamped) so Approve / Request changes show at once.
        const initialStatus = isGate && isVisible ? 'review' : 'pending'
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .insert({
            project_id,
            title,
            status: initialStatus,
            sort_order: sort_order ?? 0,
            priority: priority ?? 'medium',
            category: isGate ? 'approval' : safeCategory(category),
            due_date: due_date || null,
            description: description || null,
            visible_to_client: isVisible,
            requires_approval: isGate,
            approval_status: isGate ? 'pending' : null,
            phase_id: phase_id || null,
          })
          .select()
          .single()
        if (error) throw error
        // Stamp the review window (phase4 column) — best effort so task
        // creation still works if the migration hasn't been applied.
        if (initialStatus === 'review') {
          try {
            await supabaseAdmin.from('tasks')
              .update({ review_requested_at: new Date().toISOString() })
              .eq('id', data.id)
          } catch { /* column may not exist yet */ }
        }
        if (data?.visible_to_client !== false) {
          await createNotification({
            clientId: await clientIdForProject(project_id),
            projectId: project_id,
            type: 'task_updated',
            title: isGate ? 'A task needs your approval' : 'A new task was added to your project',
            body: title ?? null,
          })
          // A visible gate created directly in review is an approval send.
          if (initialStatus === 'review') await recordGateSent(data, user.id, false)
        }
        return NextResponse.json({ task: data })
      }

      // ── Toggle task ─────────────────────────────────────
      case 'toggle_task': {
        const { task_id, status } = body
        const completed_at = status === 'completed' ? new Date().toISOString() : null
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ status, completed_at })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error
        // When an item moves into review we stamp when the client's review was
        // requested (phase4 column) so the auto-proceed window starts here.
        if (status === 'review') {
          try {
            await supabaseAdmin.from('tasks')
              .update({ review_requested_at: new Date().toISOString() })
              .eq('id', task_id)
          } catch { /* column may not exist yet */ }
        }
        // Notify the client when a task they can see needs review/approval or
        // is completed.
        if (data?.visible_to_client !== false) {
          if (status === 'review') {
            const isGate = data.requires_approval || data.category === 'approval'
            await createNotification({
              clientId: await clientIdForProject(data.project_id),
              projectId: data.project_id,
              type: 'task_updated',
              title: isGate ? 'A task needs your approval' : 'A task is ready for review',
              body: data.title ?? null,
            })
            // Record the gate send (resend if it was previously changed).
            await recordGateSent(data, user.id, data.approval_status === 'changes_requested')
          } else if (status === 'completed') {
            await createNotification({
              clientId: await clientIdForProject(data.project_id),
              projectId: data.project_id,
              type: 'task_updated',
              title: 'A task was completed',
              body: data.title ?? null,
            })
          }
        }
        return NextResponse.json({ task: data })
      }

      // ── Update task metadata (admin inline controls) ────
      //    Visibility, approval gate, priority, phase, title, description,
      //    due date. Status transitions go through `toggle_task` so their
      //    side-effects (review stamping, notifications) stay in one place.
      case 'update_task': {
        const { task_id, updates } = body
        const u = (updates ?? {}) as Record<string, unknown>
        const patch: Record<string, unknown> = {}

        for (const k of ['title', 'description', 'priority', 'visible_to_client'] as const) {
          if (k in u) patch[k] = u[k]
        }
        if ('due_date' in u) patch.due_date = u.due_date || null
        if ('phase_id' in u) patch.phase_id = u.phase_id || null

        // Approval-gate toggle drives category + approval_status together.
        let enablingGate = false
        if ('requires_approval' in u) {
          const gate = !!u.requires_approval
          enablingGate = gate
          patch.requires_approval = gate
          patch.category = gate ? 'approval' : safeCategory((u.category as string) ?? 'deliverable')
          patch.approval_status = gate ? 'pending' : null
        } else if ('category' in u) {
          patch.category = safeCategory(u.category as string)
        }

        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update(patch)
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error

        // Turning on a gate makes the deliverable immediately the client's to
        // act on — move an unfinished, visible task into review (stamped) and
        // notify, mirroring add_task.
        let movedToReview = false
        if (enablingGate && data.visible_to_client && data.status !== 'completed' && data.status !== 'review') {
          const { data: reviewed } = await supabaseAdmin
            .from('tasks')
            .update({ status: 'review' })
            .eq('id', task_id)
            .select()
            .single()
          if (reviewed) { data.status = reviewed.status; movedToReview = true }
          try {
            await supabaseAdmin.from('tasks')
              .update({ review_requested_at: new Date().toISOString() })
              .eq('id', task_id)
          } catch { /* phase4 column may not exist yet */ }
        }
        if (movedToReview) {
          await createNotification({
            clientId: await clientIdForProject(data.project_id),
            projectId: data.project_id,
            type: 'task_updated',
            title: 'A task needs your approval',
            body: data.title ?? null,
          })
          await recordGateSent(data, user.id, data.approval_status === 'changes_requested')
        }
        return NextResponse.json({ task: data })
      }

      // ── Resend an approval gate for re-approval (after changes requested) ─
      //    Re-opens the gate: status → review, approval reset to pending so the
      //    client gets a fresh approve/request-changes prompt. Records the send.
      case 'resend_approval': {
        const { task_id } = body
        const now = new Date().toISOString()
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ status: 'review', approval_status: 'pending', completed_at: null })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error
        try {
          await supabaseAdmin.from('tasks')
            .update({ review_requested_at: now }).eq('id', task_id)
        } catch { /* phase4 column may not exist yet */ }
        if (data?.visible_to_client !== false) {
          await createNotification({
            clientId: await clientIdForProject(data.project_id),
            projectId: data.project_id,
            type: 'task_updated',
            title: 'A task needs your approval again',
            body: data.title ?? null,
          })
        }
        await recordGateSent(data, user.id, true)
        return NextResponse.json({ task: data })
      }

      // ── Attach approval media to a task ─────────────────
      //    The file is already in the vault (uploaded client-side under the
      //    Tasks folder). Here we wire it to the OTHER surfaces: post it into the
      //    project chat (Messages hub) and record the send in Approvals & Records
      //    (with the file link). A gate is moved into review so the client is
      //    prompted to approve.
      case 'attach_task_media': {
        const { task_id, attachment_url, attachment_name, attachment_file_id, note } = body
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, title, project_id, visible_to_client, requires_approval, category, status, approval_status')
          .eq('id', task_id)
          .single()
        if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

        // A send after the client previously requested changes is a RE-SEND.
        const resend = task.approval_status === 'changes_requested'
        const trimmedNote = typeof note === 'string' ? note.trim() : ''
        const clientId = await clientIdForProject(task.project_id)

        // 1) Messages hub — post into the project chat, framed as a task trigger.
        const msgBody = [
          resend ? `🔁 Re-sent for approval · “${task.title}”` : `📤 Sent for approval · “${task.title}”`,
          `Action: ${resend ? 'Re-sent for re-approval' : 'Requesting approval'}`,
          trimmedNote ? `Note: ${trimmedNote}` : null,
          attachment_name ? `📎 File: ${attachment_name}` : null,
        ].filter(Boolean).join('\n')
        await supabaseAdmin.from('messages').insert({
          project_id: task.project_id,
          sender_id: user.id,
          sender_role: 'admin',
          sender_name: 'McPrime Digital',
          body: msgBody,
          attachment_url: attachment_url || null,
          attachment_name: attachment_name || null,
        })
        await createNotification({
          clientId, projectId: task.project_id, type: 'message',
          title: 'New message from McPrime Digital', body: `${resend ? 'Re-sent' : 'Sent'} “${task.title}” for approval`,
        })

        // 2) Move the gate into review (reset approval on a re-send) so the
        //    client gets a fresh approve / request-changes prompt.
        if (task.status !== 'completed') {
          await supabaseAdmin.from('tasks')
            .update({ status: 'review', ...(resend ? { approval_status: 'pending' } : {}) })
            .eq('id', task_id)
          try {
            await supabaseAdmin.from('tasks').update({ review_requested_at: new Date().toISOString() }).eq('id', task_id)
          } catch { /* phase4 column may not exist yet */ }
          if (task.visible_to_client !== false) {
            await createNotification({
              clientId, projectId: task.project_id, type: 'task_updated',
              title: resend ? 'A task needs your approval again' : 'A task needs your approval', body: task.title,
            })
          }
        }

        // 3) Records — the gate send carrying the note + file link + resend flag.
        const isGate = task.requires_approval || task.category === 'approval'
        if (isGate && task.visible_to_client !== false) {
          await recordActivity({
            projectId: task.project_id, clientId,
            actorId: user.id, actorName: 'McPrime Digital', actorRole: 'admin',
            eventType: 'approval_requested',
            title: `${resend ? 'Re-sent for approval' : 'Approval requested'}: “${task.title}”`,
            body: trimmedNote || null,
            meta: { task_id, attachment_name: attachment_name || null, attachment_file_id: attachment_file_id || null, resend },
          })
        }

        const { data: updated } = await supabaseAdmin.from('tasks').select('*').eq('id', task_id).single()
        return NextResponse.json({ task: updated })
      }

      // ── Delete task ─────────────────────────────────────
      case 'delete_task': {
        const { task_id } = body
        const { error } = await supabaseAdmin
          .from('tasks')
          .delete()
          .eq('id', task_id)
        if (error) throw error
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[project-actions] error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
