import { userRole } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Stores (and removes) a browser Web Push subscription for the authenticated
// user, so the server can push device notifications. One row per endpoint.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subscription } = await req.json().catch(() => ({}))
  const endpoint = subscription?.endpoint
  if (!endpoint) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })

  const role = userRole(user)
  let clientId: string | null = null
  if (role === 'client') {
    const { data: c } = await supabaseAdmin.from('clients').select('id').eq('user_id', user.id).single()
    clientId = c?.id ?? null
  }

  try {
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          role,
          client_id: clientId,
          endpoint,
          subscription,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      )
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Could not save subscription. Apply the phase11 migration first.' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json().catch(() => ({}))
  if (!endpoint) return NextResponse.json({ ok: true })
  try {
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)
  } catch {
    // best-effort
  }
  return NextResponse.json({ ok: true })
}
