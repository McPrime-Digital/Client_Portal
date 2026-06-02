import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdminNotification } from '@/lib/notify'
import { recordActivity } from '@/lib/logActivity'

// Verify the calling user is an authenticated client
async function verifyClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Use service role to bypass RLS on the clients table
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return client ? { user, client } : null
}

export async function POST(req: NextRequest) {
  const auth = await verifyClient()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { user, client } = auth
  const body = await req.json()
  const { action } = body

  try {
    switch (action) {

      // ── Dismiss the welcome banner (persists until set) ─────
      case 'dismiss_welcome': {
        try {
          await supabaseAdmin
            .from('clients')
            .update({ welcome_dismissed_at: new Date().toISOString() })
            .eq('id', client.id)
        } catch {
          // Column may not exist yet — banner still closes client-side.
        }
        return NextResponse.json({ success: true })
      }

      // ── Client approves a shared task ───────────────────────
      case 'approve_task': {
        const { task_id, note, attachment_url, attachment_name, attachment_file_id } = body
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, title, project_id, visible_to_client, projects(client_id)')
          .eq('id', task_id)
          .single()
        const rel = (task as { projects?: { client_id?: string } | { client_id?: string }[] } | null)?.projects
        const ownerClientId = Array.isArray(rel) ? rel[0]?.client_id : rel?.client_id
        if (!task || ownerClientId !== client.id || !task.visible_to_client) {
          return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
        }
        const now = new Date().toISOString()
        const trimmedNote = typeof note === 'string' ? note.trim() : ''
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ approved_at: now, status: 'completed', completed_at: now, approval_status: 'approved' })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error

        // Register the approval in the project chat as proof. Framed as a task
        // trigger carrying the process name, the action, any file, and the note.
        const approvalBody = [
          `✅ Task approval · "${task.title}"`,
          `Action: Approved`,
          trimmedNote ? `Note: ${trimmedNote}` : null,
          attachment_name ? `📎 File: ${attachment_name}` : null,
        ].filter(Boolean).join('\n')
        await supabaseAdmin.from('messages').insert({
          project_id: task.project_id,
          sender_id: user.id,
          sender_role: 'client',
          sender_name: client.name,
          body: approvalBody,
          attachment_url: attachment_url || null,
          attachment_name: attachment_name || null,
        })

        await createAdminNotification({
          clientId: client.id,
          projectId: data.project_id,
          type: 'task_updated',
          title: `${client.name} approved a task`,
          body: data.title ?? null,
        })
        // Persist to the Approvals & Records ledger — reliable direct insert.
        await recordActivity({
          projectId: data.project_id, clientId: client.id, actorId: user.id,
          actorName: client.name, actorRole: 'client',
          eventType: 'task_approved', title: `${client.name} approved “${data.title}”`,
          body: trimmedNote || null,
          meta: {
            task_id: data.id,
            attachment_name: attachment_name || null,
            attachment_file_id: attachment_file_id || null,
          },
        })
        return NextResponse.json({ task: data })
      }

      // Client requests changes on an approval-gate task. A note is required
      // and is auto-posted into the project chat for further discussion.
      case 'request_changes': {
        const { task_id, note, attachment_url, attachment_name, attachment_file_id } = body
        if (!note || !String(note).trim()) {
          return NextResponse.json({ error: 'A note is required to request changes.' }, { status: 400 })
        }
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, title, project_id, visible_to_client, projects(client_id)')
          .eq('id', task_id)
          .single()
        const rel = (task as { projects?: { client_id?: string } | { client_id?: string }[] } | null)?.projects
        const ownerClientId = Array.isArray(rel) ? rel[0]?.client_id : rel?.client_id
        if (!task || ownerClientId !== client.id || !task.visible_to_client) {
          return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
        }
        const trimmed = String(note).trim()
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ approval_status: 'changes_requested', approval_note: trimmed, status: 'in_progress' })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error

        // Auto-post the change request into the project chat (with any file).
        // Framed as a task trigger carrying the process name, action, file, note.
        const changesBody = [
          `🔄 Task approval · "${task.title}"`,
          `Action: Changes requested`,
          `Note: ${trimmed}`,
          attachment_name ? `📎 File: ${attachment_name}` : null,
        ].filter(Boolean).join('\n')
        await supabaseAdmin.from('messages').insert({
          project_id: task.project_id,
          sender_id: user.id,
          sender_role: 'client',
          sender_name: client.name,
          body: changesBody,
          attachment_url: attachment_url || null,
          attachment_name: attachment_name || null,
        })

        await createAdminNotification({
          clientId: client.id,
          projectId: task.project_id,
          type: 'task_updated',
          title: `${client.name} requested changes`,
          body: task.title,
        })
        // Persist to the Approvals & Records ledger — reliable direct insert.
        await recordActivity({
          projectId: task.project_id, clientId: client.id, actorId: user.id,
          actorName: client.name, actorRole: 'client',
          eventType: 'changes_requested', title: `${client.name} requested changes on “${task.title}”`,
          body: trimmed.slice(0, 140),
          meta: {
            task_id: task.id,
            attachment_name: attachment_name || null,
            attachment_file_id: attachment_file_id || null,
          },
        })
        return NextResponse.json({ task: data })
      }

      case 'send_message': {
        const {
          project_id,
          body: msgBody,
          attachment_url,
          attachment_name,
          reply_to_id,
        } = body

        // Verify this project belongs to this client
        const { data: project } = await supabaseAdmin
          .from('projects')
          .select('id')
          .eq('id', project_id)
          .eq('client_id', client.id)
          .single()

        if (!project) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        const { data, error } = await supabaseAdmin
          .from('messages')
          .insert({
            project_id,
            sender_id: user.id,
            sender_role: 'client',
            sender_name: client.name,
            body: msgBody,
            attachment_url: attachment_url || null,
            attachment_name: attachment_name || null,
            reply_to_id: reply_to_id || null,
          })
          .select()
          .single()

        if (error) throw error
        await createAdminNotification({
          clientId: client.id,
          projectId: project_id,
          type: 'message',
          title: `New message from ${client.name}`,
          body: typeof msgBody === 'string' ? msgBody.slice(0, 120) : null,
        })
        return NextResponse.json({ message: data })
      }

      // ── Update own profile ──────────────────────────────
      case 'update_profile': {
        const { name, company, phone } = body

        if (!name || !name.trim()) {
          return NextResponse.json(
            { error: 'Name is required.' },
            { status: 400 }
          )
        }

        const { data, error } = await supabaseAdmin
          .from('clients')
          .update({
            name: name.trim(),
            company: company?.trim() || null,
            phone: phone?.trim() || null,
          })
          .eq('id', client.id)
          .select()
          .single()

        if (error) throw error
        return NextResponse.json({ client: data })
      }

      // ── Insert file record ──────────────────────────────
      case 'insert_file': {
        const {
          project_id, file_name, file_path,
          file_size, file_type, direction, bucket,
        } = body

        // Verify ownership
        const { data: project } = await supabaseAdmin
          .from('projects')
          .select('id')
          .eq('id', project_id)
          .eq('client_id', client.id)
          .single()

        if (!project) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }

        const { data, error } = await supabaseAdmin
          .from('files')
          .insert({
            project_id,
            client_id: client.id,
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

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[portal-actions] error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
