import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { tenantBrand } from '@/lib/tenantBrand'
import { captureError } from '@/lib/errors'

// WHO HAS JUST ARRIVED, and where they belong.
//
// `/set-password` is reached from an invite link. It renders the product's mark
// while the token is still in the URL — correct, there is no session yet
// (S0-B §2, Batch 9.7) — but the moment the token is adopted a real session
// exists, and from that point the tenant, the company and the audience are all
// knowable. The page previously never asked, so an invited client finished
// onboarding having seen only Genreline, from a studio they had actually hired.
//
// One endpoint answers it for every audience, because the three invites are
// genuinely different relationships and the copy has to say which:
//
//   client_owner    — a studio invited a company; they set the company up
//   client_teammate — a company's own owner invited a colleague
//   crew            — a studio invited someone onto its team
//
// It also returns `next`, which is the routing fix. `/set-password` used to
// push EVERYONE to `/onboarding`, and that page guards only on `isAdmin` and
// `onboarding_completed_at` — not on the member's role. So an invited teammate
// whose company had not finished onboarding walked the COMPANY setup wizard and
// could overwrite the company profile as themselves. The comment in
// `app/onboarding/page.tsx` asserts a teammate "cannot arrive on this page by
// any route the app offers"; set-password was that route.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Not an authorization gate — the page falls back to neutral copy. Never
  // 401s, because a slow cookie write should degrade branding, not break the
  // password form the person is standing in front of.
  if (!user) {
    return NextResponse.json({ audience: 'unknown', next: '/dashboard' })
  }

  try {
    // ── Crew: the studio invited them onto its own team ──
    if (isAdmin(user)) {
      const brand = await tenantBrand(userOrgId(user))
      const { data: member } = await supabaseAdmin
        .from('organization_members')
        .select('name')
        .eq('user_id', user.id)
        .maybeSingle()
      return NextResponse.json({
        audience: 'crew',
        studioName: brand.resolved ? brand.name : null,
        studioLogoUrl: brand.logoUrl,
        companyName: null,
        firstName: firstNameOf(member?.name ?? null, user.email),
        next: '/studio',
      })
    }

    // ── Portal side: which company, and are they its owner or a colleague? ──
    // Status is NOT filtered. A teammate is 'invited' until their first portal
    // load flips them active, and they are standing in the invite flow right
    // now — filtering on 'active' would resolve them to no company at all.
    const { data: membership } = await supabaseAdmin
      .from('client_members')
      .select('role, name, client_id')
      .eq('user_id', user.id)
      .neq('status', 'revoked')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ audience: 'unknown', next: '/dashboard' })
    }

    const { data: company } = await supabaseAdmin
      .from('clients')
      .select('name, company, organization_id, onboarding_completed_at, onboarded_at')
      .eq('id', membership.client_id)
      .maybeSingle()

    const brand = await tenantBrand(company?.organization_id)
    const isOwner = membership.role === 'owner'
    const onboarded = !!(company?.onboarding_completed_at ?? company?.onboarded_at)

    return NextResponse.json({
      audience: isOwner ? 'client_owner' : 'client_teammate',
      studioName: brand.resolved ? brand.name : null,
      studioLogoUrl: brand.logoUrl,
      companyName: company?.company || company?.name || null,
      firstName: firstNameOf(membership.name, user.email),
      // Only a company OWNER may walk the company setup wizard. A teammate
      // goes straight to the portal — they are joining a company profile, not
      // authoring one.
      next: isOwner && !onboarded ? '/onboarding' : '/dashboard',
    })
  } catch (err) {
    captureError(err, { where: 'auth/welcome-context' })
    return NextResponse.json({ audience: 'unknown', next: '/dashboard' })
  }
}

function firstNameOf(name: string | null, email: string | undefined): string | null {
  const n = name?.trim().split(/\s+/)[0]
  if (n) return n
  return email?.split('@')[0] ?? null
}
