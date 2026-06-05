import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    // Verify caller is admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { clientId } = await req.json()

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required.' },
        { status: 400 }
      )
    }

    // Fetch the client record
    const { data: client, error: fetchError } = await supabaseAdmin
      .from('clients')
      .select('id, user_id, name, email')
      .eq('id', clientId)
      .single()

    if (fetchError || !client) {
      return NextResponse.json(
        { error: 'Client not found.' },
        { status: 404 }
      )
    }

    // Unlink projects (set client_id to null, preserve projects)
    await supabaseAdmin
      .from('projects')
      .update({ client_id: null })
      .eq('client_id', clientId)

    // Remove rows that reference this client so the delete can't fail on
    // a foreign-key constraint. (Projects are preserved/unlinked above.)
    await supabaseAdmin.from('invoices').delete().eq('client_id', clientId)
    await supabaseAdmin.from('files').delete().eq('client_id', clientId)

    // Delete the client record
    const { error: deleteError } = await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', clientId)

    if (deleteError) {
      throw new Error(deleteError.message)
    }

    // Delete the auth user if linked
    if (client.user_id) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(client.user_id)
      } catch (authErr: any) {
        // Non-fatal — client record is already deleted
        console.error('Failed to delete auth user:', authErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Client "${client.name}" deleted.`,
    })
  } catch (err: any) {
    console.error('Delete client error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Failed to delete client.' },
      { status: 500 }
    )
  }
}
