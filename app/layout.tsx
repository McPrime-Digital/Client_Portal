import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Space_Grotesk } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/ThemeProvider'
import './globals.css'
import { PRODUCT_NAME } from '@/lib/product'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

// The PRODUCT's metadata, and only a fallback: one root layout serves the
// studio, the pre-auth pages and the portal, and those are three different
// identities (S0-B §3). The portal overrides this with the tenant's name in
// app/(portal)/layout.tsx; the studio overrides it below with its own.
//
// This therefore still governs the pre-auth pages (/login, /reset-password,
// /set-password) — which is the open question item 2 stopped on, not a
// decision made here.
export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: `${PRODUCT_NAME} — the studio OS for film and media production.`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-body antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
