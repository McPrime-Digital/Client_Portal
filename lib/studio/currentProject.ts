'use client'

import { usePathname, useSearchParams } from 'next/navigation'

/**
 * THE PRODUCTION THE READER IS STANDING ON, from the URL.
 *
 * Used to allocate AI spend to a job (0062). The dock rides every studio page,
 * so the route is the only thing that knows which production is on screen —
 * threading a prop down through every surface that might host the assistant
 * would be the same fact restated in a dozen places, and the first one to go
 * stale would silently bill the wrong client.
 *
 * IT IS A HINT, NOT AN AUTHORITY. The route handler re-reads the id on the USER
 * client before it allocates anything, so a caller that sends a production they
 * cannot see gets their spend recorded UNALLOCATED rather than misallocated.
 * That check is the control; this is the convenience.
 *
 * Returns null off a production page, which is the common case and the correct
 * one: AI used on the craft floor with no job in scope is genuinely unallocated,
 * and inventing an attribution would put real money on the wrong invoice.
 */
const PROJECT_ROUTE = /^\/studio\/client\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/

export function useCurrentProjectId(): string | null {
  const pathname = usePathname()
  return PROJECT_ROUTE.exec(pathname ?? '')?.[1] ?? null
}

/**
 * THE DOCUMENT THE READER IS EDITING, from the URL.
 *
 * Same argument as the production above, for the same reason: the assistant
 * rides a dock that is mounted once, so the route is the only thing that knows
 * which script is open. `ScriptDesign` already reads `?doc=` this way, so this
 * is the existing contract rather than a new one.
 *
 * Used to attach CONTENT PROVENANCE (0064) to accepted generations. Like the
 * production id it is A HINT, NOT AN AUTHORITY — the route re-validates it
 * against RLS on the user client, so a caller naming a document they cannot see
 * gets a refusal rather than a forged disclosure on somebody else's script.
 *
 * Returns null off the editor, which is correct: AI used in a chat with no
 * document open changes no artifact and has nothing to disclose.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function useCurrentDocId(): string | null {
  const params = useSearchParams()
  const id = params.get('doc')
  return id && UUID.test(id) ? id : null
}
