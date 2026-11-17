import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'dark' | 'gold'

type BadgeProps = {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-white/10 text-[var(--sc-text-secondary)] border-white/10',
  accent: 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-hover)] border-[var(--sc-accent)]/35',
  dark: 'bg-black/75 text-white border-white/15 backdrop-blur-sm',
  gold: 'bg-amber-500/15 text-[var(--sc-gold)] border-amber-400/30',
}

/** Compact metadata or status pill following Design System tokens. */
export function Badge({ tone = 'neutral', className = '', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--sc-radius-sm)] border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
