import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { computeProjectProgress } from '@/lib/projectProgress'
import { createNotification, clientIdForProject } from '@/lib/notify'

// Verify the calling user is an admin
async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return null
  }
  return user
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
        await createNotification({
          clientId: await clientIdForProject(project_id),
          projectId: project_id,
          type: 'message',
          title: 'New message from McPrime Digital',
          body: typeof msgBody === 'string' ? msgBody.slice(0, 120) : null,
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

        // Keep projects.progress (what every list/overview reads) in
        // sync with the average of this project's phases, so the number
        // is identical across admin, client, detail and overview.
        let overall: number | null = null
        if (data?.project_id) {
          const { data: phases } = await supabaseAdmin
            .from('project_phases')
            .select('progress')
            .eq('project_id', data.project_id)
          overall = computeProjectProgress(phases, 0)
          await supabaseAdmin
            .from('projects')
            .update({ progress: overall })
            .eq('id', data.project_id)
        }

        return NextResponse.json({ phase: data, overall })
      }

      // ── Add task ────────────────────────────────────────
      case 'add_task': {
        const { project_id, title, sort_order } = body
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .insert({ project_id, title, status: 'pending', sort_order })
          .select()
          .single()
        if (error) throw error
        if (data?.visible_to_client !== false) {
          await createNotification({
            clientId: await clientIdForProject(project_id),
            projectId: project_id,
            type: 'task_updated',
            title: 'A new task was added to your project',
            body: title ?? null,
          })
        }
        return NextResponse.json({ task: data })
      }

      // ── Toggle task ─────────────────────────────────────
      case 'toggle_task': {
        const { task_id, status } = body
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ status })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error
        return NextResponse.json({ task: data })
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
