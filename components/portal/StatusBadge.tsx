type Props = {
  status: string
  size?: 'xs' | 'sm' | 'md'
}

export default function StatusBadge({
  status,
  size = 'sm',
}: Props) {
  const map: Record<string, { bg: string; color: string }> =
    {
      Onboarding: {
        bg: 'hsl(var(--status-blue) / 0.12)',
        color: 'hsl(var(--status-blue))',
      },
      'Pre-Production': {
        bg: 'hsl(var(--status-violet) / 0.12)',
        color: 'hsl(var(--status-violet))',
      },
      'In Production': {
        bg: 'hsl(var(--primary) / 0.12)',
        color: 'hsl(var(--primary))',
      },
      'Post-Production': {
        bg: 'hsl(var(--primary) / 0.12)',
        color: 'hsl(var(--primary))',
      },
      'In Review': {
        bg: 'hsl(var(--status-blue) / 0.12)',
        color: 'hsl(var(--status-blue))',
      },
      Revisions: {
        bg: 'hsl(var(--destructive) / 0.12)',
        color: 'hsl(var(--destructive))',
      },
      Completed: {
        bg: 'hsl(var(--status-green) / 0.12)',
        color: 'hsl(var(--status-green))',
      },
      'On Hold': {
        bg: 'hsl(var(--muted-foreground) / 0.12)',
        color: 'hsl(var(--muted-foreground))',
      },
    }

  const style = map[status] ?? {
    bg: 'hsl(var(--muted-foreground) / 0.12)',
    color: 'hsl(var(--muted-foreground))',
  }

  const sizeClass = {
    xs: 'text-[10px] px-2 py-0.5',
    sm: 'text-xs px-2.5 py-1',
    md: 'text-sm px-3 py-1.5',
  }[size]

  return (
    <span
      className={`inline-flex items-center rounded-full 
      font-semibold ${sizeClass}`}
      style={{
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  )
}
