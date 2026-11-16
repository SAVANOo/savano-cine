import { Check } from 'lucide-react'

type TrackOption = {
  index: number
  language: string
  title: string
}

type SubtitleTrackItem = {
  label: string
  url: string
}

type PlayerTrackMenuProps = {
  audioTracks: TrackOption[]
  embeddedSubtitles: TrackOption[]
  subtitleTracks: SubtitleTrackItem[]
  audioStream: string
  subtitleStream: string
  selectedSubtitleUrl: string
  secondarySubtitleUrl: string
  dualSubLayout: 'native-larger' | 'study-larger'
  dualSubColor: 'amber' | 'cyan' | 'white'
  loadingAddonSubs: boolean
  addonSubsNotice: string
  subtitleOffsetSec: number
  subtitleSize: 'sm' | 'md' | 'lg'
  onChangeAudio: (value: string) => void
  onChangeEmbeddedSubtitle: (value: string) => void
  onSelectExternalSubtitle: (url: string) => void
  onSelectSecondarySubtitle: (url: string) => void
  onChangeDualSubLayout: (layout: 'native-larger' | 'study-larger') => void
  onChangeDualSubColor: (color: 'amber' | 'cyan' | 'white') => void
  onFetchAddonSubtitles: () => void
  onAdjustSubtitleOffset: (deltaOrZero: number) => void
  onChangeSubtitleSize: (size: 'sm' | 'md' | 'lg') => void
}

function groupSubtitleTracks(tracks: SubtitleTrackItem[]) {
  const groups = new Map<string, SubtitleTrackItem[]>()
  for (const track of tracks) {
    const rawCode = track.label.split(' ')[0]?.toUpperCase() || track.label
    const friendly =
      rawCode === 'POB' || rawCode === 'PT-BR'
        ? 'Português (BR)'
        : rawCode === 'POR' || rawCode === 'PT'
          ? 'Português'
          : rawCode === 'ENG' || rawCode === 'EN'
            ? 'English'
            : rawCode === 'RUS' || rawCode === 'RU'
              ? 'Русский (Russo)'
              : rawCode === 'SPA' || rawCode === 'ES'
                ? 'Español'
                : track.label
    const arr = groups.get(friendly) ?? []
    arr.push(track)
    groups.set(friendly, arr)
  }
  return Array.from(groups.entries())
}

