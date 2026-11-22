import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  eyebrow?: string
  title: string
  subtitle?: string
  maxWidthClass?: string
  children: ReactNode
}

/** Standardized accessible modal shell with focus trap, Escape handling, and focus restoration. */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  maxWidthClass = 'max-w-3xl',
  children,
}: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = dialogRef.current
    const focusables = container
      ? Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
      : []
    focusables[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
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
            <h2 id={titleId} className="mt-0.5 mb-0 truncate text-lg font-bold text-[var(--sc-text-primary)]">{title}</h2>
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
