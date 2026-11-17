import { SavanoLogo } from './SavanoLogo'

type SavanoLoaderProps = {
  label?: string
  fullscreen?: boolean
}

/** Branded Savano Cine animated snake-to-play emblem loader. */
export function SavanoLoader({ label = 'Carregando...', fullscreen = false }: SavanoLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullscreen
          ? 'fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-[var(--sc-bg-canvas)]/90 backdrop-blur-md'
          : 'flex flex-col items-center justify-center gap-3 py-12'
      }
    >
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-[var(--sc-accent)]/25" />
        <SavanoLogo size={60} animated className="relative shadow-xl" />
      </div>
      <p className="m-0 text-xs font-semibold tracking-wide text-[var(--sc-text-secondary)]">{label}</p>
    </div>
  )
}
