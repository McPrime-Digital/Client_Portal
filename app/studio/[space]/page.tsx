import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSpace } from '@/lib/studio/spaces'
import { createClient } from '@/lib/supabase/server'
import { orgRoleOf } from '@/lib/team'
import { orgFeatureAllowed } from '@/lib/permissions'

export default async function SpacePage({ params }: { params: Promise<{ space: string }> }) {
  const { space: spaceId } = await params
  const space = getSpace(spaceId)
  if (!space) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const orgRole = user ? ((await orgRoleOf(user)) ?? 'member') : 'member'
  const features = space.features.filter((f) => orgFeatureAllowed(orgRole, space.id, f.slug))

  const Icon = space.icon

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <Icon size={24} className="text-primary" />
          {space.label}
        </h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{space.blurb}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => {
          const FIcon = f.icon
          return (
            <Link
              key={f.slug}
              href={`/studio/${space.id}/${f.slug}`}
              className="group rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary">
                  <FIcon size={18} />
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                  Phase {f.phase}
                </span>
              </div>
              <h3 className="mt-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                {f.label}
                {f.badge && <span className="text-[9px] font-bold text-primary">★ {f.badge}</span>}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                Open →
              </p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
