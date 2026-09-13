import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSpace } from '@/lib/studio/spaces'
import { requireOrgFeature } from '@/lib/studio/guard'
import ScriptDesign from '@/components/studio/ScriptDesign'
import Storyboard from '@/components/studio/Storyboard'
import PrimeOSChat from '@/components/studio/PrimeOSChat'

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ space: string; feature: string }>
}) {
  const { space: spaceId, feature: slug } = await params
  const space = getSpace(spaceId)
  const feature = space?.features.find((f) => f.slug === slug)
  if (!space || !feature) notFound()

  // Roles + custom grants gate every feature, stubs included.
  await requireOrgFeature(space.id, feature.slug)

  // Features whose studio-native version isn't built yet route to the working
  // legacy tool — a space entry must never dead-end in a stub.
  if (feature.legacyHref) redirect(feature.legacyHref)

  // Real features progressively replace the stub below.
  if (space.id === 'suite' && feature.slug === 'script') {
    return <ScriptDesign />
  }
  if (space.id === 'suite' && feature.slug === 'storyboard') {
    return <Storyboard />
  }
  if (space.id === 'suite' && feature.slug === 'ai-chat') {
    return <PrimeOSChat />
  }

  const Icon = feature.icon

  /**
   * THE UNBUILT SURFACE — rewritten 2026-09-13 (S-S SS-2).
   *
   * It used to say: "This is where X will live. Scheduled for Phase N of the
   * Genreline build." Two problems, and the second is the serious one.
   *
   * It PUBLISHED THE ROADMAP. "Phase 3 of the Genreline build" is internal
   * sequencing, rendered inside a studio that clients' work passes through and
   * that the product is sold to other studios. A person who reaches this has
   * learned what is not finished and roughly when — which is a commercial
   * disclosure sitting behind nothing but a URL.
   *
   * And it said nothing USEFUL. "Coming soon" answers a question nobody asked;
   * the question is "what do I do now". Where a working surface covers the need
   * today, this says so and links it.
   */
  const MEANWHILE: Record<string, { text: string; href: string; label: string }> = {
    'crew/calendar': { text: 'Deadlines and kickoffs live on each production for now.', href: '/studio/client/projects', label: 'Productions' },
    'crew/meetings': { text: 'Use your own call link and keep the record in the room.', href: '/studio/crew/chat', label: 'Crew chat' },
    'client/brand-kit': { text: 'Logo and business identity live in settings.', href: '/studio/crew/settings', label: 'Settings' },
    'client/guest-links': { text: 'Share a production with a client from its review page.', href: '/studio/client/review', label: 'Review' },
  }
  const meanwhile = MEANWHILE[`${space.id}/${feature.slug}`]

  return (
    <div className="mx-auto max-w-md pt-[8vh]">
      <Link
        href={`/studio/${space.id}`}
        className="mb-8 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} />
        {space.label}
      </Link>

      <Icon size={22} className="text-faint" strokeWidth={1.5} />
      <h1 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
        {feature.label}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        Not built yet.{meanwhile ? ` ${meanwhile.text}` : ''}
      </p>

      {meanwhile && (
        <Link
          href={meanwhile.href}
          className="squircle-sm mt-5 inline-flex items-center border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
        >
          {meanwhile.label}
        </Link>
      )}
    </div>
  )
}
