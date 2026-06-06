import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSpace } from '@/lib/studio/spaces'
import ScriptDesign from '@/components/studio/ScriptDesign'

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ space: string; feature: string }>
}) {
  const { space: spaceId, feature: slug } = await params
  const space = getSpace(spaceId)
  const feature = space?.features.find((f) => f.slug === slug)
  if (!space || !feature) notFound()

  // Real features progressively replace the stub below.
  if (space.id === 'workspace' && feature.slug === 'script') {
    return <ScriptDesign />
  }

  const Icon = feature.icon

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/studio/${space.id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={15} />
        {space.label}
      </Link>

      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-primary">
          <Icon size={30} />
        </div>
        <h1 className="mt-5 flex items-center justify-center gap-2 font-display text-xl font-semibold text-foreground">
          {feature.label}
          {feature.badge && <span className="text-[10px] font-bold text-primary">★ {feature.badge}</span>}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          This is where <b className="text-foreground">{feature.label}</b> will live. Scheduled for{' '}
          <b className="text-foreground">Phase {feature.phase}</b> of the Throughline build.
        </p>
        <span className="mt-5 inline-block rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          Phase {feature.phase} · coming soon
        </span>
      </div>
    </div>
  )
}
