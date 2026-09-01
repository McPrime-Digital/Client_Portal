import type { SpaceId } from '@/lib/studio/spaces'
import type { CSSProperties, ReactNode } from 'react'

// The landing view of each studio space: what this floor of the building IS,
// told once, well — then an animated stage that shows the work instead of a
// wall of feature cards (the rail already lists those). Pure CSS/SVG motion,
// no client JS; every animation opts out under prefers-reduced-motion.

const COPY: Record<SpaceId, { eyebrow: string; lead: string; body: string; caption: string }> = {
  crew: {
    eyebrow: 'Team only · Operations',
    lead: 'The studio behind the studio.',
    body: 'Chat, tasks, calendar, meetings and the CRM pipeline — with the control tower watching cost and cadence over every AI run. This is the operational spine your clients never see: every department on one rhythm, every handoff on the record, nothing living in someone’s inbox.',
    caption: 'Crew — live operations',
  },
  client: {
    eyebrow: 'Client-facing · Your brand',
    lead: 'Every client touchpoint, under your name.',
    body: 'Projects, frame-accurate review and approvals, deliverables, files, messages and invoices — the whole client relationship in one place, wearing your studio’s brand. Clients get a portal that feels built by you; you see every cut, comment and payment the moment it lands.',
    caption: 'Client — frame-accurate review',
  },
  workspace: {
    eyebrow: 'The craft floor · End to end',
    lead: 'Where the film gets made.',
    body: 'Script Design through storyboard into the pipeline graph — then The Stage for generation, Remaster for restoration and the Finishing Suite for sound, color and mastering. One production engine carries a project from first line to final frame, with continuity and provenance tracked shot by shot.',
    caption: 'Workspace — the production pipeline',
  },
}

const VIOLET = '#A78BFA'
const GOLD = '#E3BD63'

