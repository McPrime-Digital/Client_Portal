'use client'

import { useState } from 'react'
import {
  DollarSign,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react'

type Invoice = {
  id: string
  invoice_number: string
  title: string
  amount: number
  status: string
  due_date: string | null
  paid_at: string | null
  stripe_payment_url: string | null
  line_items: any[]
  notes: string | null
  created_at: string
  projects: {
    id: string
    title: string
  } | null
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(
    'en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }
  )
}

const STATUS_CONFIG: Record<string, {
  label: string
  color: string
  bg: string
  icon: any
}> = {
  unpaid: {
    label: 'Payment Due',
    color: 'hsl(var(--primary))',
    bg: 'hsl(var(--primary) / 0.08)',
    icon: Clock,
  },
  overdue: {
    label: 'Overdue',
    color: 'hsl(var(--destructive))',
    bg: 'hsl(var(--destructive) / 0.08)',
    icon: AlertCircle,
  },
  paid: {
    label: 'Paid',
    color: 'hsl(var(--status-green))',
    bg: 'hsl(var(--status-green) / 0.08)',
    icon: CheckCircle,
  },
}

export default function ClientInvoices({
  invoices,
}: {
  invoices: Invoice[]
}) {
  const [expanded, setExpanded] =
    useState<string | null>(null)

  const unpaid = invoices.filter((i) =>
    ['unpaid', 'overdue'].includes(i.status)
  )
  const paid = invoices.filter(
    (i) => i.status === 'paid'
  )

  const totalOwed = unpaid.reduce(
    (acc, i) => acc + Number(i.amount),
    0
  )

  return (
    <div className="space-y-6 max-w-[720px]">

      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Invoices
        </h1>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Your billing history and outstanding payments
        </p>
      </div>

      {/* Outstanding banner */}
      {totalOwed > 0 && (
        <div
          className="p-5 rounded-2xl"
          style={{
            backgroundColor:
              unpaid.some(
                (i) => i.status === 'overdue'
              )
                ? 'hsl(var(--destructive) / 0.06)'
                : 'hsl(var(--primary) / 0.06)',
            border: unpaid.some(
              (i) => i.status === 'overdue'
            )
              ? '1px solid hsl(var(--destructive) / 0.2)'
              : '1px solid hsl(var(--primary) / 0.2)',
          }}
        >
          <div className="flex items-center
            justify-between gap-4 flex-wrap">
            <div>
              <p
                className="text-xs font-semibold
                uppercase tracking-wider"
                style={{
                  color: unpaid.some(
                    (i) => i.status === 'overdue'
                  )
                    ? 'hsl(var(--destructive))'
                    : 'hsl(var(--primary))',
                }}
              >
                {unpaid.some(
                  (i) => i.status === 'overdue'
                )
                  ? 'Overdue Balance'
                  : 'Outstanding Balance'}
              </p>
              <p
                className="font-display text-3xl
                font-bold tabular-nums mt-1"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                {formatCurrency(totalOwed)}
              </p>
              {unpaid.length > 1 && (
                <p className="text-xs mt-1"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {unpaid.length} invoices pending
                </p>
              )}
            </div>

            {/* Primary pay button for
                first unpaid invoice */}
            {unpaid[0]?.stripe_payment_url && (
              <a
                href={
                  unpaid[0].stripe_payment_url
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2
                px-6 py-3.5 rounded-xl font-semibold
                text-sm transition-all"
                style={{
                  backgroundColor: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--primary))'
                  e.currentTarget.style.transform
                    = 'translateY(-1px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--primary))'
                  e.currentTarget.style.transform
                    = 'translateY(0)'
                }}
              >
                <DollarSign size={15} />
                Pay Now
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* All invoices */}
      {invoices.length === 0 && (
        <div
          className="flex flex-col items-center
          justify-center py-16 rounded-2xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <FileText size={32}
            style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-4"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            No invoices yet
          </p>
        </div>
      )}

      <div className="space-y-3">
        {invoices.map((invoice) => {
          const cfg =
            STATUS_CONFIG[invoice.status]
          const isExpanded = expanded === invoice.id
          const StatusIcon = cfg?.icon ?? FileText

          return (
            <div
              key={invoice.id}
              className="card-interactive rounded-2xl overflow-hidden"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: invoice.status === 'overdue'
                  ? '1px solid hsl(var(--destructive) / 0.2)'
                  : '1px solid hsl(var(--border))',
              }}
            >
              {/* Invoice row */}
              <button
                onClick={() =>
                  setExpanded(
                    isExpanded ? null : invoice.id
                  )
                }
                className="w-full flex items-center
                gap-4 p-5 text-left transition-all"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--secondary))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'transparent'
                }}
              >
                {/* Status icon */}
                <div
                  className="w-10 h-10 rounded-xl
                  flex items-center justify-center
                  flex-shrink-0"
                  style={{
                    backgroundColor:
                      cfg?.bg ?? 'transparent',
                  }}
                >
                  <StatusIcon size={17}
                    style={{
                      color: cfg?.color ?? 'hsl(var(--muted-foreground))',
                    }}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0
                  text-left">
                  <div className="flex items-center
                    gap-2 flex-wrap">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {invoice.title}
                    </p>
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: 'hsl(var(--text-faint))' }}
                    >
                      {invoice.invoice_number}
                    </span>
                  </div>
                  <div className="flex items-center
                    gap-3 mt-1">
                    {invoice.projects && (
                      <p className="text-xs"
                        style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {invoice.projects.title}
                      </p>
                    )}
                    {invoice.due_date &&
                      invoice.status !== 'paid' && (
                        <p
                          className="text-xs"
                          style={{
                            color:
                              invoice.status ===
                              'overdue'
                                ? 'hsl(var(--destructive))'
                                : 'hsl(var(--muted-foreground))',
                          }}
                        >
                          Due{' '}
                          {formatDate(
                            invoice.due_date
                          )}
                        </p>
                      )}
                    {invoice.paid_at && (
                      <p className="text-xs"
                        style={{ color: 'hsl(var(--status-green))' }}>
                        Paid{' '}
                        {formatDate(invoice.paid_at)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Amount + status */}
                <div className="text-right
                  flex-shrink-0">
                  <p
                    className="font-display text-xl
                    font-bold tabular-nums"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {formatCurrency(
                      Number(invoice.amount)
                    )}
                  </p>
                  <span
                    className="text-[10px] font-bold"
                    style={{
                      color: cfg?.color ?? 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {cfg?.label ?? invoice.status}
                  </span>
                </div>
              </button>

              {/* Expanded — line items +
                  pay button */}
              {isExpanded && (
                <div
                  className="px-5 pb-5 space-y-4"
                  style={{
                    borderTop: '1px solid hsl(var(--secondary))',
                  }}
                >
                  {/* Line items */}
                  {invoice.line_items?.length > 0 && (
                    <div className="pt-4 space-y-2">
                      {invoice.line_items.map(
                        (item: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-center
                            justify-between gap-4"
                          >
                            <p className="text-sm"
                              style={{
                                color: 'hsl(var(--foreground))',
                              }}>
                              {item.description}
                            </p>
                            <div className="flex
                              items-center gap-4
                              flex-shrink-0">
                              {item.quantity > 1 && (
                                <span className="text-xs"
                                  style={{
                                    color: 'hsl(var(--text-faint))',
                                  }}>
                                  ×{item.quantity}
                                </span>
                              )}
                              <span
                                className="text-sm
                                font-semibold
                                tabular-nums"
                                style={{
                                  color: 'hsl(var(--foreground))',
                                }}
                              >
                                {formatCurrency(
                                  item.total ??
                                  item.unit_price
                                )}
                              </span>
                            </div>
                          </div>
                        )
                      )}
                      <div
                        className="flex items-center
                        justify-between pt-3"
                        style={{
                          borderTop:
                            '1px solid hsl(var(--secondary))',
                        }}
                      >
                        <span className="text-sm
                          font-semibold"
                          style={{
                            color: 'hsl(var(--muted-foreground))',
                          }}>
                          Total
                        </span>
                        <span
                          className="font-display
                          text-lg font-bold
                          tabular-nums"
                          style={{
                            color: 'hsl(var(--primary))',
                          }}
                        >
                          {formatCurrency(
                            Number(invoice.amount)
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {invoice.notes && (
                    <p className="text-xs leading-relaxed"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {invoice.notes}
                    </p>
                  )}

                  {/* Pay button */}
                  {invoice.stripe_payment_url &&
                    invoice.status !== 'paid' && (
                      <a
                        href={
                          invoice.stripe_payment_url
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center
                        justify-center gap-2 w-full
                        py-3.5 rounded-xl font-semibold
                        text-sm transition-all"
                        style={{
                          backgroundColor: 'hsl(var(--primary))',
                          color: 'hsl(var(--primary-foreground))',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style
                            .backgroundColor = 'hsl(var(--primary))'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style
                            .backgroundColor = 'hsl(var(--primary))'
                        }}
                      >
                        <DollarSign size={15} />
                        Pay{' '}
                        {formatCurrency(
                          Number(invoice.amount)
                        )}{' '}
                        via Stripe
                        <ExternalLink size={13} />
                      </a>
                    )}

                  {invoice.status === 'paid' && (
                    <div
                      className="flex items-center
                      justify-center gap-2 py-3"
                      style={{ color: 'hsl(var(--status-green))' }}
                    >
                      <CheckCircle size={15} />
                      <span className="text-sm
                        font-semibold">
                        Payment received —
                        thank you
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
