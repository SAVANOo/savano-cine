import type { PlayableMedia } from '../../domain/uiHelpers'

type PlayerEpisodesDrawerProps = {
  media: PlayableMedia
  selectedSeason: number
  hoveredEpisodeId: string | null
  onSelectSeason: (season: number) => void
  onHoverEpisode: (episodeId: string | null) => void
  onClose: () => void
  onPlayNext?: (next: PlayableMedia) => void
}

/** Netflix-style episode selector drawer rendered inside the video player. */
export function PlayerEpisodesDrawer({
  media,
  selectedSeason,
  hoveredEpisodeId,
  onSelectSeason,
  onHoverEpisode,
  onClose,
  onPlayNext,
}: PlayerEpisodesDrawerProps) {
  if (!media.showSeasons || media.showSeasons.length === 0) return null

  const activeSeason =
    media.showSeasons.find((s) => s.number === selectedSeason) ?? media.showSeasons[0]
  const flatEpisodes = media.showSeasons.flatMap((s) =>
    s.episodes.filter((item) => Boolean(item.mediaUrl)),
  )

  return (
    <div className="pointer-events-auto absolute right-6 bottom-24 z-30 flex max-h-[65vh] w-[min(92vw,440px)] flex-col overflow-hidden rounded-[var(--sc-radius-lg)] border border-white/15 bg-[#14151e]/96 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <strong className="truncate text-sm font-bold text-white">
          {media.showTitle || 'Episódios'}
        </strong>
        {media.showSeasons.length > 1 && (
          <select
            aria-label="Selecionar temporada"
            value={selectedSeason}
            onChange={(event) => onSelectSeason(Number(event.target.value))}
            className="rounded border border-white/15 bg-black/50 px-2.5 py-1 text-xs font-semibold text-white focus:outline-none"
          >
            {media.showSeasons.map((s) => (
              <option key={s.number} value={s.number}>
                {s.label || `Temporada ${s.number}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-col divide-y divide-white/5 overflow-y-auto">
        {activeSeason.episodes.map((ep) => {
          const isCurrent = ep.mediaId === media.mediaId
          const isExpanded = isCurrent || hoveredEpisodeId === ep.id
          const epProgress = Math.max(0, Math.min(100, ep.progress ?? 0))
          const epIdx = flatEpisodes.findIndex((item) => item.mediaId === ep.mediaId)
          const nextAfterEp =
            epIdx >= 0 && epIdx + 1 < flatEpisodes.length ? flatEpisodes[epIdx + 1] : undefined
          return (
            <button
              key={ep.id}
              type="button"
              onMouseEnter={() => onHoverEpisode(ep.id)}
              onMouseLeave={() => onHoverEpisode(null)}
              onClick={() => {
                if (!ep.mediaUrl || !onPlayNext) return
                onClose()
                onPlayNext({
                  title: `${media.showTitle || 'Série'} — T${ep.season}:E${ep.number} ${ep.title}`,
                  url: ep.mediaUrl,
                  subtitleUrl: ep.subtitleUrl,
                  mediaId: ep.mediaId,
                  needsTranscode: ep.needsTranscode,
                  overview: media.overview,
                  year: media.year,
                  startPosition: 0,
                  showTitle: media.showTitle,
                  showSeasons: media.showSeasons,
                  nextEpisode: nextAfterEp?.mediaUrl
                    ? {
                        title: `${media.showTitle || 'Série'} — T${nextAfterEp.season}:E${nextAfterEp.number} ${nextAfterEp.title}`,
                        url: nextAfterEp.mediaUrl,
                        subtitleUrl: nextAfterEp.subtitleUrl,
                        mediaId: nextAfterEp.mediaId,
                        needsTranscode: nextAfterEp.needsTranscode,
                        overview: media.overview,
                        year: media.year,
                        startPosition: 0,
                        showTitle: media.showTitle,
                        showSeasons: media.showSeasons,
                      }
                    : undefined,
                })
              }}
              className={`flex flex-col gap-2.5 border-0 px-4 py-3 text-left transition cursor-pointer ${
                isCurrent ? 'bg-white/10' : 'bg-transparent hover:bg-white/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-white/60">
                    {ep.number}
                  </span>
                  <span className="truncate text-sm font-semibold text-white">
                    {ep.title}
                  </span>
                </div>
                <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full bg-[var(--sc-accent)]"
                    style={{ width: `${isCurrent ? Math.max(epProgress, 15) : epProgress}%` }}
                  />
                </div>
              </div>
              {isExpanded && (
                <div className="flex items-center gap-3 pl-9">
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-black/70">
                    {ep.thumbnailUrl && (
                      <img
                        src={ep.thumbnailUrl}
                        alt={ep.title}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none'
                        }}
                        className="h-full w-full object-cover"
                      />
                    )}
                    {isCurrent && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-bold text-white">
                        Assistindo
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-[11px] text-[var(--sc-text-secondary)]">
                    {epProgress >= 90
                      ? 'Assistido'
                      : ep.position || (isCurrent ? 'Reproduzindo agora' : ep.duration || 'Não assistido')}
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
