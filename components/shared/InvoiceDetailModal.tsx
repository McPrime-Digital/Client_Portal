'use client'

import { X, CreditCard, ExternalLink, Receipt, FileText } from 'lucide-react'

// A loosely-typed invoice so this modal can be reused by the client hub, the
// admin hub, and the in-project invoice tab — each carries a slightly different
// shape. Everything is read defensively.
type AnyInvoice = {
  id: string
  invoice_number?: string | null
  title?: string | null
  amount: number
  currency?: string | null
  status: string
  due_date?: string | null
  paid_at?: string | null
  created_at?: string | null
  notes?: string | null
  line_items?: { description: string; quantity?: number; unit_price?: number; total?: number }[] | null
  stripe_payment_url?: string | null
  receipt_file_id?: string | null
  receipt_uploaded_by?: string | null
  projects?: { title?: string | null; type?: string | null } | null
  clients?: { name?: string | null; company?: string | null } | null
}

const STATUS_TINT: Record<string, string> = {
  paid: 'hsl(var(--status-green))',
  unpaid: 'hsl(var(--primary))',
  overdue: 'hsl(var(--destructive))',
  partial: 'hsl(var(--status-blue))',
  draft: 'hsl(var(--muted-foreground))',
}

function money(amount: number, currency?: string | null) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency || '$'}${amount}`
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function InvoiceDetailModal({
  invoice,
  onClose,
  onViewReceipt,
}: {
  invoice: AnyInvoice
  onClose: () => void
  onViewReceipt?: (fileId: string, name: string) => void
}) {
  const tint = STATUS_TINT[invoice.status] ?? 'hsl(var(--muted-foreground))'
  const items = invoice.line_items ?? []
  const computedSubtotal = items.reduce(
    (a, it) => a + (it.total ?? (it.quantity ?? 1) * (it.unit_price ?? 0)),
    0
  )

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'hsl(var(--background) / 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-y-auto scrollbar-thin rounded-2xl shadow-2xl"
        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 p-5 sticky top-0 z-10"
          style={{ backgroundColor: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold truncate" style={{ color: 'hsl(var(--foreground))' }}>
                {invoice.title || 'Invoice'}
              </h2>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}
              >
                {invoice.status}
              </span>
            </div>
            {invoice.invoice_number && (
              <p className="text-xs font-mono mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>
                #{invoice.invoice_number}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg flex-shrink-0 transition-colors hover:bg-[hsl(var(--secondary))]"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Amount */}
          <div>
            <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Total amount</p>
            <p className="font-display text-3xl font-bold tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
              {money(Number(invoice.amount), invoice.currency)}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(invoice.clients?.name) && (
              <Meta label="Billed to" value={`${invoice.clients.name}${invoice.clients.company ? ` · ${invoice.clients.company}` : ''}`} />
            )}
            {invoice.projects?.title && (
              <Meta label="Project" value={invoice.projects.title} />
            )}
            <Meta label="Issued" value={fmtDate(invoice.created_at)} />
            <Meta label="Due" value={fmtDate(invoice.due_date)} />
            {invoice.paid_at && <Meta label="Paid" value={fmtDate(invoice.paid_at)} />}
          </div>

          {/* Line items */}
          {items.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'hsl(var(--text-faint))' }}>
                Line items
              </p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid hsl(var(--border))' }}>
                {items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    style={{ borderBottom: i < items.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                  >
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: 'hsl(var(--foreground))' }}>{it.description}</p>
                      {(it.quantity != null && it.unit_price != null) && (
                        <p className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
                          {it.quantity} × {money(it.unit_price, invoice.currency)}
                        </p>
                      )}
                    </div>
                    <span className="font-medium tabular-nums flex-shrink-0" style={{ color: 'hsl(var(--foreground))' }}>
                      {money(it.total ?? (it.quantity ?? 1) * (it.unit_price ?? 0), invoice.currency)}
                    </span>
                  </div>
                ))}
                <div
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold"
                  style={{ backgroundColor: 'hsl(var(--secondary))' }}
                >
                  <span style={{ color: 'hsl(var(--foreground))' }}>Total</span>
                  <span className="tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                    {money(computedSubtotal || Number(invoice.amount), invoice.currency)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'hsl(var(--text-faint))' }}>
                Notes
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {invoice.notes}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {invoice.stripe_payment_url && invoice.status !== 'paid' && (
              <a
                href={invoice.stripe_payment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                <CreditCard size={14} /> Pay now <ExternalLink size={12} />
              </a>
            )}
            {invoice.receipt_file_id && onViewReceipt && (
              <button
                type="button"
                onClick={() =>
                  onViewReceipt(
                    invoice.receipt_file_id!,
                    invoice.receipt_uploaded_by === 'admin' ? 'Proof of payment' : 'Receipt'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium"
                style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}
              >
                <Receipt size={13} />
                {invoice.receipt_uploaded_by === 'admin' ? 'View proof of payment' : 'View receipt'}
              </button>
            )}
            {!invoice.stripe_payment_url && !invoice.receipt_file_id && (
              <p className="flex items-center gap-1.5 text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
                <FileText size={12} /> Full invoice details
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</p>
      <p className="font-medium mt-0.5 break-words" style={{ color: 'hsl(var(--foreground))' }}>{value}</p>
    </div>
  )
}
