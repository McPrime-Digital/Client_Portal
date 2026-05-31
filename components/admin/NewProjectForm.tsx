'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Loader2,
  X,
  Check,
  FolderOpen,
} from 'lucide-react'

type Client = {
  id: string
  name: string
  company: string | null
  email: string
}

const PROJECT_TYPES = [
  'Brand Film',
  'Commercial',
  'Documentary',
  'Social Content',
  'Event Coverage',
  'Product Video',
  'Corporate Video',
  'AI Automation',
  'AI Workflow',
  'Photography',
  'Other',
]

const DEFAULT_PHASES = [
  { name: 'Discovery & Brief', description: 'Concept development and narrative architecture', sort_order: 0 },
  { name: 'Pre-Production', description: 'Script design and creative alignment with brand', sort_order: 1 },
  { name: 'Production G1', description: 'AI-powered scene generation and environment design', sort_order: 2 },
  { name: 'Production G2', description: 'Cinematic visual composition and motion design', sort_order: 3 },
  { name: 'Post-Production', description: 'Visual refinement, editing, sound design, voiceover, and audio mastering', sort_order: 4 },
  { name: 'Revisions', description: 'Commercial campaign formatting for distribution platforms', sort_order: 5 },
  { name: 'Final Delivery', description: 'Final masters delivered across agreed formats', sort_order: 6 },
]

const STATUSES = [
  'Onboarding',
  'Pre-Production',
  'In Production',
  'Post-Production',
  'In Review',
  'Revisions',
  'Completed',
  'On Hold',
]

