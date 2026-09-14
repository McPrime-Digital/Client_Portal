import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { can } from '@/lib/capabilities.server'
import { deriveBrandTokens, type BrandKit } from '@/lib/brandKit'
import { captureError } from '@/lib/errors'

/**
 * THE BRAND KIT'S ONE WRITE PATH.
 *
 * NO SERVICE-ROLE CLIENT. `organizations_admin_write` (0021) is the tenant
 * boundary — `id = current_org() and is_org_admin()` — so a forgotten `.eq()`
 * here is a failed write, not another studio's brand replaced. The logo route
 * next door needs the service role for STORAGE and says so; this one touches
 * no storage and therefore needs nothing.
 *
 * ── THE DERIVATION HAPPENS HERE, NOT IN THE BROWSER ─────────────────────
 *
 * The editor previews with the same module so the studio sees the real numbers
 * as it picks — but what gets STORED is derived again, server-side, from the
 * colour alone. A client that posted a hand-made `tokens` object would be
 * writing CSS variables into every one of its clients' browsers, which is the
 * one thing a brand kit must not become. **The request carries a decision; the
 * server carries the consequences.**
 *
 * ── BOTH HALVES ARE STORED, ON PURPOSE ──────────────────────────────────
 *
 * `input` is what the studio chose; `tokens` is what renders. A better
 * derivation later re-runs from the input. Storing only the output would make
 * every improvement a migration that has already lost the information it needs.
 */

const Body = z.object({
  // Bounded because it goes through a colour parser, and a parser is the wrong
  // place to meet a megabyte. Any CSS colour: hex, a named colour, oklch().
  colour: z.string().trim().min(3).max(64),
  accent: z.string().trim().min(3).max(64).nullish(),
  // "Approve" and "Sign off" are different words to a legal team, and this is
  // the only free text in the kit — so it is length-bounded and rendered as
  // text, never as markup.
  approveLabel: z.string().trim().max(24).nullish(),
})

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  // The roster decides, not the claim. `can()` resolves the baseline, the
  // extras, the live grants AND the denials — the four-part answer the deleted
  // oracles could not give (Batch 26 item 8).
  if (!(await can(user, 'org.settings.write'))) {
    return {
      error: NextResponse.json(
        { error: 'You do not have permission to change the studio brand.', cap: 'org.settings.write' },
        { status: 403 },
      ),
    }
  }
  return { supabase, user }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if (g.error) return g.error
  const { supabase, user } = g

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const tokens = deriveBrandTokens({
    colour: parsed.data.colour,
    accent: parsed.data.accent ?? null,
  })
  if (!tokens) {
    // Named, because "invalid" tells somebody who typed `#12345` nothing.
    return NextResponse.json(
      { error: 'That is not a colour this can read. Try a hex value like #C8A24A.' },
      { status: 400 },
    )
  }

  const kit: BrandKit = {
    input: { colour: parsed.data.colour, accent: parsed.data.accent ?? null },
    tokens,
    approveLabel: parsed.data.approveLabel?.trim() || null,
    updatedAt: new Date().toISOString(),
  }

  try {
    const { data, error } = await supabase
      .from('organizations')
      .update({ branding: kit })
      .eq('id', userOrgId(user))
      .select('id')
      .maybeSingle()
    if (error) throw error
    // THE ROW IS THE WITNESS. An admin whose JWT lacks organization_id matches
    // no row: RLS returns success with nothing updated, and the studio would be
    // told its brand was saved while the portal kept the old one.
    if (!data) {
      return NextResponse.json(
        { error: 'Could not save — your session is not attached to a studio.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ ok: true, kit })
  } catch (e) {
    captureError(e, { route: 'studio/organization/brand', action: 'save' })
    return NextResponse.json({ error: 'Could not save the brand.' }, { status: 500 })
  }
}

/** Back to the product's own palette. `{}` and not null: the column is
 *  `not null default '{}'` and a null would be a second empty value meaning the
 *  same thing. */
export async function DELETE() {
  const g = await gate()
  if (g.error) return g.error
  const { supabase, user } = g

  try {
    const { data, error } = await supabase
      .from('organizations')
      .update({ branding: {} })
      .eq('id', userOrgId(user))
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Could not clear the brand.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { route: 'studio/organization/brand', action: 'clear' })
    return NextResponse.json({ error: 'Could not clear the brand.' }, { status: 500 })
  }
}
