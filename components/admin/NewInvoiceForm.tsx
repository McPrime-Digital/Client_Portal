'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft,
  Plus,
  Minus,
  Loader2,
  DollarSign,
  Check,
  ExternalLink,
} from 'lucide-react'

type LineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
}

export default function NewInvoiceForm({
  clients,
  projects,
}: {
  clients: any[]
  projects: any[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const [form, setForm] = useState({
    client_id: '',
    project_id: '',
    title: '',
    description: '',
    due_date: '',
    stripe_payment_url: '',
    notes: '',
    status: 'unpaid' as
      'draft' | 'unpaid',
  })

  const [lineItems, setLineItems] = useState<
    LineItem[]
  >([
    {
      id: '1',
      description: '',
      quantity: 1,
      unit_price: 0,
    },
  ])

  const filteredProjects = form.client_id
    ? projects.filter(
        (p) => p.client_id === form.client_id
      )
    : projects

  const subtotal = lineItems.reduce(
    (acc, item) =>
      acc + item.quantity * item.unit_price,
    0
  )

  function updateForm(
    key: string,
    value: string
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        description: '',
        quantity: 1,
        unit_price: 0,
      },
    ],
    )
  }

  function removeLineItem(id: string) {
    if (lineItems.length === 1) return
    setLineItems((prev) =>
      prev.filter((item) => item.id !== id)
    )
  }

  function updateLineItem(
    id: string,
    key: keyof LineItem,
    value: string | number
  ) {
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, [key]: value }
          : item
      )
    )
  }

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault()
    if (!form.client_id || !form.title.trim()) {
      setError('Client and title are required.')
      return
    }
    if (subtotal <= 0) {
      setError(
        'Add at least one line item with a price.'
      )
      return
    }

    setSaving(true)
    setError('')

    try {
      const { error: insertError } = await supabase
        .from('invoices')
        .insert({
          client_id: form.client_id,
          project_id: form.project_id || null,
          title: form.title.trim(),
          description:
            form.description.trim() || null,
          amount: subtotal,
          status: form.status,
          due_date: form.due_date || null,
          stripe_payment_url:
            form.stripe_payment_url.trim() || null,
          notes: form.notes.trim() || null,
          line_items: lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.quantity * item.unit_price,
          })),
        })

      if (insertError) throw insertError

      setDone(true)
      setTimeout(() => {
        router.push('/admin/invoices')
      }, 1500)
    } catch (err: any) {
      setError(
        err.message ?? 'Failed to create invoice.'
      )
      setSaving(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--primary-foreground))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<
      HTMLInputElement |
      HTMLTextAreaElement |
      HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow =
        '0 0 0 3px hsl(var(--primary) / 0.08)'
    },
    onBlur: (e: React.FocusEvent<
      HTMLInputElement |
      HTMLTextAreaElement |
      HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }
  const labelClass =
    'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' }

  if (done) {
    return (
      <div className="max-w-[480px] flex flex-col
        items-center justify-center py-20 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex
          items-center justify-center mb-5"
          style={{
            backgroundColor: 'hsl(var(--status-green) / 0.12)',
          }}
        >
          <Check size={28}
            style={{ color: 'hsl(var(--status-green))' }} />
        </div>
        <h2
          className="font-display text-xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Invoice Created
        </h2>
        <p className="text-sm mt-2"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Redirecting to invoices...
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[680px] space-y-6">

      {/* Back */}
      <Link
        href="/admin/invoices"
        className="inline-flex items-center gap-2
        text-sm transition-colors"
        style={{ color: 'hsl(var(--muted-foreground))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'hsl(var(--foreground))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
      >
        <ArrowLeft size={14} />
        Back to Invoices
      </Link>

      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          New Invoice
        </h1>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Invoice number will be auto-generated
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5"
      >
        {/* Details */}
        <div
          className="p-6 rounded-xl space-y-4"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <h3
            className="font-display text-sm
            font-semibold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Invoice Details
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label
                className={labelClass}
                style={labelStyle}
              >
                Invoice Title *
              </label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) =>
                  updateForm('title', e.target.value)
                }
                placeholder="e.g. Brand Film — 
Project Fee"
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Client *
              </label>
              <select
                required
                value={form.client_id}
                onChange={(e) => {
                  updateForm(
                    'client_id', e.target.value
                  )
                  updateForm('project_id', '')
                }}
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              >
                <option value=""
                  style={{
                    backgroundColor: 'hsl(var(--card))',
                  }}>
                  Select client...
                </option>
                {clients.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    style={{
                      backgroundColor: 'hsl(var(--card))',
                    }}
                  >
                    {c.name}
                    {c.company
                      ? ` — ${c.company}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Project (optional)
              </label>
              <select
                value={form.project_id}
                onChange={(e) =>
                  updateForm(
                    'project_id', e.target.value
                  )
                }
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              >
                <option value=""
                  style={{
                    backgroundColor: 'hsl(var(--card))',
                  }}>
                  Select project...
                </option>
                {filteredProjects.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    style={{
                      backgroundColor: 'hsl(var(--card))',
                    }}
                  >
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Due Date
              </label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) =>
                  updateForm(
                    'due_date', e.target.value
                  )
                }
                className={inputClass}
                style={{
                  ...inputStyle,
                  colorScheme: 'dark',
                }}
                {...focusHandlers}
              />
            </div>

            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) =>
                  updateForm('status', e.target.value)
                }
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              >
                <option value="draft"
                  style={{
                    backgroundColor: 'hsl(var(--card))',
                  }}>
                  Draft (not visible to client)
                </option>
                <option value="unpaid"
                  style={{
                    backgroundColor: 'hsl(var(--card))',
                  }}>
                  Unpaid (visible to client)
                </option>
              </select>
            </div>
          </div>

          <div>
            <label
              className={labelClass}
              style={labelStyle}
            >
              Stripe Payment URL
            </label>
            <div className="relative">
              <input
                type="url"
                value={form.stripe_payment_url}
                onChange={(e) =>
                  updateForm(
                    'stripe_payment_url',
                    e.target.value
                  )
                }
                placeholder="https://buy.stripe.com/..."
                className="w-full pl-4 pr-10 py-3
                rounded-lg text-sm outline-none
                transition-all"
                style={inputStyle}
                {...focusHandlers}
              />
              {form.stripe_payment_url && (
                <a
                  href={form.stripe_payment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute right-3
                  top-1/2 -translate-y-1/2"
                  style={{ color: 'hsl(var(--text-faint))' }}
                  onClick={(e) =>
                    e.stopPropagation()
                  }
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            <p className="text-xs mt-1.5"
              style={{ color: 'hsl(var(--text-faint))' }}>
              Create a payment link at
              dashboard.stripe.com → Payment Links
            </p>
          </div>
        </div>

        {/* Line items */}
        <div
          className="p-6 rounded-xl space-y-4"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <h3
            className="font-display text-sm
            font-semibold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Line Items
          </h3>

          {/* Header row */}
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6">
              <span
                className="text-xs font-semibold
                uppercase tracking-wider"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Description
              </span>
            </div>
            <div className="col-span-2 text-center">
              <span
                className="text-xs font-semibold
                uppercase tracking-wider"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Qty
              </span>
            </div>
            <div className="col-span-3 text-right">
              <span
                className="text-xs font-semibold
                uppercase tracking-wider"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Price
              </span>
            </div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {lineItems.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-12
                gap-2 items-center"
              >
                <div className="col-span-6">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      updateLineItem(
                        item.id,
                        'description',
                        e.target.value
                      )
                    }
                    placeholder="Service description"
                    className="w-full px-3 py-2.5
                    rounded-lg text-sm outline-none
                    transition-all"
                    style={inputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      updateLineItem(
                        item.id,
                        'quantity',
                        Number(e.target.value)
                      )
                    }
                    className="w-full px-3 py-2.5
                    rounded-lg text-sm outline-none
                    transition-all text-center"
                    style={inputStyle}
                    {...focusHandlers}
                  />
                </div>
                <div className="col-span-3">
                  <div className="relative">
                    <span
                      className="absolute left-3
                      top-1/2 -translate-y-1/2 text-sm"
                      style={{ color: 'hsl(var(--text-faint))' }}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) =>
                        updateLineItem(
                          item.id,
                          'unit_price',
                          Number(e.target.value)
                        )
                      }
                      className="w-full pl-6 pr-3
                      py-2.5 rounded-lg text-sm
                      outline-none transition-all
                      text-right"
                      style={inputStyle}
                      {...focusHandlers}
                    />
                  </div>
                </div>
                <div className="col-span-1
                  flex justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      removeLineItem(item.id)
                    }
                    disabled={lineItems.length === 1}
                    className="p-1.5 rounded-lg
                    transition-all disabled:opacity-25"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color
                        = 'hsl(var(--destructive))'
                      e.currentTarget.style.backgroundColor
                        = 'hsl(var(--destructive) / 0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color
                        = 'hsl(var(--text-faint))'
                      e.currentTarget.style.backgroundColor
                        = 'transparent'
                    }}
                  >
                    <Minus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add line item */}
          <button
            type="button"
            onClick={addLineItem}
            className="flex items-center gap-2 text-sm
            transition-colors"
            style={{ color: 'hsl(var(--muted-foreground))' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'hsl(var(--primary))'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
            }}
          >
            <Plus size={13} />
            Add line item
          </button>

          {/* Subtotal */}
          <div
            className="flex items-center
            justify-between pt-4"
            style={{ borderTop: '1px solid hsl(var(--secondary))' }}
          >
            <span
              className="text-sm font-semibold"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              Total
            </span>
            <span
              className="font-display text-2xl
              font-bold tabular-nums"
              style={{ color: 'hsl(var(--primary))' }}
            >
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
              }).format(subtotal)}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm"
            style={{ color: 'hsl(var(--destructive))' }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Link
            href="/admin/invoices"
            className="px-5 py-3 rounded-lg text-sm
            font-medium transition-all"
            style={{
              backgroundColor: 'hsl(var(--secondary))',
              color: 'hsl(var(--muted-foreground))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 flex items-center
            justify-center gap-2 py-3 rounded-lg
            text-sm font-semibold transition-all
            disabled:opacity-60"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            {saving ? (
              <>
                <Loader2 size={14}
                  className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <DollarSign size={14} />
                Create Invoice
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
