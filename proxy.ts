import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  const isAdminRoute = pathname.startsWith('/admin')
  const isPortalRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/files') ||
    pathname.startsWith('/messages') ||
    pathname.startsWith('/invoices')

  // Always let public routes through untouched
  if (isPublicRoute) {
    return supabaseResponse
  }

  // Not logged in trying to access protected route
  if (!user && (isAdminRoute || isPortalRoute)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Admin trying to access client portal
  if (user && isPortalRoute) {
    const role = user.user_metadata?.role
    if (role === 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }
  }

  // Client trying to access admin panel
  if (user && isAdminRoute) {
    const role = user.user_metadata?.role
    if (role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Logged in hitting login page — send to right place
  if (user && pathname === '/login') {
    const role = user.user_metadata?.role
    const url = request.nextUrl.clone()
    url.pathname = role === 'admin' ? '/admin' : '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
