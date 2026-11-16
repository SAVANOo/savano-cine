import { X } from 'lucide-react'
import type { ReactNode } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  eyebrow?: string
  title: string
  subtitle?: string
  maxWidthClass?: string
  children: ReactNode
}

/** Standardized accessible modal shell with blurred backdrop and clean close button. */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  maxWidthClass = 'max-w-3xl',
  children,
}: ModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`relative flex max-h-[88vh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-[var(--sc-radius-xl)] border border-[var(--sc-border-strong)] bg-[var(--sc-bg-elevated)] shadow-[var(--sc-shadow-modal)]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--sc-border-subtle)] px-6 py-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--sc-accent)]">
                {eyebrow}
              </p>
            )}
            <h2 className="mt-0.5 mb-0 truncate text-lg font-bold text-[var(--sc-text-primary)]">{title}</h2>
            {subtitle && (
              <p className="mt-1 mb-0 text-xs text-[var(--sc-text-secondary)]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-[var(--sc-text-secondary)] transition hover:bg-[var(--sc-bg-surface-hover)] hover:text-[var(--sc-text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}
