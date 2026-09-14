import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CLEARANCE — what an asset is actually allowed to be used for.
 *
 * ── THE OBLIGATION IS LIVE LAW, NOT A ROADMAP ITEM ──────────────────────
 *
 * As of today, all three of these are in force or through committee:
 *
 *   · **New York, 9 June 2026** — conspicuous disclosure required when an
 *     advertisement features an AI-generated SYNTHETIC PERFORMER, binding any ad
 *     reaching New York consumers wherever the advertiser sits. $1,000 first
 *     violation, $5,000 each after.
 *   · **EU AI Act, 2 August 2026** — AI-generated images must be
 *     machine-readable and labelled when published.
 *   · **NO FAKES Act** — a federal digital-replica right over voice and likeness,
 *     advanced unanimously out of the Senate Judiciary Committee in June 2026.
 *
 * `rights` (0079) and `asset_provenance` (0064) already hold precisely what
 * those require, in **C2PA's own vocabulary** and the **CAWG
 * `cawg.training-mining`** triple. Until 0088 nothing read either of them, and
 * the party the disclosure laws actually act on — the client, who runs the
 * advertisement and takes the penalty — was never told anything at all.
 *
 * ── THE RULE THAT MATTERS MOST: NO ROW IS NOT "CLEARED" ─────────────────
 *
 * The dangerous output of a clearance surface is a confident green tick on an
 * asset nobody examined. So there are THREE states and never two:
 *
 *   cleared    — a completed release says so, and names the instrument
 *   restricted — a release says notAllowed or constrained, or was withdrawn
 *   unknown    — nobody asked. **Not a failure and not a pass.**
 *
 * This is the same discipline as `watchEvidence`: speak only from positive
 * evidence, and never let absence render as an answer.
 *
 * ── NOT `server-only`, ON PURPOSE ───────────────────────────────────────
 *
 * `lib/approvalIntel.ts`'s precedent: a server page and a client component both
 * need the same answer, and two renderings of a clearance are two things that
 * can disagree. `assess` is pure; `clearanceFor` takes whatever SupabaseClient
 * the caller holds, so calling it from the browser is RLS-scoped exactly as
 * calling it from a route is. Nothing here touches the service role, so there
 * is nothing for the marker to protect.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────
 *
 * It is not a C2PA manifest writer. `contentauth/c2pa-rs` (Apache-2.0 / MIT dual)
 * and the `c2pa` npm package (MIT, MIT dependencies) were audited and are clean;
 * `contentauth/c2pa-node` is ARCHIVED and must not be adopted. They are not
 * installed because they read and write manifests EMBEDDED IN BINARY ASSETS, and
 * nothing in this product embeds one yet. CLAUDE.md's original reason — "there is
 * no binary asset to sign" — has since stopped being true, so the reason is
 * restated rather than inherited: the embed needs `c2patool` as a queue worker
 * (0083/0084 now make that possible), and a reader installed before a writer is
 * a dependency with nothing to read. The DATA MODEL is adopted, which is what
 * makes emitting a real manifest later a serialization job rather than a
 * migration.
 */

export type TrainingPermission = 'allowed' | 'notAllowed' | 'constrained'
export type ClearanceState = 'cleared' | 'restricted' | 'unknown'

export type RightsRow = {
  file_id: string
  license: string | null
  commercial_ok: boolean
  talent_consent: boolean
  expires_at: string | null
  notes: string | null
  data_mining: TrainingPermission
  ai_inference: TrainingPermission
  ai_generative_training: TrainingPermission
}

export type ProvenanceMark = {
  action: string
  digital_source_type: string | null
  model: string | null
  created_at: string
}

export type Clearance = {
  fileId: string
  state: ClearanceState
  /** True only where a rights row exists AND says so. */
  talentConsent: boolean
  aiTraining: TrainingPermission | null
  expired: boolean
  /** The instrument, where one is named. */
  license: string | null
  /** AI generation recorded against this asset (0064). Empty is not "none" —
   *  it is "nothing was recorded", and the sentence says which. */
  marks: ProvenanceMark[]
  /** One plain sentence, written for somebody deciding whether to publish. */
  sentence: string
}

const RIGHTS_COLUMNS =
  'file_id, license, commercial_ok, talent_consent, expires_at, notes, data_mining, ai_inference, ai_generative_training'

/**
 * Clearance for one asset, or for many.
 *
 * `db` is whatever client the caller holds — crew or client — and RLS decides.
 * 0088 reads BOTH tables through the file, so a caller who cannot see the asset
 * sees no clearance either, and neither policy has to restate the other's scope.
 */
