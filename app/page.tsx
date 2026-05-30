import { redirect } from 'next/navigation'

export default function Page() {
  // Root has no landing content yet. Send everyone into the auth flow;
  // proxy.ts forwards already-logged-in users from /login to their role home.
  redirect('/login')
}
