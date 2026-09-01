import 'server-only'

/**
 * Keyset cursor — Batch 15 item 2, I-1's first real consumer.
 *
 * THE pagination helper: messages use it now; files, tasks and activity copy
 * it later, which is exactly why it is extracted — three divergent cursor
 * implementations is the outcome to avoid.
 *
 * The cursor is `(created_at, id)`, matching `messages_room_keyset_idx`
 * (0030). NEVER offset: OFFSET re-scans everything it skips and degrades as
 * the table grows — the failure I-1 exists to prevent. The wire form is
 * opaque base64url JSON, validated on the way in; a malformed cursor is a
 * 400, not a guess.
 */

export type KeysetCursor = { t: string; id: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

/** null in → null out (no cursor). Malformed in → throws; the route 400s. */
export function decodeCursor(raw: string | null): KeysetCursor | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Malformed cursor')
  }
  const c = parsed as Partial<KeysetCursor>
  if (
    typeof c?.t !== 'string' ||
    typeof c?.id !== 'string' ||
    Number.isNaN(Date.parse(c.t)) ||
    !UUID_RE.test(c.id)
  ) {
    throw new Error('Malformed cursor')
  }
  return { t: c.t, id: c.id }
}

/**
 * PostgREST tuple-comparison for "strictly older than the cursor row",
 * descending walk: (created_at, id) < (t, id).
 */
export function beforePredicate(c: KeysetCursor): string {
  return `created_at.lt.${c.t},and(created_at.eq.${c.t},id.lt.${c.id})`
}
