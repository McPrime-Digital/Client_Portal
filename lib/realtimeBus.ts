'use client'

// Tiny module-level coordinator between the always-mounted PresencePulse and
// the messaging hubs. A hub owns one Supabase broadcast channel per thread
// (`thread:${projectId}`). The shared browser Supabase client is a singleton,
// so two subscriptions to the *same* topic on the same socket collide. When a
// hub is mounted it handles delivery receipts for all its threads itself, so
// PresencePulse must NOT also create those channels — it only steps in (for the
// app-wide "delivered" receipt) when no hub is open. This refcount lets it tell.
// Shape of a `message` broadcast on a thread channel — just enough to update a
// thread-list row instantly without a refetch.
export type ThreadMessagePayload = {
  projectId?: string
  messageId?: string
  senderRole?: 'admin' | 'client'
  senderName?: string
  body?: string | null
  attachmentName?: string | null
  createdAt?: string
}

let hubMountCount = 0

export function acquireHub(): void {
  hubMountCount += 1
}

export function releaseHub(): void {
  hubMountCount = Math.max(0, hubMountCount - 1)
}

export function isHubMounted(): boolean {
  return hubMountCount > 0
}
