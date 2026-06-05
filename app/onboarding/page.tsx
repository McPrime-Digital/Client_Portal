import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
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

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, phone, avatar_url, onboarding_completed_at')
    .eq('user_id', user.id)
    .single()

  // No client record, or already onboarded → straight to the portal.
  if (!client) redirect('/dashboard')
  if (client.onboarding_completed_at) redirect('/dashboard')

  return (
    <OnboardingWizard
      initial={{
        name: client.name ?? user.user_metadata?.name ?? '',
        company: client.company ?? '',
        phone: client.phone ?? '',
        avatarUrl: client.avatar_url ?? null,
      }}
    />
  )
}
