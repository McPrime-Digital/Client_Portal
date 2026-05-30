'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  MoreHorizontal,
  Check,
  X,
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
  created_at: string
  clients: {
    id: string
    name: string
    company: string | null
  } | null
  projects: {
    id: string
    title: string
  } | null
}

type Summary = {
  paid: number
  outstanding: number
  overdue: number
}

const STATUS_CONFIG: Record<string, {
  label: string
  color: string
  bg: string
}> = {
  draft: {
    label: 'Draft',
    color: 'hsl(var(--muted-foreground))',
    bg: 'hsl(var(--status-gray) / 0.1)',
  },
  unpaid: {
    label: 'Unpaid',
    color: 'hsl(var(--primary))',
    bg: 'hsl(var(--primary) / 0.1)',
  },
  overdue: {
    label: 'Overdue',
    color: 'hsl(var(--destructive))',
    bg: 'hsl(var(--destructive) / 0.1)',
  },
  paid: {
    label: 'Paid',
    color: 'hsl(var(--status-green))',
    bg: 'hsl(var(--status-green) / 0.1)',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'hsl(var(--text-faint))',
    bg: 'hsl(var(--muted) / 0.1)',
  },
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
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }
  )
}

export default function AdminInvoicesList({
  invoices,
  summary,
}: {
  invoices: Invoice[]
  summary: Summary
}) {
  const supabase = createClient()
  const [filter, setFilter] = useState('all')
  const [updating, setUpdating] =
    useState<string | null>(null)
  const [localInvoices, setLocalInvoices] =
    useState(invoices)
  const [showNewForm, setShowNewForm] = useState(false)

  const filtered = useMemo(() => {
    if (filter === 'all') return localInvoices
    return localInvoices.filter(
      (i) => i.status === filter
    )
  }, [localInvoices, filter])

  const counts = useMemo(() => {
    return ['all', 'unpaid', 'overdue',
      'paid', 'draft'].reduce((acc, s) => {
      acc[s] =
        s === 'all'
          ? localInvoices.length
          : localInvoices.filter(
              (i) => i.status === s
            ).length
      return acc
    }, {} as Record<string, number>)
  }, [localInvoices])

  async function markPaid(invoiceId: string) {
    setUpdating(invoiceId)
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)

    if (!error) {
      setLocalInvoices((prev) =>
        prev.map((i) =>
          i.id === invoiceId
            ? {
                ...i,
                status: 'paid',
                paid_at: new Date().toISOString(),
              }
            : i
        )
      )
    }
    setUpdating(null)
  }

  async function markUnpaid(invoiceId: string) {
    setUpdating(invoiceId)
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'unpaid',
        paid_at: null,
      })
      .eq('id', invoiceId)

    if (!error) {
      setLocalInvoices((prev) =>
        prev.map((i) =>
          i.id === invoiceId
            ? { ...i, status: 'unpaid', paid_at: null }
            : i
        )
      )
    }
    setUpdating(null)
  }

  return (
    <div className="space-y-6 w-full">

      {/* Header */}
      <div className="flex items-center
        justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="font-display text-2xl font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Invoices
          </h1>
          <p className="text-sm mt-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {localInvoices.length} invoices total
          </p>
        </div>
        <Link
          href="/admin/invoices/new"
          className="flex items-center gap-2 px-4
          py-2.5 rounded-lg text-sm font-semibold
          transition-all"
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
          <Plus size={14} />
          New Invoice
        </Link>
      </div>

      {/* Revenue summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'Collected',
            value: formatCurrency(summary.paid),
            icon: TrendingUp,
            color: 'hsl(var(--status-green))',
            bg: 'hsl(var(--status-green) / 0.08)',
          },
          {
            label: 'Outstanding',
            value: formatCurrency(summary.outstanding),
            icon: Clock,
            color: 'hsl(var(--primary))',
            bg: 'hsl(var(--primary) / 0.08)',
          },
          {
            label: 'Overdue',
            value: formatCurrency(summary.overdue),
            icon: AlertCircle,
            color: summary.overdue > 0
              ? 'hsl(var(--destructive))'
              : 'hsl(var(--text-faint))',
            bg: summary.overdue > 0
              ? 'hsl(var(--destructive) / 0.08)'
              : 'hsl(var(--muted) / 0.08)',
          },
        ].map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="p-5 rounded-xl"
              style={{
                backgroundColor: card.bg,
                border: `1px solid color-mix(in srgb, ${card.color} 13%, transparent)`,
              }}
            >
              <div className="flex items-center
                gap-2 mb-3">
                <Icon size={15}
                  style={{ color: card.color }} />
                <span className="text-xs font-semibold
                  uppercase tracking-wider"
                  style={{ color: card.color }}>
                  {card.label}
                </span>
              </div>
              <p
                className="font-display text-2xl
                font-bold tabular-nums"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                {card.value}
              </p>
            </div>
          )
        })}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'unpaid', label: 'Unpaid' },
          { key: 'overdue', label: 'Overdue' },
          { key: 'paid', label: 'Paid' },
          { key: 'draft', label: 'Draft' },
        ].map(({ key, label }) => {
          if (key !== 'all' && counts[key] === 0)
            return null
          const isActive = filter === key
          const cfg = STATUS_CONFIG[key]

          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="flex items-center gap-1.5
              px-3 py-1.5 rounded-full text-xs
              font-medium transition-all"
              style={{
                backgroundColor: isActive
                  ? cfg?.color ?? 'hsl(var(--primary))'
                  : 'hsl(var(--card))',
                color: isActive
                  ? 'hsl(var(--primary-foreground))'
                  : 'hsl(var(--muted-foreground))',
                border: isActive
                  ? 'none'
                  : '1px solid hsl(var(--border))',
              }}
            >
              {label}
              <span
                className="font-bold"
                style={{
                  color: isActive
                    ? 'hsl(var(--primary-foreground))'
                    : 'hsl(var(--text-faint))',
                }}
              >
                {counts[key]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div
          className="flex flex-col items-center
          justify-center py-20 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <FileText size={36}
            style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-4"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            No {filter === 'all' ? '' : filter}{' '}
            invoices yet
          </p>
          <Link
            href="/admin/invoices/new"
            className="flex items-center gap-2 mt-5
            px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            <Plus size={13} />
            Create Invoice
          </Link>
        </div>
      )}

      {/* Invoice rows */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((invoice) => {
            const cfg =
              STATUS_CONFIG[invoice.status] ??
              STATUS_CONFIG.draft
            const isOverdue =
              invoice.status === 'overdue'

            return (
              <div
                key={invoice.id}
                className="card-interactive flex items-center gap-4
                p-4 rounded-xl"
                style={{
                  backgroundColor: 'hsl(var(--card))',
                  border: isOverdue
                    ? '1px solid hsl(var(--destructive) / 0.2)'
                    : '1px solid hsl(var(--border))',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--secondary))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--card))'
                }}
              >
                {/* Invoice number + icon */}
                <div
                  className="w-10 h-10 rounded-xl
                  flex items-center justify-center
                  flex-shrink-0"
                  style={{
                    backgroundColor: cfg.bg,
                  }}
                >
                  <DollarSign size={16}
                    style={{ color: cfg.color }} />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
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
                    <span
                      className="text-[10px] font-bold
                      px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: cfg.bg,
                        color: cfg.color,
                      }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center
                    gap-3 mt-1 flex-wrap">
                    <p className="text-xs"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {invoice.clients?.name}
                      {invoice.clients?.company
                        ? ` · ${invoice.clients.company}`
                        : ''}
                    </p>
                    {invoice.projects && (
                      <p className="text-xs"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {invoice.projects.title}
                      </p>
                    )}
                    {invoice.due_date && (
                      <p
                        className="text-xs"
                        style={{
                          color: isOverdue
                            ? 'hsl(var(--destructive))'
                            : 'hsl(var(--text-faint))',
                        }}
                      >
                        {isOverdue ? 'Was due ' : 'Due '}
                        {formatDate(invoice.due_date)}
                      </p>
                    )}
                    {invoice.paid_at && (
                      <p className="text-xs"
                        style={{ color: 'hsl(var(--status-green))' }}>
                        Paid {formatDate(invoice.paid_at)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div className="text-right flex-shrink-0">
                  <p
                    className="font-display text-lg
                    font-bold tabular-nums"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {formatCurrency(
                      Number(invoice.amount)
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center
                  gap-1.5 flex-shrink-0">

                  {/* Stripe link */}
                  {invoice.stripe_payment_url &&
                    invoice.status !== 'paid' && (
                      <a
                        href={
                          invoice.stripe_payment_url
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center
                        gap-1.5 px-3 py-1.5 rounded-lg
                        text-xs font-semibold
                        transition-all"
                        style={{
                          backgroundColor:
                            'hsl(var(--primary) / 0.1)',
                          color: 'hsl(var(--primary))',
                          border:
                            '1px solid hsl(var(--primary) / 0.2)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style
                            .backgroundColor =
                            'hsl(var(--primary) / 0.2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style
                            .backgroundColor =
                            'hsl(var(--primary) / 0.1)'
                        }}
                      >
                        <ExternalLink size={11} />
                        Stripe
                      </a>
                    )}

                  {/* Mark paid / unpaid */}
                  {invoice.status !== 'paid' &&
                    invoice.status !== 'cancelled' && (
                      <button
                        onClick={() =>
                          markPaid(invoice.id)
                        }
                        disabled={
                          updating === invoice.id
                        }
                        className="flex items-center
                        gap-1.5 px-3 py-1.5 rounded-lg
                        text-xs font-semibold transition-all
                        disabled:opacity-50"
                        style={{
                          backgroundColor:
                            'hsl(var(--status-green) / 0.1)',
                          color: 'hsl(var(--status-green))',
                          border:
                            '1px solid hsl(var(--status-green) / 0.2)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style
                            .backgroundColor =
                            'hsl(var(--status-green) / 0.2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style
                            .backgroundColor =
                            'hsl(var(--status-green) / 0.1)'
                        }}
                      >
                        <Check size={11} />
                        Mark Paid
                      </button>
                    )}

                  {invoice.status === 'paid' && (
                    <button
                      onClick={() =>
                        markUnpaid(invoice.id)
                      }
                      disabled={
                        updating === invoice.id
                      }
                      className="flex items-center
                      gap-1.5 px-3 py-1.5 rounded-lg
                      text-xs font-medium transition-all
                      disabled:opacity-50"
                      style={{
                        backgroundColor: 'hsl(var(--secondary))',
                        color: 'hsl(var(--muted-foreground))',
                        border: '1px solid hsl(var(--border))',
                      }}
                    >
                      <X size={11} />
                      Undo
                    </button>
                  )}

                  {/* Edit */}
                  <Link
                    href={
                      `/admin/invoices/${invoice.id}`
                    }
                    className="p-2 rounded-lg transition-all"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'hsl(var(--secondary))'
                      e.currentTarget.style.color
                        = 'hsl(var(--foreground))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'transparent'
                      e.currentTarget.style.color
                        = 'hsl(var(--text-faint))'
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
