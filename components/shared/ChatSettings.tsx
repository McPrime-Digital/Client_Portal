'use client'

import { Bell, AtSign, BellOff, Volume2, Palette, Keyboard, Check, Moon } from 'lucide-react'
import { WALLPAPERS, type WallpaperPattern, type WallpaperIntensity } from '@/lib/chatPrefs'
import { VOLUMES, type SoundVolume } from '@/lib/soundClient'
import type { MentionTrigger } from '@/lib/mentionClient'

/**
 * Chat settings — the panel, rebuilt.
 *
 * It was a flat stack of bordered rectangles with text where controls should
 * be: "On"/"Off" as a right-aligned word rather than a switch, wallpapers as
 * named buttons that showed nothing, and no grouping at all — a notification
 * mode, a font trigger and a wallpaper sat at the same visual weight, so
 * nothing looked more important than anything else.
 *
 * Rebuilt around three ideas:
 *
 *  1. SHOW, DO NOT NAME. Every wallpaper swatch renders the actual pattern at
 *     the chosen intensity. A list of the words "Grain / Filmstrip / Slate"
 *     asks the user to guess and then undo; a grid of nine live tiles is a
 *     decision they can make once.
 *
 *  2. GROUP BY WHO IT AFFECTS. Notification level is per ROOM and follows the
 *     account everywhere; sound and appearance are per DEVICE. Those are
 *     genuinely different promises, and the panel says which is which instead
 *     of leaving the user to discover it.
 *
 *  3. REAL CONTROLS. A switch that looks like a switch, a segmented control
 *     that looks segmented. The previous panel made you read a word to learn
 *     a state.
 *
 * One component, both portals — RoomThread is the single engine each side
 * renders, so the studio and the client get the identical panel rather than
 * two that drift.
 */

function SectionHeader({ icon: Icon, title, note }: {
  icon: typeof Bell; title: string; note: string
}) {
  return (
    <div className="flex items-start gap-2 mb-2.5">
      <Icon size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'hsl(var(--primary))' }} />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'hsl(var(--foreground))' }}>
          {title}
        </p>
        <p className="text-[10px] leading-tight mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {note}
        </p>
      </div>
    </div>
  )
}

