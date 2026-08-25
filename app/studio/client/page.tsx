import { redirect } from 'next/navigation'

// Client space: Overview is the first point of contact — never a card grid.
export default function ClientSpaceIndex() {
  redirect('/studio/client/overview')
}
