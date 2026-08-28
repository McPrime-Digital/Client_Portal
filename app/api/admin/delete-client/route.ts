import { isAdmin, userOrgId } from '@/lib/auth/role'
import { cutMemberAccess } from '@/lib/memberAccess'
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

    // Fetch the client record — org-scoped: unscoped, an admin of one tenant
    // could delete another tenant's company (and its invoices and files rows)
    // by id. Foreign uuids 404 like any other miss.
    const { data: client, error: fetchError } = await supabaseAdmin
      .from('clients')
      .select('id, user_id, name, email')
      .eq('id', clientId)
      .eq('organization_id', userOrgId(user))
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

    // Cut the primary login's claims — but keep the account. The identity may
    // belong to another tenant (S1 §2); with the company row and its cascade-
    // deleted client_members rows gone, the login reads nothing regardless.
    if (client.user_id) {
      try {
        await cutMemberAccess(client.user_id)
      } catch (authErr: any) {
        // Non-fatal — client record is already deleted
        console.error('Failed to cut auth claims:', authErr.message)
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