const d = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` })

/** Shared panel chrome inside the Crew stage. */
function StagePanel({ x, y, title }: { x: number; y: number; title: string }) {
  return (
    <>
      <rect x={x} y={y} width={320} height={320} rx={20} fill="rgba(255,255,255,0.035)" stroke="rgba(167,139,250,0.28)" />
      <circle cx={x + 26} cy={y + 30} r={3.5} fill={GOLD} />
      <text x={x + 40} y={y + 35} fontSize={12} letterSpacing={2.5} fill="rgba(255,255,255,0.5)" fontFamily="var(--font-display)" fontWeight={700}>
        {title}
      </text>
      <line x1={x + 22} y1={y + 52} x2={x + 298} y2={y + 52} stroke="rgba(167,139,250,0.18)" />
    </>
  )
}

function CrewStage() {
  return (
    <svg viewBox="0 0 1200 460" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <StagePanel x={60} y={70} title="CHAT" />
      <StagePanel x={440} y={70} title="TASKS" />
      <StagePanel x={820} y={70} title="PIPELINE" />

      {/* Chat — messages land, presence stays alive */}
      <g className="gl-rise" style={d(500)}>
        <circle cx={98} cy={158} r={11} fill="rgba(167,139,250,0.5)" />
        <rect x={120} y={138} width={190} height={42} rx={13} fill="rgba(167,139,250,0.16)" />
        <rect x={136} y={152} width={130} height={5} rx={2.5} fill="rgba(255,255,255,0.3)" />
        <rect x={136} y={164} width={90} height={5} rx={2.5} fill="rgba(255,255,255,0.18)" />
      </g>
      <g className="gl-rise" style={d(950)}>
        <rect x={138} y={196} width={216} height={48} rx={13} fill="rgba(227,189,99,0.13)" stroke="rgba(227,189,99,0.3)" />
        <rect x={154} y={211} width={150} height={5} rx={2.5} fill="rgba(255,255,255,0.32)" />
        <rect x={154} y={223} width={108} height={5} rx={2.5} fill="rgba(255,255,255,0.18)" />
      </g>
      <g className="gl-rise" style={d(1400)}>
        <circle cx={98} cy={280} r={11} fill="rgba(227,189,99,0.5)" />
        <rect x={120} y={260} width={168} height={42} rx={13} fill="rgba(167,139,250,0.16)" />
        <rect x={136} y={274} width={116} height={5} rx={2.5} fill="rgba(255,255,255,0.3)" />
        <rect x={136} y={286} width={70} height={5} rx={2.5} fill="rgba(255,255,255,0.18)" />
      </g>
      <circle className="gl-pulse" style={d(0)} cx={98} cy={352} r={8} fill="rgba(167,139,250,0.7)" />
      <circle className="gl-pulse" style={d(600)} cx={122} cy={352} r={8} fill="rgba(227,189,99,0.7)" />
      <circle className="gl-pulse" style={d(1200)} cx={146} cy={352} r={8} fill="rgba(255,255,255,0.4)" />
      <text x={168} y={357} fontSize={11} letterSpacing={2} fill="rgba(255,255,255,0.45)" fontFamily="var(--font-display)">3 ONLINE</text>

      {/* Tasks — the day ticks itself off */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} className="gl-rise" style={d(600 + i * 220)}>
          <rect x={472} y={126 + i * 54} width={19} height={19} rx={6} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
          <rect x={506} y={132 + i * 54} width={[176, 128, 196, 148][i]} height={6} rx={3} fill="rgba(255,255,255,0.22)" />
        </g>
      ))}
      <path className="gl-draw" style={{ ...d(1700), strokeDasharray: 22, strokeDashoffset: 22 }} d="M476 135 l5 6 l9 -10" fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <path className="gl-draw" style={{ ...d(2100), strokeDasharray: 22, strokeDashoffset: 22 }} d="M476 189 l5 6 l9 -10" fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={472} y={348} width={256} height={7} rx={3.5} fill="rgba(255,255,255,0.1)" />
      <rect className="gl-fill" style={d(2300)} x={472} y={348} width={166} height={7} rx={3.5} fill={GOLD} opacity={0.85} />

      {/* Pipeline — the funnel fills, work moves down it */}
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          className="gl-fill"
          style={d(700 + i * 240)}
          x={852}
          y={128 + i * 48}
          width={[252, 204, 156, 108][i]}
          height={27}
          rx={9}
          fill={`rgba(167,139,250,${[0.42, 0.33, 0.25, 0.18][i]})`}
          stroke="rgba(167,139,250,0.3)"
        />
      ))}
      <circle className="gl-pulse" cx={862} cy={344} r={4} fill={GOLD} />
      <text x={876} y={349} fontSize={11} letterSpacing={2} fill="rgba(255,255,255,0.45)" fontFamily="var(--font-display)">3 IN PRODUCTION</text>
    </svg>
  )
}

function ClientStage() {
  return (
    <svg viewBox="0 0 1200 460" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <clipPath id="gl-frame">
          <rect x={150} y={40} width={900} height={270} rx={18} />
        </clipPath>
        <linearGradient id="gl-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c1440" />
          <stop offset="62%" stopColor="#3b2a63" />
          <stop offset="100%" stopColor="#8a5a4f" />
        </linearGradient>
        <radialGradient id="gl-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.95" />
          <stop offset="70%" stopColor={GOLD} stopOpacity="0.35" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The cut under review */}
      <g clipPath="url(#gl-frame)">
        <rect x={150} y={40} width={900} height={270} fill="url(#gl-sky)" />
        <circle cx={600} cy={214} r={64} fill="url(#gl-sun)" />
        <circle cx={600} cy={214} r={26} fill={GOLD} opacity={0.9} />
        <path d="M150 262 L340 196 L470 250 L640 208 L810 258 L960 216 L1050 244 L1050 310 L150 310 Z" fill="#0d0a1c" opacity={0.92} />
        <line x1={150} y1={252} x2={1050} y2={252} stroke="rgba(227,189,99,0.25)" />
      </g>
      <rect x={150} y={40} width={900} height={270} rx={18} fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth={1.5} />
      <text x={172} y={70} fontSize={11} letterSpacing={2.5} fill="rgba(255,255,255,0.6)" fontFamily="var(--font-display)" fontWeight={700}>CUT 04 · CLIENT REVIEW</text>
      <text x={1028} y={70} fontSize={11} letterSpacing={1.5} textAnchor="end" fill={GOLD} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">TC 00:42:17:08</text>

      {/* Approval lands */}
      <g className="gl-pop" style={d(3000)}>
        <rect x={876} y={92} width={136} height={34} rx={17} fill="rgba(227,189,99,0.14)" stroke={GOLD} strokeWidth={1.5} />
        <text x={944} y={114} fontSize={11.5} letterSpacing={2.5} textAnchor="middle" fill={GOLD} fontFamily="var(--font-display)" fontWeight={700}>APPROVED</text>
      </g>

      {/* Timeline — the playhead scrubs, notes land on frames, not paragraphs */}
      <rect x={150} y={360} width={900} height={8} rx={4} fill="rgba(255,255,255,0.08)" />
      {[
        { x: 390, delay: 1100 },
        { x: 640, delay: 2100 },
        { x: 830, delay: 2700 },
      ].map((p) => (
        <g key={p.x} className="gl-pop" style={d(p.delay)}>
          <circle cx={p.x} cy={364} r={9} fill="#7C5CFA" stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} />
          <circle cx={p.x} cy={364} r={2.5} fill="#fff" />
        </g>
      ))}
      <g className="gl-scrub" style={{ '--gl-travel': '860px' } as CSSProperties}>
        <line x1={170} y1={340} x2={170} y2={388} stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={170} cy={364} r={7} fill={GOLD} />
      </g>
      <text x={150} y={412} fontSize={10} letterSpacing={2} fill="rgba(255,255,255,0.35)" fontFamily="var(--font-display)">00:00</text>
      <text x={1050} y={412} fontSize={10} letterSpacing={2} textAnchor="end" fill="rgba(255,255,255,0.35)" fontFamily="var(--font-display)">03:12</text>
    </svg>
  )
}

const NODES: { x: number; y: number; label: string; core?: boolean }[] = [
  { x: 150, y: 240, label: 'SCRIPT' },
  { x: 390, y: 130, label: 'STORYBOARD' },
  { x: 620, y: 290, label: 'THE STAGE', core: true },
  { x: 850, y: 140, label: 'REMASTER' },
  { x: 1070, y: 250, label: 'FINISH' },
]

function WorkspaceStage() {
  const edges = NODES.slice(0, -1).map((n, i) => {
    const m = NODES[i + 1]
    const midX = (n.x + m.x) / 2
    return `M${n.x} ${n.y} C ${midX} ${n.y}, ${midX} ${m.y}, ${m.x} ${m.y}`
  })
  return (
    <svg viewBox="0 0 1200 460" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {/* The graph — work flows left to right */}
      {edges.map((path, i) => (
        <g key={i}>
          <path d={path} fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth={2} />
          <path className="gl-flow" style={d(i * 400)} d={path} fill="none" stroke={VIOLET} strokeOpacity={0.75} strokeWidth={2} strokeDasharray="8 14" strokeLinecap="round" />
        </g>
      ))}
      <circle className="gl-pulse" cx={620} cy={290} r={44} fill="rgba(167,139,250,0.14)" />
      {NODES.map((n, i) => (
        <g key={n.label} className="gl-pop" style={d(400 + i * 300)}>
          <rect x={n.x - 72} y={n.y - 24} width={144} height={48} rx={14} fill="rgba(18,14,38,0.94)" stroke={n.core ? GOLD : 'rgba(167,139,250,0.45)'} strokeWidth={1.5} />
          <circle cx={n.x - 52} cy={n.y} r={4} fill={n.core ? GOLD : VIOLET} />
          <text x={n.x + 8} y={n.y + 4} fontSize={11} letterSpacing={1.8} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-display)" fontWeight={700}>
            {n.label}
          </text>
        </g>
      ))}

      {/* Frames rendering out along the bottom */}
      {Array.from({ length: 10 }).map((_, i) => (
        <rect
          key={i}
          className="gl-rise"
          style={d(1800 + i * 90)}
          x={150 + i * 92}
          y={378}
          width={72}
          height={44}
          rx={7}
          fill={i === 6 ? 'rgba(227,189,99,0.3)' : i % 2 ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.05)'}
          stroke="rgba(167,139,250,0.2)"
        />
      ))}
      <text x={150} y={368} fontSize={10} letterSpacing={2.5} fill="rgba(255,255,255,0.35)" fontFamily="var(--font-display)">RENDER QUEUE</text>
    </svg>
  )
}

const STAGES: Record<SpaceId, () => ReactNode> = {
  crew: CrewStage,
  client: ClientStage,
  workspace: WorkspaceStage,
}

export default function SpaceShowcase({ space, label }: { space: SpaceId; label: string }) {
  const c = COPY[space]
  const Stage = STAGES[space]
  return (
    <div className="mx-auto max-w-5xl">
      <p className="gl-rise font-display text-[11px] font-bold uppercase tracking-[0.22em] text-glow" style={d(0)}>
        {c.eyebrow}
      </p>
      <h1 className="gl-rise mt-3 font-display text-3xl font-bold uppercase tracking-[0.08em] text-foreground sm:text-5xl" style={d(80)}>
        {label}
      </h1>
      <p className="gl-rise mt-4 font-display text-lg font-semibold text-foreground sm:text-xl" style={d(160)}>
        {c.lead}
      </p>
      <p className="gl-rise mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]" style={d(240)}>
        {c.body}
      </p>

      {/* The stage — a dark screening panel in both themes, deliberately. */}
      <div className="gl-rise mt-8" style={d(360)}>
        <div
          className="squircle-lg relative overflow-hidden border border-glow/25 shadow-[0_0_0_1px_hsl(var(--glow)/0.08),0_28px_64px_-36px_hsl(var(--glow)/0.6)]"
          style={{ background: 'radial-gradient(130% 150% at 50% -25%, #1c1732 0%, #0d0b1a 58%, #07060f 100%)' }}
        >
          <div className="relative aspect-[16/10] w-full sm:aspect-[1200/460]">
            <Stage />
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">{c.caption}</p>
      </div>
    </div>
  )
}