/** Netflix-style two-column Idioma | Legendas popover with grouped language variants, sync, and size controls. */
export function PlayerTrackMenu({
  audioTracks,
  embeddedSubtitles,
  subtitleTracks,
  audioStream,
  subtitleStream,
  selectedSubtitleUrl,
  secondarySubtitleUrl,
  dualSubLayout,
  dualSubColor,
  loadingAddonSubs,
  addonSubsNotice,
  subtitleOffsetSec,
  subtitleSize,
  onChangeAudio,
  onChangeEmbeddedSubtitle,
  onSelectExternalSubtitle,
  onSelectSecondarySubtitle,
  onChangeDualSubLayout,
  onChangeDualSubColor,
  onFetchAddonSubtitles,
  onAdjustSubtitleOffset,
  onChangeSubtitleSize,
}: PlayerTrackMenuProps) {
  const groupedSubtitles = groupSubtitleTracks(subtitleTracks)

  return (
    <div className="absolute right-6 bottom-24 z-30 grid max-h-[65vh] w-[min(92vw,480px)] grid-cols-2 gap-4 overflow-y-auto rounded-[var(--sc-radius-lg)] border border-white/15 bg-[#14161f]/95 p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-col gap-1.5 border-r border-white/10 pr-3">
        <h4 className="m-0 mb-1 text-xs font-bold uppercase tracking-wider text-white">
          Idioma
        </h4>
        <button
          type="button"
          onClick={() => onChangeAudio('')}
          className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
            !audioStream ? 'bg-white/15 font-semibold text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
          }`}
        >
          <span>Original</span>
          {!audioStream && <Check className="h-3.5 w-3.5" />}
        </button>
        {audioTracks.map((track) => {
          const key = String(track.index)
          const active = audioStream === key
          return (
            <button
              key={track.index}
              type="button"
              onClick={() => onChangeAudio(key)}
              className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                active ? 'bg-white/15 font-semibold text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
              }`}
            >
              <span className="truncate">{track.title || track.language || `Faixa ${track.index}`}</span>
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="m-0 mb-1 text-xs font-bold uppercase tracking-wider text-white">
          Legendas
        </h4>
        <button
          type="button"
          onClick={() => {
            onSelectExternalSubtitle('')
            onChangeEmbeddedSubtitle('')
          }}
          className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
            !selectedSubtitleUrl && !subtitleStream
              ? 'bg-white/15 font-semibold text-white'
              : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
          }`}
        >
          <span>Desligadas</span>
          {!selectedSubtitleUrl && !subtitleStream && <Check className="h-3.5 w-3.5" />}
        </button>

        {groupedSubtitles.map(([langLabel, variants]) => {
          const isGroupActive = variants.some((v) => v.url === selectedSubtitleUrl)
          return (
            <div key={langLabel} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  onChangeEmbeddedSubtitle('')
                  onSelectExternalSubtitle(variants[0].url)
                }}
                className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                  isGroupActive
                    ? 'bg-white/15 font-semibold text-white'
                    : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
                }`}
              >
                <span className="truncate">{langLabel}</span>
                {isGroupActive && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
              {variants.length > 1 && (isGroupActive || langLabel.startsWith('Português')) && (
                <div className="flex flex-wrap gap-1 pl-2.5 pb-1">
                  {variants.slice(0, 8).map((variant, vIdx) => {
                    const active = variant.url === selectedSubtitleUrl
                    return (
                      <button
                        key={variant.url}
                        type="button"
                        onClick={() => {
                          onChangeEmbeddedSubtitle('')
                          onSelectExternalSubtitle(variant.url)
                        }}
                        className={`h-6 min-w-6 rounded px-1.5 text-[11px] font-bold cursor-pointer ${
                          active
                            ? 'bg-[var(--sc-accent)] text-white'
                            : 'bg-white/10 text-white/75 hover:bg-white/20'
                        }`}
                      >
                        {vIdx + 1}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {embeddedSubtitles.map((track) => {
          const key = String(track.index)
          const active = subtitleStream === key
          return (
            <button
              key={track.index}
              type="button"
              onClick={() => onChangeEmbeddedSubtitle(key)}
              className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                active ? 'bg-white/15 font-semibold text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
              }`}
            >
              <span className="truncate">
                {track.title || track.language || `Embutida ${track.index}`}
              </span>
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )
        })}

        <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
          <button
            type="button"
            disabled={loadingAddonSubs}
            onClick={onFetchAddonSubtitles}
            className="w-full rounded bg-[var(--sc-accent)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--sc-accent-hover)] disabled:opacity-50 cursor-pointer"
          >
            {loadingAddonSubs ? 'Buscando legendas...' : 'Buscar legendas nos Addons'}
          </button>
          {addonSubsNotice ? (
            <p className="m-0 text-[10px] text-emerald-300">{addonSubsNotice}</p>
          ) : null}
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-[var(--sc-text-muted)]">
              Sincronia: {subtitleOffsetSec > 0 ? `+${subtitleOffsetSec}s` : `${subtitleOffsetSec}s`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onAdjustSubtitleOffset(-0.5)}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => onAdjustSubtitleOffset(0)}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
              >
                0s
              </button>
              <button
                type="button"
                onClick={() => onAdjustSubtitleOffset(0.5)}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
              >
                +0.5s
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-[var(--sc-text-muted)]">Tamanho:</span>
            <div className="flex items-center gap-1">
                  {(['sm', 'md', 'lg'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onChangeSubtitleSize(sz)}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        subtitleSize === sz ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {sz === 'sm' ? 'P' : sz === 'md' ? 'M' : 'G'}
                    </button>
                  ))}
                </div>
              </div>
              {subtitleTracks.length > 0 && (
                <div className="space-y-1.5 border-t border-white/10 pt-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    2ª Legenda (Estudo de Idioma)
                    <select
                      aria-label="Segunda legenda (idioma de estudo)"
                      value={secondarySubtitleUrl}
                      onChange={(e) => onSelectSecondarySubtitle(e.target.value)}
                      className="mt-1 w-full rounded border border-white/15 bg-black/60 px-2 py-1 text-[11px] font-medium text-white outline-none focus:border-[var(--sc-accent)]"
                    >
                      <option value="">Desativada</option>
                      {subtitleTracks.map((track, idx) => (
                        <option key={`sec-${idx}-${track.url}`} value={track.url}>
                          {track.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {secondarySubtitleUrl && (
                    <>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-[var(--sc-text-muted)]">Maior:</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onChangeDualSubLayout('native-larger')}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              dualSubLayout === 'native-larger' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                            }`}
                          >
                            Nativa
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeDualSubLayout('study-larger')}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              dualSubLayout === 'study-larger' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                            }`}
                          >
                            Estudo
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-[var(--sc-text-muted)]">Cor 2ª:</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { key: 'amber', label: 'Âmbar' },
                              { key: 'cyan', label: 'Ciano' },
                              { key: 'white', label: 'Branco' },
                            ] as const
                          ).map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              onClick={() => onChangeDualSubColor(c.key)}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                dualSubColor === c.key ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                              }`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
  )
}
