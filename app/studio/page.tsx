import { redirect } from 'next/navigation'

// The studio's front door opens on Crew — the team's own space — not the
// craft floor. Workspace is one click away on the deck.
export default function StudioIndex() {
  redirect('/studio/crew')
}
