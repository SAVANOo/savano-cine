import { Check, ChevronLeft, ChevronRight, Info, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import { resolvePlayableMedia, translateGenre } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type HeroCarouselProps = {
  items: LibraryItem[]
  onPlay: (item: LibraryItem) => void
  onOpenDetails: (item: LibraryItem) => void
  onToggleWatchlist?: (item: LibraryItem) => void
}

/** Netflix / Prime Video style rotating hero spotlight with Play + More Info CTAs. */
export function HeroCarousel({ items, onPlay, onOpenDetails, onToggleWatchlist }: HeroCarouselProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const slides = items.slice(0, 6)
  const safeIndex = slides.length > 0 ? index % slides.length : 0
  const active = slides[safeIndex]

  useEffect(() => {
    if (slides.length <= 1 || paused) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [slides.length, paused])

  if (!active) return null

  const backdrop = active.artwork.bannerUrl || active.artwork.posterUrl
  const playable = Boolean(resolvePlayableMedia(active))
  const hasProgress = Boolean(active.resume) || (active.progress ?? 0) > 0

  return (
    <section
      className="relative overflow-hidden rounded-[var(--sc-radius-xl)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] shadow-[var(--sc-shadow-card)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Backdrop Image + Cinematic Gradient */}
      <div className="relative min-h-[340px] sm:min-h-[410px] lg:min-h-[450px]">
        {backdrop ? (
          <img
            src={backdrop}
            alt={active.title}
            className="absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-500"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-red-950/50 via-neutral-900 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-transparent to-black/30" />

        {/* Content */}
        <div className="relative z-10 flex min-h-[340px] max-w-2xl flex-col justify-end p-6 sm:min-h-[410px] sm:p-10 lg:min-h-[450px]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{active.kind}</Badge>
            {active.year && <Badge tone="dark">{active.year}</Badge>}
            {(active.genres ?? []).slice(0, 3).map((genre) => (
              <Badge key={genre} tone="neutral">
                {translateGenre(genre)}
              </Badge>
            ))}
          </div>

          <h1 className="m-0 text-2xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {active.title}
          </h1>

          <p className="mt-2 mb-0 text-xs font-medium text-[var(--sc-text-secondary)] sm:text-sm">
            {active.meta}
            {active.resume?.season && active.resume?.episode
              ? ` · Continuar T${active.resume.season}:E${active.resume.episode}`
              : ''}
          </p>

          <p className="mt-3 mb-0 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/80">
            {active.overview || 'Pronto para assistir diretamente do seu catálogo local.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {playable && (
              <Button variant="light" size="lg" onClick={() => onPlay(active)}>
                <Play className="h-4 w-4 fill-current" />
                {hasProgress ? 'Retome' : 'Assistir'}
              </Button>
            )}
            <Button variant="secondary" size="lg" onClick={() => onOpenDetails(active)}>
              <Info className="h-4 w-4" />
              Mais informações
            </Button>
            {onToggleWatchlist && (
              <Button variant="secondary" size="lg" onClick={() => onToggleWatchlist(active)}>
                {active.inWatchlist ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {active.inWatchlist ? 'Na minha lista' : 'Minha lista'}
              </Button>
            )}
          </div>
        </div>

        {/* Carousel Navigation */}
        {slides.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Destaque anterior"
              onClick={() => setIndex((current) => (current - 1 + slides.length) % slides.length)}
              className="absolute top-1/2 left-3 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 backdrop-blur-md transition hover:bg-black/80 sm:flex cursor-pointer"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Próximo destaque"
              onClick={() => setIndex((current) => (current + 1) % slides.length)}
              className="absolute top-1/2 right-3 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/90 backdrop-blur-md transition hover:bg-black/80 sm:flex cursor-pointer"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="absolute right-6 bottom-5 z-20 flex items-center gap-1.5">
              {slides.map((slide, slideIndex) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Ir para destaque ${slideIndex + 1}`}
                  onClick={() => setIndex(slideIndex)}
                  className={`h-2 rounded-full border-0 transition-all cursor-pointer ${
                    slideIndex === safeIndex ? 'w-6 bg-white' : 'w-2 bg-white/35 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
