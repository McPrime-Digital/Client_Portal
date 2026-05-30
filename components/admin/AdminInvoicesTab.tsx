'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  CreditCard,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  X,
  DollarSign,
  Check,
} from 'lucide-react'

type Invoice = {
  id: string
  title: string
  amount: number
  status: 'unpaid' | 'paid' | 'overdue' | 'partial'
  due_date: string | null
  paid_at: string | null
  stripe_payment_url: string | null
  invoice_number: string | null
  notes: string | null
  created_at: string
}

type Props = {
  projectId: string
  clientId: string
  projectTitle: string
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount)
}

const STATUS_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'partial', label: 'Partial' },
]

export default function AdminInvoicesTab({
  projectId,
  clientId,
  projectTitle,
}: Props) {
  const supabase = createClient()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(
    null
  )

  const [form, setForm] = useState({
    title: `${projectTitle} — Project Fee`,
    amount: '',
    status: 'unpaid',
    due_date: '',
    stripe_payment_url: '',
    invoice_number: '',
    notes: '',
  })

  useEffect(() => {
    loadInvoices()
  }, [projectId])

  async function loadInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const { data } = await supabase
      .from('invoices')
      .insert({
        project_id: projectId,
        client_id: clientId,
        title: form.title,
        amount: parseFloat(form.amount),
        status: form.status,
        due_date: form.due_date || null,
        stripe_payment_url: form.stripe_payment_url || null,
        invoice_number: form.invoice_number || null,
        notes: form.notes || null,
      })
      .select()
      .single()

    if (data) {
      setInvoices((prev) => [data, ...prev])
      setShowModal(false)
      setForm({
        title: `${projectTitle} — Project Fee`,
        amount: '',
        status: 'unpaid',
        due_date: '',
        stripe_payment_url: '',
        invoice_number: '',
        notes: '',
      })
    }
    setSaving(false)
  }

  async function markAsPaid(invoiceId: string) {
    setUpdatingId(invoiceId)
    const { data } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (data) {
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoiceId ? data : i))
      )
    }
    setUpdatingId(null)
  }

  async function updateStatus(
    invoiceId: string,
    status: string
  ) {
    setUpdatingId(invoiceId)
    const updates: any = { status }
    if (status === 'paid') {
      updates.paid_at = new Date().toISOString()
    }
    const { data } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId)
      .select()
      .single()

    if (data) {
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoiceId ? data : i))
      )
    }
    setUpdatingId(null)
  }

  async function deleteInvoice(invoiceId: string) {
    await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
    setInvoices((prev) =>
      prev.filter((i) => i.id !== invoiceId)
    )
  }

  const statusColors: Record<string, any> = {
    unpaid: { color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.1)' },
    paid: { color: 'hsl(var(--status-green))', bg: 'hsl(var(--status-green) / 0.1)' },
    overdue: { color: 'hsl(var(--destructive))', bg: 'hsl(var(--destructive) / 0.1)' },
    partial: { color: 'hsl(var(--status-blue))', bg: 'hsl(var(--status-blue) / 0.1)' },
  }

  const inputClass =
    'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--background))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow =
        '0 0 0 3px hsl(var(--primary) / 0.08)'
    },
    onBlur: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin"
          style={{ color: 'hsl(var(--text-faint))' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="font-display text-base font-semibold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Invoices
          </h3>
          <p className="text-xs mt-0.5"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {invoices.length} invoice
            {invoices.length !== 1 ? 's' : ''} for this project
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 
          rounded-lg text-sm font-semibold transition-all"
          style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
          }}
        >
          <Plus size={14} />
          New Invoice
        </button>
      </div>

      {/* Empty */}
      {invoices.length === 0 && (
        <div
          className="flex flex-col items-center justify-center 
          py-16 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--border))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <DollarSign size={32} style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-3"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            No invoices yet
          </p>
          <p className="text-xs mt-1 mb-5"
            style={{ color: 'hsl(var(--text-faint))' }}>
            Create an invoice and send a Stripe payment link
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 
            rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            <Plus size={14} />
            Create Invoice
          </button>
        </div>
      )}

      {/* Invoice list */}
      {invoices.length > 0 && (
        <div className="space-y-3">
          {invoices.map((invoice) => {
            const sc = statusColors[invoice.status] ??
              statusColors.unpaid
            return (
              <div
                key={invoice.id}
                className="p-5 rounded-xl"
                style={{
                  backgroundColor: 'hsl(var(--border))',
                  border: '1px solid hsl(var(--border))',
                }}
              >
                <div className="flex items-start 
                  justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    {invoice.invoice_number && (
                      <p className="text-xs mb-1"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        #{invoice.invoice_number}
                      </p>
                    )}
                    <p
                      className="text-sm font-semibold"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {invoice.title}
                    </p>
                    {invoice.notes && (
                      <p className="text-xs mt-1 leading-relaxed"
                        style={{ color: 'hsl(var(--muted-foreground))' }}>
                        {invoice.notes}
                      </p>
                    )}
                    <div className="flex items-center gap-3 
                      mt-3 flex-wrap">
                      {/* Status selector */}
                      <select
                        value={invoice.status}
                        onChange={(e) =>
                          updateStatus(invoice.id, e.target.value)
                        }
                        className="text-xs px-2.5 py-1 rounded-full 
                        font-semibold outline-none cursor-pointer"
                        style={{
                          backgroundColor: sc.bg,
                          color: sc.color,
                          border: `1px solid color-mix(in srgb, ${sc.color} 19%, transparent)`,
                        }}
                        disabled={updatingId === invoice.id}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option
                            key={opt.value}
                            value={opt.value}
                            style={{ backgroundColor: 'hsl(var(--card))' }}
                          >
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {invoice.due_date && (
                        <span className="text-xs"
                          style={{ color: 'hsl(var(--text-faint))' }}>
                          Due{' '}
                          {new Date(
                            invoice.due_date
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                      {invoice.paid_at && (
                        <span className="text-xs"
                          style={{ color: 'hsl(var(--status-green))' }}>
                          Paid{' '}
                          {new Date(
                            invoice.paid_at
                          ).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3">
                    <div
                      className="font-display text-xl 
                      font-bold tabular-nums"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {formatCurrency(invoice.amount)}
                    </div>
                    <div className="flex items-center gap-2">
                      {invoice.status !== 'paid' && (
                        <button
                          onClick={() => markAsPaid(invoice.id)}
                          disabled={updatingId === invoice.id}
                          className="flex items-center gap-1.5 
                          px-3 py-1.5 rounded-lg text-xs 
                          font-semibold transition-all 
                          disabled:opacity-50"
                          style={{
                            backgroundColor:
                              'hsl(var(--status-green) / 0.12)',
                            color: 'hsl(var(--status-green))',
                            border:
                              '1px solid hsl(var(--status-green) / 0.2)',
                          }}
                        >
                          {updatingId === invoice.id ? (
                            <Loader2 size={11}
                              className="animate-spin" />
                          ) : (
                            <Check size={11} />
                          )}
                          Mark Paid
                        </button>
                      )}
                      <button
                        onClick={() => deleteInvoice(invoice.id)}
                        className="flex items-center gap-1.5 
                        px-3 py-1.5 rounded-lg text-xs 
                        font-semibold transition-all"
                        style={{
                          backgroundColor:
                            'hsl(var(--destructive) / 0.08)',
                          color: 'hsl(var(--destructive))',
                          border:
                            '1px solid hsl(var(--destructive) / 0.15)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'hsl(var(--destructive) / 0.15)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'hsl(var(--destructive) / 0.08)'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    {invoice.stripe_payment_url && (
                      <a
                        href={invoice.stripe_payment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs"
                        style={{ color: 'hsl(var(--status-blue))' }}
                      >
                        View payment page ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Invoice Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center 
          justify-center p-4 overflow-y-auto"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget)
              setShowModal(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 my-8"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div className="flex items-center justify-between 
              mb-6">
              <h2
                className="font-display text-lg font-bold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                New Invoice
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-lg flex items-center 
                justify-center transition-colors"
                style={{ color: 'hsl(var(--muted-foreground))' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    'hsl(var(--border))'
                  e.currentTarget.style.color = 'hsl(var(--foreground))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor =
                    'transparent'
                  e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
                }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={createInvoice}
              className="space-y-4">
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Invoice Title *
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-xs font-semibold 
                    uppercase tracking-wider mb-2"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Amount ($) *
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        amount: e.target.value,
                      })
                    }
                    placeholder="5000.00"
                    className={inputClass}
                    style={inputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-semibold 
                    uppercase tracking-wider mb-2"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value,
                      })
                    }
                    className={inputClass}
                    style={inputStyle}
                    {...focusHandlers}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        style={{ backgroundColor: 'hsl(var(--card))' }}
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-xs font-semibold 
                    uppercase tracking-wider mb-2"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Invoice #
                  </label>
                  <input
                    type="text"
                    value={form.invoice_number}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        invoice_number: e.target.value,
                      })
                    }
                    placeholder="INV-001"
                    className={inputClass}
                    style={inputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-semibold 
                    uppercase tracking-wider mb-2"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        due_date: e.target.value,
                      })
                    }
                    className={inputClass}
                    style={{
                      ...inputStyle,
                      colorScheme: 'dark',
                    }}
                    {...focusHandlers}
                  />
                </div>
              </div>

              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Stripe Payment URL
                </label>
                <input
                  type="url"
                  value={form.stripe_payment_url}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      stripe_payment_url: e.target.value,
                    })
                  }
                  placeholder="https://buy.stripe.com/..."
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>

              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                  placeholder="50% deposit, remaining on delivery..."
                  className="w-full px-4 py-3 rounded-lg text-sm 
                  outline-none transition-all resize-none"
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>

              <div
                className="pt-2 flex gap-3"
                style={{ borderTop: '1px solid hsl(var(--border))' }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-3 rounded-lg text-sm 
                  font-medium"
                  style={{
                    backgroundColor: 'hsl(var(--border))',
                    color: 'hsl(var(--muted-foreground))',
                    border: '1px solid hsl(var(--border))',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center 
                  justify-center gap-2 py-3 rounded-lg text-sm 
                  font-semibold disabled:opacity-60"
                  style={{
                    backgroundColor: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                  }}
                >
                  {saving ? (
                    <Loader2 size={14}
                      className="animate-spin" />
                  ) : (
                    <CreditCard size={14} />
                  )}
                  {saving ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
