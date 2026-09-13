'use client'

import { usePathname } from 'next/navigation'

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
