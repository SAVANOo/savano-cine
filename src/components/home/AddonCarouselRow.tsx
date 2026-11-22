import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AddonMetaSummary } from '../addons/AddonStreamModal'

type AddonCarouselRowProps = {
  title: string
  subtitle?: string
  items: AddonMetaSummary[]
  onSelect: (item: AddonMetaSummary) => void
  onRemove?: (item: AddonMetaSummary) => void
  actionLabel?: string
  onAction?: () => void
}

/** Horizontal addon catalog carousel row with smooth arrow navigation matching MediaCarousel. */
export function AddonCarouselRow({
  title,
  subtitle,
  items,
  onSelect,
  onRemove,
  actionLabel,
  onAction,
}: AddonCarouselRowProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [brokenPosters, setBrokenPosters] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const check = () => setHasOverflow(el.scrollWidth > el.clientWidth + 4)
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [items.length])

  if (items.length === 0) return null

  function scrollByDirection(direction: -1 | 1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(360, el.clientWidth * 0.78), behavior: 'smooth' })
  }

  return (
    <section className="group/row relative flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-lg font-bold tracking-tight text-[var(--sc-text-primary)] sm:text-xl">{title}</h2>
          {subtitle && <span className="text-xs text-[var(--sc-text-muted)]">{subtitle}</span>}
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-xs font-semibold text-[var(--sc-accent)] hover:underline cursor-pointer"
          >
            {actionLabel}
          </button>
        ) : (
          <span className="text-xs font-medium text-[var(--sc-text-muted)]">{items.length} títulos</span>
        )}
      </div>

      <div className="relative">
        {hasOverflow && (
          <button
            type="button"
            onClick={() => scrollByDirection(-1)}
            aria-label={`Rolar ${title} para a esquerda`}
            className="absolute top-1/2 left-1 z-20 hidden -translate-y-1/2 rounded-full border border-white/15 bg-black/75 p-2 text-white opacity-0 shadow-xl backdrop-blur-md transition group-hover/row:opacity-100 hover:border-[var(--sc-accent)] hover:bg-black sm:flex cursor-pointer"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        <div
          ref={trackRef}
          className="sc-no-scrollbar flex gap-3.5 overflow-x-auto scroll-smooth pb-2"
        >
          {items.map((item) => {
            const cardKey = `${title}-${item.type}-${item.id}`
            const showPoster = Boolean(item.poster) && !brokenPosters.has(item.poster!)
            return (
              <div
                key={cardKey}
                className="group relative w-[150px] shrink-0 overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)]/60 sm:w-[172px]"
              >
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="w-full text-left cursor-pointer"
                >
                  <div className="relative aspect-[2/3] w-full bg-gradient-to-br from-neutral-900 via-neutral-950 to-black">
                    {showPoster ? (
                      <img
                        src={item.poster!}
                        alt={item.name}
                        loading="lazy"
                        onError={() =>
                          setBrokenPosters((prev) => new Set(prev).add(item.poster!))
                        }
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center p-3 text-center">
                        <span className="line-clamp-3 text-xs font-bold text-white/90">{item.name}</span>
                        {item.releaseInfo ? (
                          <span className="mt-1 text-[10px] text-[var(--sc-text-muted)]">{item.releaseInfo}</span>
                        ) : null}
                      </div>
                    )}
                    <span className="absolute top-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      {item.type === 'movie' ? 'Filme' : item.type === 'anime' ? 'Anime' : 'Série'}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="m-0 truncate text-xs font-semibold text-[var(--sc-text-primary)]">{item.name}</p>
                    <p className="m-0 truncate text-[11px] text-[var(--sc-text-muted)]">
                      {item.addonName || 'Online'}
                      {item.releaseInfo ? ` · ${item.releaseInfo}` : ''}
                    </p>
                  </div>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    aria-label={`Remover ${item.name} de ${title}`}
                    title="Remover da lista"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(item)
                    }}
                    className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-white/80 opacity-0 transition group-hover:opacity-100 hover:bg-red-600 hover:text-white cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {hasOverflow && (
          <button
            type="button"
            onClick={() => scrollByDirection(1)}
            aria-label={`Rolar ${title} para a direita`}
            className="absolute top-1/2 right-1 z-20 hidden -translate-y-1/2 rounded-full border border-white/15 bg-black/75 p-2 text-white opacity-0 shadow-xl backdrop-blur-md transition group-hover/row:opacity-100 hover:border-[var(--sc-accent)] hover:bg-black sm:flex cursor-pointer"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </section>
  )
}
