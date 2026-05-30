'use client'

import {
  CreditCard,
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  Receipt,
  DollarSign,
} from 'lucide-react'

type Invoice = {
  id: string
  client_id: string
  project_id: string | null
  title: string
  amount: number
  status: 'unpaid' | 'paid' | 'overdue' | 'partial'
  due_date: string | null
  paid_at: string | null
  stripe_payment_url: string | null
  invoice_number: string | null
  notes: string | null
  created_at: string
  projects: {
    id: string
    title: string
    type: string
  } | null
}

type Props = {
  invoices: Invoice[]
  clientName: string
}

function StatusChip({ status }: { status: Invoice['status'] }) {
  const map = {
    unpaid: {
      label: 'Unpaid',
      bg: 'hsl(var(--primary) / 0.12)',
      color: 'hsl(var(--primary))',
      icon: Clock,
    },
    paid: {
      label: 'Paid',
      bg: 'hsl(var(--status-green) / 0.12)',
      color: 'hsl(var(--status-green))',
      icon: CheckCircle,
    },
    overdue: {
      label: 'Overdue',
      bg: 'hsl(var(--destructive) / 0.12)',
      color: 'hsl(var(--destructive))',
      icon: AlertCircle,
    },
    partial: {
      label: 'Partial',
      bg: 'hsl(var(--status-blue) / 0.12)',
      color: 'hsl(var(--status-blue))',
      icon: Clock,
    },
  }

  const s = map[status] ?? map.unpaid
  const Icon = s.icon

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1 
      rounded-full text-xs font-semibold"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      <Icon size={11} />
      {s.label}
    </div>
  )
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export default function InvoicesClient({
  invoices,
  clientName,
}: Props) {
  const unpaid = invoices.filter(
    (i) => i.status === 'unpaid' || i.status === 'overdue'
  )
  const paid = invoices.filter((i) => i.status === 'paid')
  const partial = invoices.filter((i) => i.status === 'partial')

  const totalOutstanding = unpaid.reduce(
    (acc, i) => acc + i.amount,
    0
  )
  const totalPaid = paid.reduce((acc, i) => acc + i.amount, 0)

  return (
    <div className="space-y-8 max-w-[860px]">
      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Invoices
        </h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {invoices.length} invoice
          {invoices.length !== 1 ? 's' : ''} total
        </p>
      </div>

      {/* Summary cards */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center 
              justify-center mb-4"
              style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}
            >
              <DollarSign size={18}
                style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <div
              className="font-display text-2xl font-bold 
              tabular-nums"
              style={{
                color: totalOutstanding > 0
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--status-green))',
              }}
            >
              {formatCurrency(totalOutstanding)}
            </div>
            <div className="text-xs mt-1"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              Outstanding balance
            </div>
          </div>
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center 
              justify-center mb-4"
              style={{ backgroundColor: 'hsl(var(--status-green) / 0.1)' }}
            >
              <CheckCircle size={18}
                style={{ color: 'hsl(var(--status-green))' }} />
            </div>
            <div
              className="font-display text-2xl font-bold 
              tabular-nums"
              style={{ color: 'hsl(var(--status-green))' }}
            >
              {formatCurrency(totalPaid)}
            </div>
            <div className="text-xs mt-1"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              Total paid to date
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {invoices.length === 0 && (
        <div
          className="flex flex-col items-center justify-center 
          py-20 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <Receipt size={40} style={{ color: 'hsl(var(--text-faint))' }} />
          <p
            className="text-base font-semibold mt-4"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            No invoices yet
          </p>
          <p className="text-sm mt-1"
            style={{ color: 'hsl(var(--text-faint))' }}>
            Your invoices from McPrime Digital will appear here
          </p>
        </div>
      )}

      {/* Unpaid / Overdue — action required */}
      {(unpaid.length > 0 || partial.length > 0) && (
        <div>
          <h2
            className="text-xs font-semibold uppercase 
            tracking-widest mb-4"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            Action Required
          </h2>
          <div className="space-y-3">
            {[...unpaid, ...partial].map((invoice) => (
              <div
                key={invoice.id}
                className="p-5 rounded-xl"
                style={{
                  backgroundColor: 'hsl(var(--card))',
                  border: invoice.status === 'overdue'
                    ? '1px solid hsl(var(--destructive) / 0.3)'
                    : '1px solid hsl(var(--border))',
                }}
              >
                <div className="flex items-start justify-between 
                  gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    {/* Invoice number */}
                    {invoice.invoice_number && (
                      <p
                        className="text-xs mb-1"
                        style={{ color: 'hsl(var(--text-faint))' }}
                      >
                        #{invoice.invoice_number}
                      </p>
                    )}
                    <h3
                      className="font-semibold text-base"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {invoice.title}
                    </h3>
                    {invoice.projects && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: 'hsl(var(--muted-foreground))' }}
                      >
                        {invoice.projects.title} ·{' '}
                        {invoice.projects.type}
                      </p>
                    )}
                    {invoice.notes && (
                      <p
                        className="text-sm mt-2 leading-relaxed"
                        style={{ color: 'hsl(var(--muted-foreground))' }}
                      >
                        {invoice.notes}
                      </p>
                    )}
                    <div className="flex items-center gap-4 
                      mt-3 flex-wrap">
                      <StatusChip status={invoice.status} />
                      {invoice.due_date && (
                        <span
                          className="text-xs"
                          style={{
                            color:
                              invoice.status === 'overdue'
                                ? 'hsl(var(--destructive))'
                                : 'hsl(var(--muted-foreground))',
                          }}
                        >
                          Due{' '}
                          {new Date(
                            invoice.due_date
                          ).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount + Pay button */}
                  <div className="flex flex-col items-end gap-3">
                    <div
                      className="font-display text-2xl 
                      font-bold tabular-nums"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {formatCurrency(invoice.amount)}
                    </div>
                    {invoice.stripe_payment_url && (
                      <a
                        href={invoice.stripe_payment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 
                        px-5 py-2.5 rounded-lg text-sm 
                        font-semibold transition-all"
                        style={{
                          backgroundColor: 'hsl(var(--primary))',
                          color: 'hsl(var(--primary-foreground))',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'hsl(var(--primary))'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'hsl(var(--primary))'
                        }}
                      >
                        <CreditCard size={14} />
                        Pay Now
                        <ExternalLink size={12} />
                      </a>
                    )}
                    {!invoice.stripe_payment_url && (
                      <p
                        className="text-xs"
                        style={{ color: 'hsl(var(--text-faint))' }}
                      >
                        Contact us to pay
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paid history */}
      {paid.length > 0 && (
        <div>
          <h2
            className="text-xs font-semibold uppercase 
            tracking-widest mb-4"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            Payment History
          </h2>
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            {paid.map((invoice, index) => (
              <div
                key={invoice.id}
                className="flex items-center gap-4 px-5 py-4"
                style={{
                  borderBottom:
                    index < paid.length - 1
                      ? '1px solid hsl(var(--border))'
                      : 'none',
                  opacity: 0.7,
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center 
                  justify-center flex-shrink-0"
                  style={{
                    backgroundColor: 'hsl(var(--status-green) / 0.1)',
                  }}
                >
                  <CheckCircle size={15}
                    style={{ color: 'hsl(var(--status-green))' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {invoice.title}
                  </p>
                  <p className="text-xs mt-0.5"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {invoice.projects?.title &&
                      `${invoice.projects.title} · `}
                    {invoice.paid_at
                      ? `Paid ${new Date(
                          invoice.paid_at
                        ).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}`
                      : 'Paid'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p
                    className="text-sm font-semibold 
                    tabular-nums"
                    style={{ color: 'hsl(var(--status-green))' }}
                  >
                    {formatCurrency(invoice.amount)}
                  </p>
                  <StatusChip status="paid" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
