import ProductMark from '@/components/ProductMark'

type Props = {
  /** Everything inside the card. */
  children: React.ReactNode
  /**
   * Rendered under the card, outside it — "forgot your password?", "back to
   * sign in". Kept out of `children` so it sits on the page background rather
   * than inside the panel, which is where a secondary action belongs.
   */
  footer?: React.ReactNode
  /** Widen for a form with more than a couple of fields. */
  width?: 'sm' | 'md'
}

/**
 * The frame every pre-auth screen sits in: product mark centred above, content
 * in a single card below.
 *
 * WHY IT IS A COMPONENT AND NOT THREE COPIES. `/login` had the card; the
 * set-password and reset-password screens did not — their content sat directly
 * on the page background with the mark shoved into the top-left corner, so the
 * first thing an invited client saw after clicking through was visibly a
 * different product from the one they signed into afterwards. Three
 * near-identical layouts would drift again, so there is one.
 *
 * The mark is the PRODUCT's, and stays so: these pages run before a session
 * exists, so there is no tenant to resolve (S0-B §2, Batch 9.7). The tenant's
 * brand starts at the first authenticated screen.
 */
export default function AuthShell({ children, footer, width = 'sm' }: Props) {
  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center px-4 py-12">
      {/* Depth behind the card, not on it. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.04] blur-[120px]" />
      </div>

      <div
        className={`relative flex w-full flex-col items-center ${
          width === 'md' ? 'max-w-[480px]' : 'max-w-[420px]'
        }`}
      >
        <div className="mb-8">
          <ProductMark size={64} showName />
        </div>

        <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-black/20">
          {children}
        </div>

        {footer && <div className="mt-6 w-full text-center">{footer}</div>}
      </div>
    </div>
  )
}
