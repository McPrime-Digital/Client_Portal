'use client'

/**
 * WHERE a person is, not just whether they are here — item 6.
 *
 * "Online" answers the wrong question in a product where one room has several
 * views. What a studio actually wants to know before typing is whether the
 * client is READING THIS CONVERSATION or merely signed in somewhere:
 *
 *   · in this room's All view        → "in All"
 *   · in a project view of this room → "in AMP"
 *   · signed in, but on overview,
 *     invoices, anywhere else        → "online"
 *
 * ── WHY A MODULE AND NOT A PROP ─────────────────────────────────────────────
 * The thing that KNOWS the current view (RoomThread) and the thing that
 * BROADCASTS presence (PresencePulse) sit in different subtrees, mounted by
 * different layouts, with no common ancestor that owns this state. Threading a
 * prop between them would mean lifting messaging state into both layouts.
 *
 * So the view is written here and read at track time. It is a single value per
 * tab because a tab shows one conversation at a time — which is also why the
 * setter is last-writer-wins rather than a stack.
 *
 * Presence is a HINT. A stale value costs someone a slightly wrong subtitle;
 * it is never authorization, and nothing reads it to decide access.
 */

export type PresenceView =
  | { kind: 'none' }
  | { kind: 'all'; clientId: string }
  | { kind: 'project'; clientId: string; projectId: string }

let current: PresenceView = { kind: 'none' }

/** Fires when the view changes, so PresencePulse can re-track immediately
 *  instead of waiting for its next heartbeat. */
export const PRESENCE_VIEW_EVENT = 'genreline:presence-view'

export function setPresenceView(v: PresenceView): void {
  if (typeof window === 'undefined') return
  const same =
    current.kind === v.kind &&
    (v.kind === 'none' ||
      (current as { clientId?: string }).clientId === v.clientId) &&
    (v.kind !== 'project' ||
      (current as { projectId?: string }).projectId === v.projectId)
  if (same) return
  current = v
  window.dispatchEvent(new Event(PRESENCE_VIEW_EVENT))
}

export function presenceView(): PresenceView {
  return current
}

/** Clear on unmount so a closed conversation stops claiming someone is in it. */
export function clearPresenceView(clientId: string): void {
  if (current.kind !== 'none' && current.clientId === clientId) {
    setPresenceView({ kind: 'none' })
  }
}

/**
 * What to show for one other participant, from the viewer's own room.
 * Returns null when they are not present at all.
 */
export function describePresence(
  entry: { view?: PresenceView | null } | undefined,
  myClientId: string,
  projectTitle: (id: string) => string | undefined
): string | null {
  if (!entry) return null
  const v = entry.view
  if (!v || v.kind === 'none') return 'Online'
  if (v.clientId !== myClientId) return 'Online'
  if (v.kind === 'all') return 'In All'
  return `In ${projectTitle(v.projectId) ?? 'a project'}`
}
