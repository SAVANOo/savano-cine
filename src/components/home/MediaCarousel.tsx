import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import { MediaCard } from '../media/MediaCard'

type MediaCarouselProps = {
  title: string
  subtitle?: string
  items: LibraryItem[]
  variant?: 'poster' | 'landscape'
  onPlay: (item: LibraryItem) => void
  onOpenDetails: (item: LibraryItem) => void
  onToggleWatchlist?: (item: LibraryItem) => void
}

/** Horizontal streaming carousel row with smooth scroll arrows. */
export function MediaCarousel({
  title,
  subtitle,
  items,
  variant = 'poster',
  onPlay,
  onOpenDetails,
  onToggleWatchlist,
}: MediaCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)

  if (items.length === 0) return null

  function scrollByDirection(direction: -1 | 1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(360, el.clientWidth * 0.78), behavior: 'smooth' })
  }

  return (
    <section className="group/row relative flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h2 className="m-0 text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
          {subtitle && <span className="text-xs text-[var(--sc-text-muted)]">{subtitle}</span>}
        </div>
        <span className="text-xs font-medium text-[var(--sc-text-muted)]">{items.length} títulos</span>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={`Rolar ${title} para a esquerda`}
          onClick={() => scrollByDirection(-1)}
          className="absolute top-1/2 left-1 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white opacity-0 backdrop-blur-md transition group-hover/row:opacity-100 hover:bg-black sm:flex cursor-pointer"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div
          ref={trackRef}
          className="sc-no-scrollbar flex gap-4 overflow-x-auto scroll-smooth pb-2"
        >
          {items.map((item) => (
            <div
              key={item.id}
              className={
                variant === 'landscape'
                  ? 'w-[260px] shrink-0 sm:w-[300px]'
                  : 'w-[164px] shrink-0 sm:w-[190px]'
              }
            >
              <MediaCard
                item={item}
                variant={variant}
                onPlay={onPlay}
                onOpenDetails={onOpenDetails}
                onToggleWatchlist={onToggleWatchlist}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-label={`Rolar ${title} para a direita`}
          onClick={() => scrollByDirection(1)}
          className="absolute top-1/2 right-1 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white opacity-0 backdrop-blur-md transition group-hover/row:opacity-100 hover:bg-black sm:flex cursor-pointer"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}
