import { resolveShareLink } from '@/lib/shareLinks'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenantBrand } from '@/lib/tenantBrand'
import ScreeningRoom from '@/components/portal/ScreeningRoom'
import TenantTheme from '@/components/TenantTheme'

/**
 * THE SCREENING PAGE — no session, by design.
 *
 * A colourist, a financier, a festival programmer, a composer: people who need
 * to see one cut and will never hold an account. Every review tool on the market
 * has this; what differs is what happens around it.
 *
 * ── IT WEARS THE STUDIO'S BRAND ─────────────────────────────────────────
 *
 * S0-B §2. The person opening this has a relationship with the STUDIO and has
 * never heard of Genreline — the same rule that governs the signing page.
 *
 * ── NO PLAYBACK URL IS RENDERED HERE ────────────────────────────────────
 *
 * The page renders a gate; the signed URL is minted by `/api/share` only once
 * the passcode and email are satisfied. Putting it in the markup and hiding the
 * player behind a form would make the gate a curtain.
 *
 * ── ONE ANSWER FOR EVERY FAILURE ────────────────────────────────────────
 *
 * Unknown, expired, revoked, view limit reached — the same sentence, so a probe
 * cannot learn which tokens exist or which of those it hit.
 */
export default async function SharePage(
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const link = await resolveShareLink(token)

  if (!link) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-xl font-semibold text-foreground">
          This link is no longer available
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          It may have expired, reached its limit, or been withdrawn. Ask whoever
          sent it for a new one.
        </p>
      </div>
    )
  }

  const brand = await tenantBrand(link.organization_id)

  // The NAME only — never the path, and never a URL. The asset itself is behind
  // the gate.
  const { data: f } = await supabaseAdmin
    .from('files').select('file_name').eq('id', link.subject_id).maybeSingle()
  const title = link.title || (f as { file_name: string } | null)?.file_name || 'this cut'

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* The brand reaches the ARTIFACT, not just the portal. A financier who
          will never hold an account opens this page once, and it is the
          studio's page — which is the half of "custom branding" every
          client-portal product stops short of, because none of them has
          anything that leaves the building. */}
      <TenantTheme brand={brand.brand} />
      <p className="text-[12px] font-medium uppercase tracking-wider text-faint">
        {brand.name}
      </p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h1>
      {link.expires_at && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Available until {new Date(link.expires_at).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          })}
        </p>
      )}

      <div className="mt-6">
        <ScreeningRoom
          token={token}
          requireEmail={link.require_email}
          hasPasscode={!!link.passcode_hash}
          title={title}
        />
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-faint">
        This viewing is recorded — who opened it, when, and how much was watched.
        {link.watermark && ' Your details appear across the picture while it plays.'}
      </p>
    </div>
  )
}
