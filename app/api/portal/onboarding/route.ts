import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Saves the self-serve onboarding wizard and marks the client onboarded.
// Scoped to the caller's own client row (service role bypasses RLS).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, company, phone, notification_prefs } = await req.json()
  const now = new Date().toISOString()

  const updates: Record<string, unknown> = { onboarding_completed_at: now }
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (company !== undefined) updates.company = (company || '').trim() || null
  if (phone !== undefined) updates.phone = (phone || '').trim() || null
  if (notification_prefs !== undefined) updates.notification_prefs = notification_prefs

  // First-time onboarding also sets onboarded_at.
  const { data: existing } = await supabaseAdmin
    .from('clients')
    .select('onboarded_at')
    .eq('user_id', user.id)
    .single()
  if (existing && !existing.onboarded_at) updates.onboarded_at = now

  const { error } = await supabaseAdmin
    .from('clients')
    .update(updates)
    .eq('user_id', user.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (typeof name === 'string' && name.trim()) {
    await supabase.auth.updateUser({ data: { name: name.trim() } })
  }

  return NextResponse.json({ success: true })
}