export default function NewProjectForm({
  clients,
}: {
  clients: Client[]
}) {
  const router = useRouter()

  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    client_id: '',
    title: '',
    type: 'Brand Film',
    status: 'Onboarding',
    progress: 0,
    brief: '',
    kickoff_date: '',
    due_date: '',
    stripe_payment_url: '',
    invoice_amount: '',
  })

  const [phases, setPhases] = useState(
    DEFAULT_PHASES.map((p) => ({ ...p, enabled: true }))
  )

  const [customTasks, setCustomTasks] = useState<string[]>(
    []
  )
  const [newTask, setNewTask] = useState('')

  const selectedClient = clients.find(
    (c) => c.id === form.client_id
  )

  function updateForm(
    key: string,
    value: string | number
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function togglePhase(index: number) {
    setPhases((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, enabled: !p.enabled } : p
      )
    )
  }

  function addTask() {
    if (!newTask.trim()) return
    setCustomTasks((prev) => [...prev, newTask.trim()])
    setNewTask('')
  }

  function removeTask(index: number) {
    setCustomTasks((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    if (!form.client_id || !form.title.trim()) {
      setError('Client and project title are required.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const enabledPhases = phases
        .filter((p) => p.enabled)
        .map((p, i) => ({
          name: p.name,
          description: p.description,
          sort_order: i,
        }))

      const response = await fetch('/api/admin/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: form.client_id,
          title: form.title.trim(),
          type: form.type,
          status: form.status,
          progress: Number(form.progress),
          brief: form.brief || null,
          kickoff_date: form.kickoff_date || null,
          due_date: form.due_date || null,
          stripe_payment_url: form.stripe_payment_url || null,
          invoice_amount: form.invoice_amount
            ? parseFloat(form.invoice_amount)
            : null,
          phases: enabledPhases,
          tasks: customTasks,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error ?? 'Failed to create project.')
      }

      router.push(`/admin/projects/${result.project.id}`)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.')
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

  return (
    <div className="max-w-[640px] space-y-6">

      {/* Back */}
      <Link
        href="/admin/projects"
        className="inline-flex items-center gap-2 text-sm 
        transition-colors"
        style={{ color: 'hsl(var(--muted-foreground))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'hsl(var(--foreground))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
      >
        <ArrowLeft size={14} />
        Back to Projects
      </Link>

      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          New Project
        </h1>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Step {step} of 3 —{' '}
          {step === 1
            ? 'Project Details'
            : step === 2
            ? 'Production Phases'
            : 'Deliverables & Payment'}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className="flex items-center gap-2"
          >
            <div
              className="w-7 h-7 rounded-full flex 
              items-center justify-center text-xs font-bold 
              transition-all"
              style={{
                backgroundColor:
                  s < step
                    ? 'hsl(var(--status-green))'
                    : s === step
                    ? 'hsl(var(--primary))'
                    : 'hsl(var(--secondary))',
                color:
                  s <= step ? 'hsl(var(--primary-foreground))' : 'hsl(var(--text-faint))',
              }}
            >
              {s < step ? (
                <Check size={12} />
              ) : (
                s
              )}
            </div>
            {s < 3 && (
              <div
                className="w-12 h-0.5 rounded-full"
                style={{
                  backgroundColor:
                    s < step ? 'hsl(var(--status-green))' : 'hsl(var(--secondary))',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Project Details ── */}
      {step === 1 && (
        <div
          className="p-6 rounded-xl space-y-5"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          {/* Client selector */}
          <div>
            <label
              className={labelClass}
              style={labelStyle}
            >
              Client *
            </label>
            {clients.length === 0 ? (
              <div
                className="p-4 rounded-lg text-sm 
                text-center"
                style={{
                  backgroundColor: 'hsl(var(--primary-foreground))',
                  border: '1px solid hsl(var(--border))',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                No clients yet.{' '}
                <Link
                  href="/admin/clients/new"
                  className="underline"
                  style={{ color: 'hsl(var(--primary))' }}
                >
                  Create a client first
                </Link>
              </div>
            ) : (
              <select
                value={form.client_id}
                onChange={(e) =>
                  updateForm('client_id', e.target.value)
                }
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              >
                <option value=""
                  style={{ backgroundColor: 'hsl(var(--card))' }}>
                  Select a client...
                </option>
                {clients.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    style={{ backgroundColor: 'hsl(var(--card))' }}
                  >
                    {c.name}
                    {c.company ? ` — ${c.company}` : ''}
                  </option>
                ))}
              </select>
            )}
            {selectedClient && (
              <p className="text-xs mt-1.5"
                style={{ color: 'hsl(var(--text-faint))' }}>
                {selectedClient.email}
              </p>
            )}
          </div>

          {/* Title */}
          <div>
            <label
              className={labelClass}
              style={labelStyle}
            >
              Project Title *
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) =>
                updateForm('title', e.target.value)
              }
              placeholder="e.g. Brand Film — Q3 2026"
              className={inputClass}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Project Type
              </label>
              <select
                value={form.type}
                onChange={(e) =>
                  updateForm('type', e.target.value)
                }
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              >
                {PROJECT_TYPES.map((t) => (
                  <option
                    key={t}
                    value={t}
                    style={{ backgroundColor: 'hsl(var(--card))' }}
                  >
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Starting Status
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
                {STATUSES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    style={{ backgroundColor: 'hsl(var(--card))' }}
                  >
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                className={labelClass}
                style={labelStyle}
              >
                Kickoff Date
              </label>
              <input
                type="date"
                value={form.kickoff_date}
                onChange={(e) =>
                  updateForm('kickoff_date', e.target.value)
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
                Delivery Date
              </label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) =>
                  updateForm('due_date', e.target.value)
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

          {/* Brief */}
          <div>
            <label
              className={labelClass}
              style={labelStyle}
            >
              Project Brief
            </label>
            <textarea
              rows={4}
              value={form.brief}
              onChange={(e) =>
                updateForm('brief', e.target.value)
              }
              placeholder="Describe the project scope, 
goals, and deliverables..."
              className="w-full px-4 py-3 rounded-lg 
              text-sm outline-none transition-all resize-none"
              style={inputStyle}
              {...focusHandlers}
            />
          </div>
        </div>
      )}

      {/* ── STEP 2: Phases ── */}
      {step === 2 && (
        <div
          className="p-6 rounded-xl space-y-4"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <div>
            <h3
              className="font-display text-base 
              font-semibold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Production Phases
            </h3>
            <p className="text-sm mt-1"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              Toggle off any phases that don't apply 
              to this project
            </p>
          </div>

          <div className="space-y-2">
            {phases.map((phase, index) => (
              <button
                key={index}
                onClick={() => togglePhase(index)}
                className="w-full flex items-center 
                justify-between px-4 py-3.5 rounded-xl 
                transition-all text-left"
                style={{
                  backgroundColor: phase.enabled
                    ? 'hsl(var(--card))'
                    : 'hsl(var(--primary-foreground))',
                  border: phase.enabled
                    ? '1px solid hsl(var(--border))'
                    : '1px solid hsl(var(--card))',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded flex 
                    items-center justify-center flex-shrink-0 
                    transition-all"
                    style={{
                      backgroundColor: phase.enabled
                        ? 'hsl(var(--primary))'
                        : 'transparent',
                      border: phase.enabled
                        ? 'none'
                        : '2px solid hsl(var(--border))',
                    }}
                  >
                    {phase.enabled && (
                      <Check size={11}
                        style={{ color: 'hsl(var(--primary-foreground))' }} />
                    )}
                  </div>
                  <div className="min-w-0 text-left">
                    <span
                      className="block text-sm font-medium"
                      style={{
                        color: phase.enabled
                          ? 'hsl(var(--foreground))'
                          : 'hsl(var(--text-faint))',
                      }}
                    >
                      {phase.name}
                    </span>
                    {phase.description && (
                      <span className="block text-[11px] leading-snug mt-0.5"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {phase.description}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="text-xs"
                  style={{ color: 'hsl(var(--text-faint))' }}
                >
                  Phase {index + 1}
                </span>
              </button>
            ))}
          </div>

          <p className="text-xs"
            style={{ color: 'hsl(var(--text-faint))' }}>
            {phases.filter((p) => p.enabled).length} phases
            selected
          </p>
        </div>
      )}

      {/* ── STEP 3: Tasks & Payment ── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Deliverables */}
          <div
            className="p-6 rounded-xl space-y-4"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div>
              <h3
                className="font-display text-base 
                font-semibold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Deliverables & Tasks
              </h3>
              <p className="text-sm mt-1"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                Add the specific items you'll deliver
              </p>
            </div>

            {/* Add task */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTask}
                onChange={(e) =>
                  setNewTask(e.target.value)
                }
                placeholder="e.g. 60-second hero video"
                className="flex-1 px-4 py-3 rounded-lg 
                text-sm outline-none transition-all"
                style={inputStyle}
                {...focusHandlers}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTask()
                  }
                }}
              />
              <button
                onClick={addTask}
                disabled={!newTask.trim()}
                className="px-4 py-3 rounded-lg 
                transition-all disabled:opacity-40"
                style={{
                  backgroundColor: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
              >
                <Plus size={16} />
              </button>
            </div>

            {/* Task list */}
            {customTasks.length > 0 && (
              <div className="space-y-2">
                {customTasks.map((task, index) => (
                  <div
                    key={index}
                    className="flex items-center 
                    gap-3 px-4 py-3 rounded-lg"
                    style={{
                      backgroundColor: 'hsl(var(--primary-foreground))',
                      border: '1px solid hsl(var(--border))',
                    }}
                  >
                    <Check size={13}
                      style={{ color: 'hsl(var(--status-green))' }} />
                    <span
                      className="flex-1 text-sm"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {task}
                    </span>
                    <button
                      onClick={() => removeTask(index)}
                      style={{ color: 'hsl(var(--text-faint))' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color =
                          'hsl(var(--destructive))'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color =
                          'hsl(var(--text-faint))'
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment */}
          <div
            className="p-6 rounded-xl space-y-4"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div>
              <h3
                className="font-display text-base 
                font-semibold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Payment
              </h3>
              <p className="text-sm mt-1"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                Optional — creates an invoice automatically
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className={labelClass}
                  style={labelStyle}
                >
                  Project Fee ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.invoice_amount}
                  onChange={(e) =>
                    updateForm(
                      'invoice_amount',
                      e.target.value
                    )
                  }
                  placeholder="5000.00"
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
                  Stripe Payment URL
                </label>
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
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>
            </div>
          </div>

          {/* Summary */}
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor:
                'hsl(var(--primary) / 0.06)',
              border: '1px solid hsl(var(--primary) / 0.15)',
            }}
          >
            <h4
              className="text-xs font-semibold uppercase 
              tracking-widest mb-3"
              style={{ color: 'hsl(var(--primary))' }}
            >
              Ready to Create
            </h4>
            <div className="space-y-1.5">
              {[
                {
                  label: 'Client',
                  value: selectedClient?.name ?? '—',
                },
                { label: 'Project', value: form.title || '—' },
                {
                  label: 'Type',
                  value: form.type,
                },
                {
                  label: 'Status',
                  value: form.status,
                },
                {
                  label: 'Phases',
                  value: `${
                    phases.filter((p) => p.enabled).length
                  } phases`,
                },
                {
                  label: 'Tasks',
                  value: `${customTasks.length} deliverables`,
                },
                {
                  label: 'Invoice',
                  value: form.invoice_amount
                    ? `$${form.invoice_amount}`
                    : 'None',
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center 
                  justify-between"
                >
                  <span className="text-xs"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {label}
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm"
          style={{ color: 'hsl(var(--destructive))' }}>
          {error}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center 
        justify-between gap-4">
        <button
          onClick={() =>
            step > 1 ? setStep(step - 1) : undefined
          }
          disabled={step === 1}
          className="px-5 py-3 rounded-lg text-sm 
          font-medium transition-all disabled:opacity-40"
          style={{
            backgroundColor: 'hsl(var(--secondary))',
            color: 'hsl(var(--muted-foreground))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          Back
        </button>

        {step < 3 ? (
          <button
            onClick={() => {
              if (step === 1 &&
                (!form.client_id || !form.title.trim())
              ) {
                setError(
                  'Please select a client and enter a project title.'
                )
                return
              }
              setError('')
              setStep(step + 1)
            }}
            className="flex items-center gap-2 px-6 py-3 
            rounded-lg text-sm font-semibold transition-all"
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
            Continue
            <ArrowLeft
              size={14}
              className="rotate-180"
            />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 
            rounded-lg text-sm font-semibold transition-all 
            disabled:opacity-60"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            {saving ? (
              <Loader2 size={14}
                className="animate-spin" />
            ) : (
              <FolderOpen size={14} />
            )}
            {saving
              ? 'Creating...'
              : 'Create Project'}
          </button>
        )}
      </div>
    </div>
  )
}
