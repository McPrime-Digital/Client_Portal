import { requireOrgFeature } from '@/lib/studio/guard'
import MeetingScreen from '@/components/studio/MeetingScreen'

/** The Client space's door onto the same room the crew floor uses. One screen,
 *  two spaces — the "one engine, two doors" rule Library and Files follow. */
export default async function ClientMeetingPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requireOrgFeature('client', 'meetings')
  const { id } = await params
  return <MeetingScreen id={id} backHref="/studio/client/meetings" />
}
