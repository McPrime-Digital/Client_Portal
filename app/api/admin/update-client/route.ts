import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Admin edits a client's profile (service role — bypasses RLS).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { clientId, updates } = await req.json()
  if (!clientId || !updates) {
    return NextResponse.json({ error: 'clientId and updates are required.' }, { status: 400 })
  }

  // Whitelist editable fields.
  const allowed = ['name', 'company', 'phone', 'email', 'notes', 'is_active']
  const clean: Record<string, unknown> = {}
  for (const k of allowed) if (k in updates) clean[k] = updates[k]

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update(clean)
    .eq('id', clientId)
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ client: data })
}
