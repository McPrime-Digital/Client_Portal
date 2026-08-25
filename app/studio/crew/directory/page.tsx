import TeamManager from '@/components/studio/TeamManager'
import { requireOrgFeature } from '@/lib/studio/guard'

// Crew · Team — the org's roster with roles, custom access, and real actions.
export default async function CrewTeamPage() {
  await requireOrgFeature('crew', 'directory')
  return <TeamManager />
}
