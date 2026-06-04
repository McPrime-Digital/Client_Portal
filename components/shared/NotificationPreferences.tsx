'use client'

import { useState, useEffect } from 'react'
import { Bell, Smartphone, Mail, MonitorSmartphone, Check, Loader2, Info, BellRing } from 'lucide-react'
import { pushSupported, isPushEnabled, enablePush, disablePush } from '@/lib/pushClient'

export type Channels = { push?: boolean; sms?: boolean; email?: boolean }
export type PrefMap = Record<string, Channels>

// Categories shown in the preferences grid. Keys match notify.ts NotifyCategory.
const CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: 'messages', label: 'Messages & Chat', desc: 'New messages while you’re away' },
  { key: 'tasks', label: 'Tasks & Approvals', desc: 'Approvals, change requests, task updates' },
  { key: 'files', label: 'Deliverables', desc: 'New files delivered to you' },
  { key: 'status', label: 'Project Updates', desc: 'Phase changes & status updates' },
  { key: 'invoices', label: 'Invoices', desc: 'New invoices & payment reminders' },
]

// Escalation order mirrors the product spec: device → mobile → email.
const CHANNELS: { key: keyof Channels; label: string; icon: typeof Mail }[] = [
  { key: 'push', label: 'Device', icon: MonitorSmartphone },
  { key: 'sms', label: 'Mobile', icon: Smartphone },
  { key: 'email', label: 'Email', icon: Mail },
]

// Seed sensible defaults for any category the saved prefs don't cover yet.
function normalize(initial: PrefMap | null | undefined): PrefMap {
  const out: PrefMap = {}
  for (const c of CATEGORIES) {
    const saved = initial?.[c.key] ?? {}
    out[c.key] = {
      push: saved.push ?? true,
      sms: saved.sms ?? false,
      email: saved.email ?? true,
    }
  }
  return out
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: on ? 'hsl(var(--primary))' : 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}
    >
      <span
        className="absolute top-0.5 w-4.5 h-4.5 rounded-full transition-all"
        style={{
          width: 18,
          height: 18,
          left: on ? 20 : 2,
          backgroundColor: on ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
        }}
      />
    </button>
  )
}

export default function NotificationPreferences({
  initial,
  onSave,
}: {
  initial: PrefMap | null | undefined
  onSave: (prefs: PrefMap) => Promise<void>
}) {
  const [prefs, setPrefs] = useState<PrefMap>(() => normalize(initial))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Device (Web Push) enablement on THIS device.
  const [deviceOn, setDeviceOn] = useState(false)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceErr, setDeviceErr] = useState('')
  const supported = pushSupported()

  useEffect(() => {
    isPushEnabled().then(setDeviceOn).catch(() => {})
  }, [])

  async function toggleDevice() {
    setDeviceBusy(true)
    setDeviceErr('')
    try {
      if (deviceOn) {
        await disablePush()
        setDeviceOn(false)
      } else {
        await enablePush()
        setDeviceOn(true)
      }
    } catch (e: any) {
      setDeviceErr(e?.message ?? 'Could not update device notifications.')
    } finally {
      setDeviceBusy(false)
    }
  }

  function toggle(cat: string, ch: keyof Channels) {
    setPrefs((p) => ({ ...p, [cat]: { ...p[cat], [ch]: !p[cat]?.[ch] } }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await onSave(prefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}>
          <Bell size={18} style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Notification Preferences</h3>
          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Choose how you&apos;re alerted for each kind of update</p>
        </div>
      </div>

      <div
        className="flex items-start gap-2 text-xs rounded-lg p-3 my-4"
        style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}
      >
        <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--primary))' }} />
        <span>
          In-app alerts always show while you&apos;re active. These channels are used only when you&apos;re
          <span className="font-medium" style={{ color: 'hsl(var(--foreground))' }}> away or not in the app</span>, in order: device, then mobile, then email.
        </span>
      </div>

      {/* Enable Web Push on this device */}
      {supported && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg p-3 mb-4 flex-wrap"
          style={{ backgroundColor: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <BellRing size={16} style={{ color: deviceOn ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }} />
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {deviceOn ? 'Device notifications are on' : 'Enable device notifications'}
              </p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {deviceOn ? 'This device will receive push alerts when you’re away.' : 'Allow push alerts on this device.'}
              </p>
              {deviceErr && <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--destructive))' }}>{deviceErr}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleDevice}
            disabled={deviceBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 flex-shrink-0"
            style={{
              backgroundColor: deviceOn ? 'hsl(var(--secondary))' : 'hsl(var(--primary))',
              color: deviceOn ? 'hsl(var(--foreground))' : 'hsl(var(--primary-foreground))',
              border: deviceOn ? '1px solid hsl(var(--border))' : 'none',
            }}
          >
            {deviceBusy ? <Loader2 size={13} className="animate-spin" /> : null}
            {deviceOn ? 'Turn off' : 'Enable'}
          </button>
        </div>
      )}

      {/* Channel header */}
      <div className="hidden sm:grid items-center gap-2 mb-2 px-1" style={{ gridTemplateColumns: '1fr repeat(3, 64px)' }}>
        <span />
        {CHANNELS.map((ch) => {
          const Icon = ch.icon
          return (
            <div key={ch.key} className="flex flex-col items-center gap-1">
              <Icon size={15} style={{ color: 'hsl(var(--muted-foreground))' }} />
              <span className="text-[10px] font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>{ch.label}</span>
            </div>
          )
        })}
      </div>

      <div className="space-y-1">
        {CATEGORIES.map((cat) => (
          <div
            key={cat.key}
            className="grid items-center gap-2 py-3 px-1"
            style={{ gridTemplateColumns: '1fr repeat(3, 64px)', borderTop: '1px solid hsl(var(--border))' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>{cat.label}</p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{cat.desc}</p>
            </div>
            {CHANNELS.map((ch) => (
              <div key={ch.key} className="flex justify-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="sm:hidden text-[9px]" style={{ color: 'hsl(var(--text-faint))' }}>{ch.label}</span>
                  <Toggle on={!!prefs[cat.key]?.[ch.key]} onClick={() => toggle(cat.key, ch.key)} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
          style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? 'Saved' : 'Save preferences'}
        </button>
        {error && <span className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>{error}</span>}
      </div>
    </div>
  )
}
