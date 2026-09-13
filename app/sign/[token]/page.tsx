import { ShieldCheck, Check } from 'lucide-react'
import { resolveSigningLink } from '@/lib/signingLinks'
import { CONSENT_TEXT, STATUS_LABEL } from '@/lib/contracts'
import { tenantBrand } from '@/lib/tenantBrand'
import SignViaLink from '@/components/portal/SignViaLink'

/**
 * THE ONLY PAGE IN THIS APPLICATION WITH NO SESSION.
 *
 * `S3-b` §3.7's path, built because a hybrid production's most common signature
 * comes from somebody who will never hold an account: a background actor signing
 * an AI-likeness release, a stunt double, a location owner.
 *
 * ── IT WEARS THE STUDIO'S BRAND, NOT THE PRODUCT'S ───────────────────────
 *
 * S0-B §2. This is a client-facing surface — the person opening it has a
 * relationship with the STUDIO and has never heard of Genreline. Putting the
 * product's name on it would be the same error as leaving a previous tenant's
 * name there.
 *
 * ── AN INVALID LINK SAYS ONE THING ───────────────────────────────────────
 *
 * Unknown, expired, revoked, used, contract deleted — all render the same
 * sentence. Distinguishing them would tell somebody holding a guessed token
 * which guesses are close.
 */

export default async function SignPage(
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const link = await resolveSigningLink(token)

  if (!link) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-xl font-semibold text-foreground">
          This signing link is no longer valid
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          It may have expired, already been used, or been withdrawn. Ask whoever sent
          it for a new one.
        </p>
      </div>
    )
  }

  const brand = await tenantBrand(link.contract.organization_id)
  const { contract, signer } = link

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-[12px] font-medium uppercase tracking-wider text-faint">
        {brand.name}
      </p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {contract.title}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        For {signer.name} · {STATUS_LABEL[contract.status]}
      </p>

      {contract.content_hash && (
        <p className="mt-2 flex items-center gap-1.5 break-all text-[11px] text-faint">
          <ShieldCheck size={12} className="shrink-0 text-primary" />
          SHA-256 {contract.content_hash}
        </p>
      )}

      <section className="squircle mt-6 border border-border bg-card p-5">
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground">
          {contract.body?.text ?? ''}
        </pre>
      </section>

      <div className="mt-6">
        {link.alreadySigned ? (
          <p className="inline-flex items-center gap-2 text-[14px] text-foreground">
            <Check size={16} className="text-primary" />
            You have signed this. Nothing further is needed.
          </p>
        ) : (
          <SignViaLink
            token={token}
            consentText={CONSENT_TEXT}
            alreadyConsented={link.consented}
          />
        )}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-faint">
        This document is signed electronically. A copy, together with a certificate
        recording who signed it and when, is produced once every signature is in.
      </p>
    </div>
  )
}
