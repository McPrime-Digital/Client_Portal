import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { userRole } from '@/lib/auth/role'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // These routes ALWAYS pass through — no auth check
  const publicRoutes = [
    '/login',
    '/reset-password',
    '/set-password',    // ← critical: never redirect this
    '/auth/callback',   // ← for OAuth if added later
  ]

  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  )

  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/studio')
  const isPortalRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/approvals') ||
    pathname.startsWith('/files') ||
    pathname.startsWith('/messages') ||
    pathname.startsWith('/invoices')

  // Always let public routes through untouched
  if (isPublicRoute) {
    return supabaseResponse
  }

  // Legacy /admin chrome is retired — every old admin URL maps to its
  // Throughline home (deep segments and query strings preserved). The /studio
  // gate below still enforces auth + role after the redirect.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const rest = pathname.slice('/admin'.length)
    const legacyMap: [string, string][] = [
      ['/clients', '/studio/client/companies'],
      ['/projects', '/studio/client/projects'],
      ['/files', '/studio/client/files'],
      ['/messages', '/studio/client/messages'],
      ['/invoices', '/studio/client/invoices'],
      ['/settings', '/studio/crew/settings'],
      ['/dashboard', '/studio/client/overview'],
    ]
    const hit = legacyMap.find(([p]) => rest === p || rest.startsWith(p + '/'))
    const url = request.nextUrl.clone()
    url.pathname = hit ? hit[1] + rest.slice(hit[0].length) : '/studio/client/overview'
    return NextResponse.redirect(url)
  }

  // Not logged in trying to access protected route
  if (!user && (isAdminRoute || isPortalRoute)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Admin trying to access client portal — send to the Throughline studio home
  if (user && isPortalRoute) {
    const role = userRole(user)
    if (role === 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      return NextResponse.redirect(url)
    }
  }

  // Client trying to access admin panel
  if (user && isAdminRoute) {
    const role = userRole(user)
    if (role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Logged in hitting login page — send to right place
  if (user && pathname === '/login') {
    const role = userRole(user)
    const url = request.nextUrl.clone()
    url.pathname = role === 'admin' ? '/studio' : '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
