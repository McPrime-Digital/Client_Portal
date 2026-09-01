import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Admin edits a client's profile (service role — bypasses RLS).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
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

  // Org-scoped like every other admin write: clientId comes from the body, so
  // without the predicate an admin of one tenant could rewrite another
  // tenant's company (this was the last admin write missing it). A foreign
  // uuid 404s like any other miss.
  //
  // Known drift, deliberate here: this edits clients.email only — the
  // company's CONTACT address. client_members.email and auth.users.email are
  // separate records of who can log in and are not touched by a contact-info
  // edit; reconciling the three is S1's identity question, not this route's.
  const { data, error } = await supabaseAdmin
    .from('clients')
    .update(clean)
    .eq('id', clientId)
    .eq('organization_id', userOrgId(user))
    .select()
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
  }
  return NextResponse.json({ client: data })
}