/** A switch that looks like a switch. The old panel printed the word "On". */
function Toggle({ on, onChange, label, sub }: {
  on: boolean; onChange: (v: boolean) => void; label: string; sub: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left"
      style={{
        backgroundColor: on ? 'hsl(var(--primary) / 0.06)' : 'hsl(var(--background))',
        borderColor: on ? 'hsl(var(--primary) / 0.35)' : 'hsl(var(--border))',
      }}
    >
      <span className="min-w-0">
        <span className="text-[13px] block" style={{ color: 'hsl(var(--foreground))' }}>{label}</span>
        <span className="text-[10.5px] leading-tight block mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {sub}
        </span>
      </span>
      <span
        className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
        style={{ backgroundColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            backgroundColor: 'hsl(var(--card))',
            transform: on ? 'translateX(18px)' : 'translateX(2px)',
            boxShadow: '0 1px 2px hsl(var(--background) / 0.4)',
          }}
        />
      </span>
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <div
      className="flex gap-0.5 p-0.5 rounded-xl"
      style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="flex-1 px-2 py-1.5 rounded-[10px] text-[11px] font-medium transition-all"
          style={{
            backgroundColor: value === o.value ? 'hsl(var(--primary))' : 'transparent',
            color: value === o.value ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type ChatSettingsProps = {
  roomLevel: 'all' | 'mentions' | 'muted'
  onRoomLevel: (v: 'all' | 'mentions' | 'muted') => void
  wpPattern: WallpaperPattern
  onWpPattern: (v: WallpaperPattern) => void
  wpIntensity: WallpaperIntensity
  onWpIntensity: (v: WallpaperIntensity) => void
  wpAlpha: number
  soundOn: boolean
  onSoundOn: (v: boolean) => void
  volume: SoundVolume
  onVolume: (v: SoundVolume) => void
  focusOn: boolean
  onFocusOn: (v: boolean) => void
  trigger: MentionTrigger
  onTrigger: (v: MentionTrigger) => void
}

export default function ChatSettings(p: ChatSettingsProps) {
  return (
    <div className="space-y-5 p-1">
      {/* ── This conversation ───────────────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={Bell}
          title="This conversation"
          note="Follows your account — every device, everywhere you sign in"
        />
        <div className="space-y-1.5">
          {([
            ['all', 'Everything', 'Every new message', Bell],
            ['mentions', 'Mentions only', 'Only when someone @mentions you', AtSign],
            ['muted', 'Nothing', 'No pushes, no chime — the badge still counts', BellOff],
          ] as const).map(([value, label, sub, Icon]) => {
            const on = p.roomLevel === value
            return (
              <button
                key={value}
                onClick={() => p.onRoomLevel(value)}
                className="w-full flex items-center gap-2.5 text-left px-3 py-2.5 rounded-xl border transition-colors"
                style={{
                  backgroundColor: on ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--background))',
                  borderColor: on ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border))',
                }}
              >
                <Icon size={14} className="flex-shrink-0"
                  style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }} />
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium block"
                    style={{ color: on ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}>
                    {label}
                  </span>
                  <span className="text-[10.5px] leading-tight block mt-0.5"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {sub}
                  </span>
                </span>
                {on && <Check size={14} style={{ color: 'hsl(var(--primary))' }} className="flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Sound ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={Volume2}
          title="Sound"
          note="This device only. Softer again inside a chat you are already reading"
        />
        <div className="space-y-1.5">
          <Toggle
            on={p.soundOn}
            onChange={p.onSoundOn}
            label="Message chime"
            sub="Plays anywhere in the platform, not just here"
          />
          {p.soundOn && (
            <div className="px-0.5">
              <p className="text-[10px] mb-1.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Volume — choosing one plays it
              </p>
              <Segmented value={p.volume} options={VOLUMES} onChange={p.onVolume} />
            </div>
          )}
          <Toggle
            on={p.focusOn}
            onChange={p.onFocusOn}
            label="Focus mode"
            sub="Silence every chime on this device. Pushes still follow the rule above"
          />
        </div>
      </section>

      {/* ── Appearance ──────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={Palette}
          title="Appearance"
          note="This device. Every wallpaper is drawn live — no images to download"
        />
        {/* SHOW, DO NOT NAME: each tile renders the real pattern at the chosen
            intensity, so the choice is made once instead of guessed and undone. */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {WALLPAPERS.map(({ value, label }) => {
            const on = p.wpPattern === value
            return (
              <button
                key={value}
                onClick={() => p.onWpPattern(value)}
                className="relative rounded-xl overflow-hidden transition-all"
                style={{
                  height: 52,
                  border: `1px solid ${on ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                  boxShadow: on ? '0 0 0 2px hsl(var(--primary) / 0.25)' : 'none',
                }}
              >
                <span
                  className={value === 'none' ? '' : `tl-chat-bg tl-wp-${value}`}
                  style={{
                    position: 'absolute', inset: 0,
                    ['--tl-wp-a' as string]: p.wpAlpha,
                    backgroundColor: 'hsl(var(--background))',
                  }}
                />
                <span
                  className="absolute inset-x-0 bottom-0 text-[9px] font-semibold py-0.5"
                  style={{
                    backgroundColor: on ? 'hsl(var(--primary))' : 'hsl(var(--card) / 0.85)',
                    color: on ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                    backdropFilter: 'blur(3px)',
                  }}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
        <Segmented
          value={p.wpIntensity}
          options={[
            { value: 'faint' as const, label: 'Faint' },
            { value: 'medium' as const, label: 'Medium' },
            { value: 'bold' as const, label: 'Bold' },
          ]}
          onChange={p.onWpIntensity}
        />
      </section>

      {/* ── Composer ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={Keyboard}
          title="Composer"
          note="This device. Enter sends, Shift+Enter starts a new line"
        />
        <p className="text-[10px] mb-1.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Open the mention picker with
        </p>
        <Segmented
          value={p.trigger}
          options={[
            { value: 'at' as const, label: '@' },
            { value: 'slash' as const, label: '/' },
            { value: 'both' as const, label: 'Both' },
          ]}
          onChange={p.onTrigger}
        />
      </section>

      <p className="flex items-center gap-1.5 text-[10px] pt-1" style={{ color: 'hsl(var(--text-faint))' }}>
        <Moon size={10} />
        Appearance follows your theme automatically — light and dark are one setting.
      </p>
    </div>
  )
}