export async function clearanceFor(
  db: SupabaseClient, fileIds: string[]
): Promise<Map<string, Clearance>> {
  const out = new Map<string, Clearance>()
  const ids = [...new Set(fileIds)].filter(Boolean).slice(0, 200)
  if (ids.length === 0) return out

  const [rightsRes, provRes] = await Promise.all([
    db.from('rights').select(RIGHTS_COLUMNS).in('file_id', ids),
    db.from('asset_provenance')
      .select('file_id, action, digital_source_type, model, created_at')
      .in('file_id', ids).order('created_at', { ascending: false }).limit(500),
  ])

  const rights = new Map(
    ((rightsRes.data ?? []) as unknown[]).map((r) => {
      const row = r as RightsRow
      return [row.file_id, row]
    })
  )
  const marks = new Map<string, ProvenanceMark[]>()
  for (const raw of (provRes.data ?? []) as unknown[]) {
    const m = raw as ProvenanceMark & { file_id: string }
    const list = marks.get(m.file_id) ?? []
    list.push({
      action: m.action,
      digital_source_type: m.digital_source_type,
      model: m.model,
      created_at: m.created_at,
    })
    marks.set(m.file_id, list)
  }

  for (const id of ids) out.set(id, assess(id, rights.get(id) ?? null, marks.get(id) ?? []))
  return out
}

export function assess(
  fileId: string, row: RightsRow | null, marks: ProvenanceMark[]
): Clearance {
  const expired = !!row?.expires_at && Date.parse(row.expires_at) < Date.now()
  const aiTraining = row?.ai_generative_training ?? null
  const generated = marks.length > 0

  // ── NO ROW IS "UNKNOWN", NEVER "CLEARED" ─────────────────────────────────
  if (!row) {
    return {
      fileId, state: 'unknown', talentConsent: false, aiTraining: null,
      expired: false, license: null, marks,
      sentence: generated
        ? 'AI generation is recorded against this asset and no release covers it. Nobody has cleared it.'
        : 'No release has been recorded against this asset. That is not the same as cleared — nobody has asked.',
    }
  }

  if (expired) {
    return {
      fileId, state: 'restricted', talentConsent: false, aiTraining,
      expired: true, license: row.license, marks,
      sentence: `The ${row.license ? `${row.license.replace(/_/g, ' ')} release` : 'release'} covering this asset expired on ${
        new Date(row.expires_at!).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        })
      }. It no longer clears anything.`,
    }
  }

  // A withdrawn or declined release leaves the row saying no (0079). That is a
  // RESTRICTION, and it must read as one rather than as an absence.
  if (!row.commercial_ok || (!row.talent_consent && row.license && isPersonal(row.license))) {
    return {
      fileId, state: 'restricted', talentConsent: row.talent_consent, aiTraining,
      expired: false, license: row.license, marks,
      sentence: row.notes?.includes('was voided') || row.notes?.includes('was declined')
        ? 'The release covering this asset was withdrawn. It does not clear anything, and the record says so rather than going quiet.'
        : 'The release covering this asset does not grant the permissions needed to publish it.',
    }
  }

  const parts: string[] = []
  parts.push(
    row.license
      ? `Cleared by a signed ${row.license.replace(/_/g, ' ')} release.`
      : 'Cleared.'
  )
  if (isPersonal(row.license) && row.talent_consent) {
    parts.push('The performer consented to their appearance.')
  }
  // THE SENTENCE THE DISCLOSURE LAWS ASK FOR. Stated whatever the value,
  // because "notAllowed" is the default and a silent default is how somebody
  // ends up training on a face that never agreed to it.
  parts.push(
    aiTraining === 'allowed'
      ? 'AI training on it is permitted.'
      : aiTraining === 'constrained'
        ? 'AI training on it is permitted only under the stated constraints.'
        : 'AI training on it is NOT permitted.'
  )
  if (generated) {
    parts.push(
      `${marks.length} AI generation${marks.length === 1 ? '' : 's'} recorded against it — this asset needs a disclosure where it runs.`
    )
  }

  return {
    fileId,
    // A cleared asset that CONTAINS generated material is still cleared, and
    // still carries a publication obligation. Two different facts; the sentence
    // carries both rather than collapsing them into a colour.
    state: 'cleared',
    talentConsent: row.talent_consent,
    aiTraining, expired: false, license: row.license, marks,
    sentence: parts.join(' '),
  }
}

/** The two instruments that carry a person's likeness. A location agreement and
 *  a music licence carry none and must never assert one — 0079's own rule, read
 *  back the same way it was written. */
function isPersonal(license: string | null): boolean {
  return license === 'appearance' || license === 'ai_likeness'
}

export const CLEARANCE_LABEL: Record<ClearanceState, string> = {
  cleared: 'Cleared',
  restricted: 'Restricted',
  unknown: 'Not cleared',
}
