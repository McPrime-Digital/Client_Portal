/* Gated studio route — roles + custom grants checked before the canonical
   page module renders inside the Genreline shell. */
import Page from '@/app/(admin)/admin/messages/page'
import { requireOrgFeature } from '@/lib/studio/guard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function GatedPage(props: any) {
  await requireOrgFeature('client', 'messages')
  return <Page {...props} />
}
