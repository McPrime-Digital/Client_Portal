import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { portalClientId, clientMembershipOf } from '@/lib/team'
import { tenantBrand } from '@/lib/tenantBrand'
import { redirect } from 'next/navigation'
import OnboardingWizard from '@/components/portal/OnboardingWizard'

// Self-serve onboarding — full-screen wizard new clients land on after
// setting their password. Tenant-agnostic, so it scales to SaaS.
export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Admins don't onboard.
  if (isAdmin(user)) redirect('/admin')

  // Resolve the company through client_members — the sole authority since
  // Batch 6.8 (S1 §5.2) — not the deprecated clients.user_id pointer this used
  // to read. portalClientId() returns a sentinel that matches no row when there
  // is no membership, so the `!client` redirect below still covers that case.
  //
  // Behaviour note: an invited TEAMMATE resolves here where they used to fall
  // through to /dashboard.
  //
  // THAT NOTE USED TO SAY THIS WAS SAFE because "the portal layout only routes
  // anyone to /onboarding when role === 'owner', so a teammate cannot arrive
  // here by any route the app offers." The portal layout was not the only
  // route: `/set-password` pushed EVERY new account here after they chose a
  // password, teammates included. With the company not yet onboarded, a
  // teammate walked the COMPANY setup wizard and could overwrite the company
  // profile as themselves — exactly what the layout's guard exists to prevent.
  //
  // The guard belongs on the page, not on one of the ways in. Enforced below.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, phone, avatar_url, organization_id, onboarding_completed_at')
    .eq('id', await portalClientId(user))
    .maybeSingle()

  // No client record, or already onboarded → straight to the portal.
  if (!client) redirect('/dashboard')
  if (client.onboarding_completed_at) redirect('/dashboard')

  // ONLY THE COMPANY'S OWNER MAY AUTHOR THE COMPANY PROFILE. A teammate is
  // joining a company, not creating one; this wizard writes `clients.name`,
  // `.company`, `.phone` and `.avatar_url`, so letting a colleague through it
  // hands them the company's identity. Resolved from the roster (S1 §5.2),
  // never from the request.
  const membership = await clientMembershipOf(user)
  if (membership?.role !== 'owner') redirect('/dashboard')

  // The studio this client is onboarding with. Its brand, not the product's
  // and not another tenant's (S0-B §2).
  const brand = await tenantBrand(client.organization_id)

  return (
    <OnboardingWizard
      initial={{
        name: client.name ?? user.user_metadata?.name ?? '',
        company: client.company ?? '',
        phone: client.phone ?? '',
        avatarUrl: client.avatar_url ?? null,
      }}
      studioName={brand.name}
      studioLogoUrl={brand.logoUrl}
    />
  )
}
