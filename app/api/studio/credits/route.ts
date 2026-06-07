import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userOrgId } from '@/lib/auth/role'
import { getCreditState } from '@/lib/credits'

// Current org credit balance (cents) for the studio UI.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { balanceCents, hardStop } = await getCreditState(userOrgId(user as never))
  return NextResponse.json({ balanceCents, hardStop })
}
