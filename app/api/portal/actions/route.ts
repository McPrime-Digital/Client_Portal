import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdminNotification, pushMessageAlert } from '@/lib/notify'
import { messagePreview } from '@/lib/messagePreview'
import { recordActivity } from '@/lib/logActivity.server'
import { clientMembershipOf, type ClientRole } from '@/lib/team'
import { clientCan } from '@/lib/permissions'
import { ensureClientRoom } from '@/lib/messageRooms'
import { verifyAttachment, writeAttachmentRow } from '@/lib/messageAttachments'
import { writeMentions, notifyMentions } from '@/lib/messageMentions'

// Verify the calling user belongs to a client company — the primary login
// (clients.user_id) or an invited teammate (client_members). Returns the
// member's role so approval actions can be role-gated.
async function verifyClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const membership = await clientMembershipOf(user)
  if (!membership) return null

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', membership.clientId)
    .single()

  return client
    ? { user, client, memberRole: membership.role as ClientRole, memberName: membership.name, memberExtra: membership.extraCaps }
    : null
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
        if (!clientCan(auth.memberRole, 'approve', auth.memberExtra)) {
          return NextResponse.json({ error: 'Your role does not include approvals.' }, { status: 403 })
        }
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
        // The room is the company's single conversation; project_id rides
        // along as the tag (S3-core §1.1). Org stamped, never defaulted (T-5).
        const approvalRoom = await ensureClientRoom(supabaseAdmin, client.organization_id, client.id, user.id)
        // Verified against the files table + this company; stored fields
        // derive from the verified row (I-6). A bad ref drops the attachment
        // from the proof rather than failing the approval itself.
        const approvalAtt = await verifyAttachment(supabaseAdmin, {
          fileId: attachment_file_id, url: attachment_url, clientId: client.id,
        }).catch(() => null)
        const { data: approvalMsg } = await supabaseAdmin.from('messages').insert({
          room_id: approvalRoom.id,
          organization_id: client.organization_id,
          project_id: task.project_id,
          sender_id: user.id,
          sender_role: 'client',
          sender_name: auth.memberName,
          body: approvalBody,
          attachment_url: approvalAtt?.url ?? null,
          attachment_name: approvalAtt?.name ?? null,
        }).select('id').single()
        if (approvalAtt && approvalMsg) await writeAttachmentRow(supabaseAdmin, approvalMsg.id, approvalAtt.fileId)

        await createAdminNotification({
          clientId: client.id,
          projectId: data.project_id,
          type: 'task_updated',
          title: `${auth.memberName} approved a task`,
          body: data.title ?? null,
        })
        // Persist to the Approvals & Records ledger — reliable direct insert.
        await recordActivity({
          projectId: data.project_id, clientId: client.id, actorId: user.id,
          actorName: auth.memberName, actorRole: 'client',
          eventType: 'task_approved', title: `${auth.memberName} approved “${data.title}”`,
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
        if (!clientCan(auth.memberRole, 'approve', auth.memberExtra)) {
          return NextResponse.json({ error: 'Your role does not include approvals.' }, { status: 403 })
        }
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
        const changesRoom = await ensureClientRoom(supabaseAdmin, client.organization_id, client.id, user.id)
        const changesAtt = await verifyAttachment(supabaseAdmin, {
          fileId: attachment_file_id, url: attachment_url, clientId: client.id,
        }).catch(() => null)
        const { data: changesMsg } = await supabaseAdmin.from('messages').insert({
          room_id: changesRoom.id,
          organization_id: client.organization_id, // stamped, never defaulted (T-5)
          project_id: task.project_id,
          sender_id: user.id,
          sender_role: 'client',
          sender_name: auth.memberName,
          body: changesBody,
          attachment_url: changesAtt?.url ?? null,
          attachment_name: changesAtt?.name ?? null,
        }).select('id').single()
        if (changesAtt && changesMsg) await writeAttachmentRow(supabaseAdmin, changesMsg.id, changesAtt.fileId)

        await createAdminNotification({
          clientId: client.id,
          projectId: task.project_id,
          type: 'task_updated',
          title: `${auth.memberName} requested changes`,
          body: task.title,
        })
        // Persist to the Approvals & Records ledger — reliable direct insert.
        await recordActivity({
          projectId: task.project_id, clientId: client.id, actorId: user.id,
          actorName: auth.memberName, actorRole: 'client',
          eventType: 'changes_requested', title: `${auth.memberName} requested changes on “${task.title}”`,
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
        if (!clientCan(auth.memberRole, 'message', auth.memberExtra)) {
          return NextResponse.json({ error: 'Your role is view-only — messaging is not available.' }, { status: 403 })
        }
        const {
          project_id: rawProjectId,
          body: msgBody,
          attachment_url,
          attachment_name,
          attachment_file_id,
          reply_to_id,
          thread_root_id,
        } = body
        // "room:<clientId>" is the General thread's id — an untagged send.
        const project_id =
          typeof rawProjectId === 'string' && rawProjectId.startsWith('room:')
            ? null
            : rawProjectId ?? null

        // A message needs a room, not a project (Batch 14 item 8): with no
        // project_id it lands untagged in the company's General thread — how
        // a freshly onboarded client talks to their studio before any project
        // exists. When a tag IS supplied it must be the client's own project.
        if (project_id) {
          const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', project_id)
            .eq('client_id', client.id)
            .single()
          if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 })
          }
        }

        // The reference is verified against the files table and the sending
        // company — a forged id or path fails here, and what gets STORED is
        // derived from the verified row, never echoed from the body (I-6).
        let att
        try {
          att = await verifyAttachment(supabaseAdmin, {
            fileId: attachment_file_id, url: attachment_url, clientId: client.id,
          })
        } catch (e) {
          return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid attachment' }, { status: 400 })
        }
        const room = await ensureClientRoom(supabaseAdmin, client.organization_id, client.id, user.id)
        const { data, error } = await supabaseAdmin
          .from('messages')
          .insert({
            room_id: room.id,
            organization_id: client.organization_id, // stamped, never defaulted (T-5)
            project_id,
            sender_id: user.id,
            sender_role: 'client',
            sender_name: auth.memberName,
            body: msgBody,
            attachment_url: att?.url ?? null,
            attachment_name: att?.name ?? null,
            reply_to_id: reply_to_id || null,
            // One level deep, root-validated, tag inherited — by the 0030
            // trigger, NOT re-implemented here (RLS depends on the database
            // being the authority).
            thread_root_id: thread_root_id || null,
          })
          .select()
          .single()

        if (error) throw error
        if (att) await writeAttachmentRow(supabaseAdmin, data.id, att.fileId)
        // Mentions: parsed from the BODY server-side, validated against this
        // tenant, written by us — never accepted from the request (I-6).
        try {
          const mentioned = await writeMentions(supabaseAdmin, {
            messageId: data.id,
            body: msgBody,
            orgId: client.organization_id,
            clientId: client.id,
          })
          await notifyMentions(supabaseAdmin, {
            roomId: room.id,
            mentionedUsers: mentioned,
            senderUserId: user.id,
            senderName: auth.memberName,
            preview: messagePreview({ body: msgBody, attachment_name: att?.name ?? null }),
          })
        } catch (e) {
          console.error('[send_message] mention write failed:', e)
        }
        // No in-app bell entry for plain chat (the Messages badge carries
        // unread). But push the admin's device instantly IF they're away —
        // an active, in-app admin is left alone (they see it live). Email/SMS
        // stay on the 5h nudge cron so a live thread never spams them.
        await pushMessageAlert({
          recipient: 'admin',
          projectId: project_id ?? null,
          clientId: client.id,
          senderName: auth.memberName,
          preview: messagePreview({ body: msgBody, attachment_name }),
        })
        return NextResponse.json({ message: data })
      }

      // ── Save notification preferences (per-category channels) ──
      case 'save_notification_prefs': {
        const { prefs } = body
        if (!prefs || typeof prefs !== 'object') {
          return NextResponse.json({ error: 'Invalid preferences.' }, { status: 400 })
        }
        const { error } = await supabaseAdmin
          .from('clients')
          .update({ notification_prefs: prefs })
          .eq('id', client.id)
        if (error) throw error
        return NextResponse.json({ success: true })
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
