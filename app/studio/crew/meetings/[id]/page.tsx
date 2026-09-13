import { requireOrgFeature } from '@/lib/studio/guard'
import MeetingScreen from '@/components/studio/MeetingScreen'

/** The internal floor's door onto the room. The screen itself is shared with
 *  Client · Meetings — one room, two spaces (the same "one engine, two doors"
 *  rule Library and Files already follow). */
export default async function CrewMeetingPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requireOrgFeature('crew', 'meetings')
  const { id } = await params
  return <MeetingScreen id={id} backHref="/studio/crew/meetings" />
}
