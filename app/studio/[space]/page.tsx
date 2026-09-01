import { notFound } from 'next/navigation'
import { getSpace } from '@/lib/studio/spaces'
import SpaceShowcase from '@/components/studio/SpaceShowcase'

// A space's landing is its overture, not a second copy of the rail: the rail
// already lists (and permission-filters) every feature, so this page tells you
// what the floor IS and shows the work in motion. Dropping the feature grid
// also dropped this page's per-request auth + roster queries — the layout
// gates admission; nothing rendered here is role-dependent anymore.
export default async function SpacePage({ params }: { params: Promise<{ space: string }> }) {
  const { space: spaceId } = await params
  const space = getSpace(spaceId)
  if (!space) notFound()

  return <SpaceShowcase space={space.id} label={space.label} />
}
