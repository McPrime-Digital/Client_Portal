import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

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

      // ── Client approves a shared task ───────────────────────
      case 'approve_task': {
        const { task_id } = body
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, project_id, visible_to_client, projects(client_id)')
          .eq('id', task_id)
          .single()
        const rel = (task as { projects?: { client_id?: string } | { client_id?: string }[] } | null)?.projects
        const ownerClientId = Array.isArray(rel) ? rel[0]?.client_id : rel?.client_id
        if (!task || ownerClientId !== client.id || !task.visible_to_client) {
          return NextResponse.json({ error: 'Task not found.' }, { status: 404 })
        }
        const now = new Date().toISOString()
        const { data, error } = await supabaseAdmin
          .from('tasks')
          .update({ approved_at: now, status: 'completed', completed_at: now })
          .eq('id', task_id)
          .select()
          .single()
        if (error) throw error
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
