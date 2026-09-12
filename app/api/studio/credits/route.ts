import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userOrgId } from '@/lib/auth/role'
import { getCreditState } from '@/lib/credits'
import { orgRolesOf } from '@/lib/team'

// Current org credit balance (cents) for the studio UI.
//
// THE GATE IS MEMBERSHIP, RESOLVED FROM THE ROSTER (S-R R-2, Batch 24 item 1a).
// It used to be `if (!user)` alone, and that was a disclosure: every
// client-portal user carries app_metadata.organization_id (all of them, live),
// so `userOrgId()` resolved the STUDIO's org for a client session and handed
// back the studio's balance and hard-stop state. A client of the studio reading
// the studio's books is the shape S-R exists to close, and the claim could not
// refuse it — the claim is what made it possible.
//
// orgRolesOf() reads organization_members and returns [] for anyone with no
// active row there, which is every client. 403, not 401: they are
// authenticated, they simply are not crew.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles = await orgRolesOf(user)
  if (roles.length === 0) {
    return NextResponse.json({ error: 'Studio credits are visible to crew only.' }, { status: 403 })
  }
  const { balanceCents, hardStop } = await getCreditState(userOrgId(user as never))
  return NextResponse.json({ balanceCents, hardStop })
}
