import { Check, Info, Play, Plus, Star } from 'lucide-react'
import type { LibraryItem } from '../../domain/catalog'
import { resolvePlayableMedia, translateGenre } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'

type MediaCardProps = {
  item: LibraryItem
  variant?: 'poster' | 'landscape'
  onPlay: (item: LibraryItem) => void
  onOpenDetails: (item: LibraryItem) => void
  onToggleWatchlist?: (item: LibraryItem) => void
}

/**
 * Streaming media card:
 * - Clicking the cover/play area starts playback directly.
 * - Clicking the info button (or title/meta footer) opens the detail view.
 */
export function MediaCard({ item, variant = 'poster', onPlay, onOpenDetails, onToggleWatchlist }: MediaCardProps) {
  const playable = Boolean(resolvePlayableMedia(item))
  const hasSubtitles =
    Boolean(item.subtitleUrl) ||
    Boolean(item.subtitles?.some((sub) => sub.available)) ||
    Boolean(item.seasons?.some((s) => s.episodes.some((ep) => ep.subtitles.some((sub) => sub.available))))
  const imageUrl =
    variant === 'landscape'
      ? item.artwork.bannerUrl || item.artwork.posterUrl
      : item.artwork.posterUrl || item.artwork.bannerUrl
  const stars = item.rating?.score ? Math.max(1, Math.min(5, Math.round(item.rating.score / 2))) : 0
  const progress = Math.max(0, Math.min(100, item.progress ?? 0))

  function handleCoverClick() {
    if (playable) {
      onPlay(item)
    } else {
      onOpenDetails(item)
    }
  }

  return (
    <article className="group relative flex h-full w-full flex-col overflow-hidden rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] transition-all duration-200 hover:border-white/30 hover:shadow-[var(--sc-shadow-card)]">
      {/* Cover / Direct Play Zone */}
      <button
        type="button"
        onClick={handleCoverClick}
        aria-label={playable ? `Assistir ${item.title}` : `Abrir detalhes de ${item.title}`}
        className={`sc-clickable-card relative w-full overflow-hidden border-0 bg-neutral-900 p-0 text-left ${
          variant === 'landscape' ? 'aspect-video' : 'aspect-[2/3]'
        }`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-4 text-center">
            <span className="line-clamp-3 text-sm font-bold text-white/90">{item.title}</span>
            {item.year && <span className="mt-1 text-xs text-white/55">{item.year}</span>}
          </div>
        )}

        {/* Top badges */}
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-1.5">
          <Badge tone="dark">{item.kind}</Badge>
          {hasSubtitles && <Badge tone="dark">CC</Badge>}
        </div>

        {/* Center Play Hover Overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/45">
          <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/95 text-neutral-950 opacity-0 shadow-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </div>

        {/* Progress Bar */}
        {progress > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-[var(--sc-accent)]" style={{ width: `${progress}%` }} />
          </div>
        )}
      </button>

      {/* Card Footer: Title + Info Button */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(item)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left cursor-pointer"
            title={`Mais informações sobre ${item.title}`}
          >
            <h3 className="m-0 min-h-[2.5rem] line-clamp-2 text-sm font-semibold leading-snug text-white transition-colors group-hover:text-white">
              {item.title}
            </h3>
            <p className="mt-1 mb-0 truncate text-xs text-[var(--sc-text-secondary)]">
              {item.year ? `${item.year} · ` : ''}
              {item.meta}
            </p>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            {onToggleWatchlist && (
              <button
                type="button"
                onClick={() => onToggleWatchlist(item)}
                aria-label={item.inWatchlist ? `Remover ${item.title} da minha lista` : `Adicionar ${item.title} à minha lista`}
                title={item.inWatchlist ? 'Na minha lista' : 'Adicionar à minha lista'}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                  item.inWatchlist
                    ? 'border-[var(--sc-accent)] bg-[var(--sc-accent-soft)] text-white'
                    : 'border-white/15 bg-white/8 text-white/85 hover:border-white/40 hover:bg-white/20 hover:text-white'
                }`}
              >
                {item.inWatchlist ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenDetails(item)}
              aria-label={`Mais informações sobre ${item.title}`}
              title="Mais informações"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/85 transition hover:border-white/40 hover:bg-white/20 hover:text-white"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--sc-text-muted)]">
          <span className="truncate">
            {(item.genres ?? []).slice(0, 2).map(translateGenre).join(' · ') || item.detail}
          </span>
          {stars > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[var(--sc-gold)]">
              <Star className="h-3 w-3 fill-current" />
              {stars}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
