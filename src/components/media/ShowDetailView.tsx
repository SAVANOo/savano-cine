import { ArrowLeft, Archive, Check, Download, Image, Pencil, Play, Plus, RotateCcw, Subtitles } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Episode, LibraryItem, Season } from '../../domain/catalog'
import { findNextEpisode, getRelatedItems, resolvePlayableMedia, translateGenre } from '../../domain/uiHelpers'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { MediaCarousel } from '../home/MediaCarousel'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { StarRating } from '../ui/StarRating'

type ShowDetailViewProps = {
  show: LibraryItem
  library: LibraryItem[]
  profileId: string
  onBack: () => void
  onPlayMedia: (media: PlayableMedia) => void
  onPlayItem: (item: LibraryItem) => void
  onOpenDetails: (item: LibraryItem) => void
  onToggleWatchlist?: (item: LibraryItem) => void
  onSearchArtwork?: (show: LibraryItem) => void
  onCatalogUpdated: () => void
  onArchived: () => void
}

/** HBO Max / Netflix inspired detail view with Resume/Restart, episodes, ratings, and related titles. */
export function ShowDetailView({
  show,
  library,
  profileId,
  onBack,
  onPlayMedia,
  onPlayItem,
  onOpenDetails,
  onToggleWatchlist,
  onSearchArtwork,
  onCatalogUpdated,
  onArchived,
}: ShowDetailViewProps) {
  const seasons = show.seasons ?? []
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState(
    show.resume?.season ?? seasons[0]?.number ?? 1,
  )
  const [activeTab, setActiveTab] = useState<'related' | 'details'>(
    seasons.length > 0 ? 'details' : 'related',
  )
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(show.title)
  const [draftYear, setDraftYear] = useState(show.year ? String(show.year) : '')
  const [draftOverview, setDraftOverview] = useState(show.overview ?? '')
  const [draftTags, setDraftTags] = useState((show.tags ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [subResults, setSubResults] = useState<Array<{ fileId: number; language: string; release: string }>>([])
  const [subMessage, setSubMessage] = useState('')
  const [searchingSubs, setSearchingSubs] = useState(false)

  async function searchSubtitles() {
    if (!show.mediaId) return
    setSearchingSubs(true)
    setSubMessage('')
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(show.mediaId)}/subtitles/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: show.title }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Falha ao buscar legendas.')
      setSubResults(Array.isArray(body?.results) ? body.results : [])
      if (!body?.configured) {
        setSubMessage('OpenSubtitles sem chave configurada (OPENSUBTITLES_API_KEY).')
      } else if (!body?.results?.length) {
        setSubMessage('Nenhuma legenda encontrada no OpenSubtitles para este título.')
      }
    } catch (err) {
      setSubMessage(err instanceof Error ? err.message : 'Erro ao buscar legendas.')
    } finally {
      setSearchingSubs(false)
    }
  }

  async function downloadSubtitle(fileId: number, language: string) {
    if (!show.mediaId) return
    setSubMessage('')
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(show.mediaId)}/subtitles/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, language, confirmed: true }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Falha ao baixar legenda.')
      setSubMessage('Legenda baixada e vinculada ao título.')
      onCatalogUpdated()
    } catch (err) {
      setSubMessage(err instanceof Error ? err.message : 'Erro ao baixar legenda.')
    }
  }

  const activeSeason: Season | undefined =
    seasons.find((s) => s.number === selectedSeasonNumber) ?? seasons[0]
  const playable = resolvePlayableMedia(show, false)
  const restartable = resolvePlayableMedia(show, true)
  const hasResume = Boolean(show.resume) || (show.progress ?? 0) > 0
  const related = getRelatedItems(show, library, 12)
  const backdrop = show.artwork.bannerUrl || show.artwork.posterUrl

  const localSubtitles = (show.subtitles ?? [])
    .filter((sub) => sub.available)
    .map((sub) => sub.label)
    .join(', ')

  async function saveMetadata(event: FormEvent) {
    event.preventDefault()
    if (!show.mediaId && show.kind === 'Filme') return
    setSaving(true)
    setStatus('')
    try {
      const targetId = show.mediaId ?? show.id
      const response = await fetch(`/api/catalog/${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          year: draftYear ? Number(draftYear) : null,
          overview: draftOverview,
          tags: draftTags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })
      if (!response.ok) throw new Error('Falha ao salvar metadados')
      setStatus('Metadados atualizados.')
      setEditing(false)
      onCatalogUpdated()
    } catch {
      setStatus('Erro ao salvar metadados.')
    } finally {
      setSaving(false)
    }
  }

  async function archiveItem() {
    if (!show.mediaId) return
    setSaving(true)
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(show.mediaId)}/ignore`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Falha ao arquivar')
      onArchived()
    } catch {
      setStatus('Erro ao arquivar item.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar para biblioteca
        </Button>
      </div>

      {/* HBO Max / Netflix Hero */}
      <section className="relative overflow-hidden rounded-[var(--sc-radius-xl)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] shadow-[var(--sc-shadow-card)]">
        <div className="relative min-h-[340px] sm:min-h-[420px]">
          {backdrop ? (
            <img
              src={backdrop}
              alt={show.title}
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 via-neutral-900 to-black" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-[#08090d] via-[#08090d]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-transparent to-black/30" />

          <div className="relative z-10 flex min-h-[340px] max-w-3xl flex-col justify-end p-6 sm:min-h-[420px] sm:p-10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{show.kind}</Badge>
              {show.sourceStatus === 'offline' && (
                <Badge tone="neutral">HD desconectado ({show.sourceName || 'Fonte offline'})</Badge>
              )}
              {show.year && <Badge tone="dark">{show.year}</Badge>}
              {(show.genres ?? []).map((genre) => (
                <Badge key={genre} tone="neutral">
                  {translateGenre(genre)}
                </Badge>
              ))}
            </div>

            <h1 className="m-0 text-3xl font-black tracking-tight text-white sm:text-5xl">
              {show.title}
            </h1>

            <p className="mt-2 mb-0 text-xs font-medium text-[var(--sc-text-secondary)] sm:text-sm">
              {show.meta}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {playable && (
                <Button
                  variant="light"
                  size="lg"
                  disabled={show.sourceStatus === 'offline'}
                  onClick={() => onPlayMedia(playable)}
                >
                  <Play className="h-4 w-4 fill-current" />
                  {show.sourceStatus === 'offline' ? 'HD desconectado' : hasResume ? 'Retome' : 'Assistir'}
                </Button>
              )}
              {hasResume && restartable && (
                <Button variant="secondary" size="lg" onClick={() => onPlayMedia(restartable)}>
                  <RotateCcw className="h-4 w-4" />
                  Reiniciar
                </Button>
              )}
              {onToggleWatchlist && (
                <Button variant="secondary" size="lg" onClick={() => onToggleWatchlist(show)}>
                  {show.inWatchlist ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {show.inWatchlist ? 'Na minha lista' : 'Minha lista'}
                </Button>
              )}
              {onSearchArtwork && (
                <Button variant="secondary" size="md" onClick={() => onSearchArtwork(show)}>
                  <Image className="h-4 w-4" />
                  Buscar arte/metadados
                </Button>
              )}
              <Button variant="secondary" size="md" onClick={() => setEditing((value) => !value)}>
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
              {show.kind === 'Filme' && show.mediaId && (
                <Button variant="ghost" size="md" disabled={saving} onClick={() => void archiveItem()}>
                  <Archive className="h-4 w-4" />
                  Arquivar
                </Button>
              )}
            </div>

            {show.versions && show.versions.length > 1 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-white/60">Versões disponíveis:</span>
                {show.versions.map((ver) => (
                  <button
                    key={ver.mediaId}
                    type="button"
                    onClick={() =>
                      onPlayMedia({
                        title: `${show.title} (${ver.label})`,
                        url: ver.mediaUrl,
                        subtitleUrl: ver.subtitleUrl,
                        mediaId: ver.mediaId,
                        needsTranscode: ver.needsTranscode,
                        overview: show.overview,
                        year: show.year,
                      })
                    }
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-white/20"
                  >
                    {ver.label}
                  </button>
                ))}
              </div>
            )}

            <p className="mt-5 mb-0 max-w-2xl text-sm leading-relaxed text-white/85">
              {show.overview || 'Descrição ainda não cadastrada para este título.'}
            </p>
          </div>
        </div>
      </section>

      {editing && (
        <form
          onSubmit={saveMetadata}
          className="grid gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-5 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-xs text-[var(--sc-text-secondary)]">
            Título
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              required
              className="h-9 rounded-[var(--sc-radius-sm)] border border-white/15 bg-black/40 px-3 text-sm text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--sc-text-secondary)]">
            Ano
            <input
              value={draftYear}
              onChange={(event) => setDraftYear(event.target.value)}
              className="h-9 rounded-[var(--sc-radius-sm)] border border-white/15 bg-black/40 px-3 text-sm text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--sc-text-secondary)] sm:col-span-2">
            Tags (separadas por vírgula)
            <input
              value={draftTags}
              onChange={(event) => setDraftTags(event.target.value)}
              className="h-9 rounded-[var(--sc-radius-sm)] border border-white/15 bg-black/40 px-3 text-sm text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--sc-text-secondary)] sm:col-span-2">
            Sinopse
            <textarea
              rows={3}
              value={draftOverview}
              onChange={(event) => setDraftOverview(event.target.value)}
              className="rounded-[var(--sc-radius-sm)] border border-white/15 bg-black/40 p-3 text-sm text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            {status && <span className="text-xs text-[var(--sc-text-secondary)]">{status}</span>}
          </div>
        </form>
      )}

      {/* HBO Max Style Tabs: Você também pode gostar | Detalhes & Episódios */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-6 border-b border-[var(--sc-border-subtle)]">
          <button
            type="button"
            onClick={() => setActiveTab('related')}
            className={`border-0 border-b-2 bg-transparent pb-3 text-sm font-semibold transition cursor-pointer ${
              activeTab === 'related'
                ? 'border-white text-white'
                : 'border-transparent text-[var(--sc-text-muted)] hover:text-white'
            }`}
          >
            Você também pode gostar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`border-0 border-b-2 bg-transparent pb-3 text-sm font-semibold transition cursor-pointer ${
              activeTab === 'details'
                ? 'border-white text-white'
                : 'border-transparent text-[var(--sc-text-muted)] hover:text-white'
            }`}
          >
            {seasons.length > 0 ? 'Episódios e Detalhes' : 'Detalhes e Avaliação'}
          </button>
        </div>

        {activeTab === 'related' ? (
          related.length > 0 ? (
            <MediaCarousel
              title="Títulos relacionados"
              items={related}
              onPlay={onPlayItem}
              onOpenDetails={onOpenDetails}
            />
          ) : (
            <p className="text-sm text-[var(--sc-text-muted)]">
              Nenhum título relacionado encontrado neste gênero ainda.
            </p>
          )
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-4">
              {seasons.length > 0 && activeSeason ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {seasons.map((season) => (
                      <Button
                        key={season.number}
                        variant={season.number === activeSeason.number ? 'light' : 'secondary'}
                        size="sm"
                        onClick={() => setSelectedSeasonNumber(season.number)}
                      >
                        Temporada {season.number}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    {activeSeason.episodes.map((ep: Episode) => {
                      const isResumeEpisode =
                        Boolean(show.resume?.mediaId && ep.mediaId === show.resume.mediaId) ||
                        (show.resume?.season === ep.season && show.resume?.episode === ep.number)
                      const epProgress = Math.max(0, Math.min(100, ep.progress ?? 0))
                      const epOffline = ep.sourceStatus === 'offline'
                      const playEp = () => {
                        if (!ep.mediaUrl || epOffline) return
                        onPlayMedia({
                          title: `${show.title} — T${ep.season}:E${ep.number} ${ep.title}`,
                          url: ep.mediaUrl,
                          subtitleUrl: ep.subtitleUrl,
                          mediaId: ep.mediaId,
                          needsTranscode: ep.needsTranscode,
                          overview: show.overview,
                          year: show.year,
                          startPosition: isResumeEpisode ? show.resume?.position : 0,
                          showTitle: show.title,
                          showSeasons: show.seasons,
                          nextEpisode: findNextEpisode(show, ep.mediaId),
                        })
                      }
                      return (
                        <div
                          key={ep.id}
                          role={ep.mediaUrl && !epOffline ? 'button' : undefined}
                          tabIndex={ep.mediaUrl && !epOffline ? 0 : undefined}
                          onClick={playEp}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              playEp()
                            }
                          }}
                          className={`group relative overflow-hidden flex items-center justify-between gap-4 rounded-[var(--sc-radius-md)] border p-3.5 transition ${
                            ep.mediaUrl && !epOffline ? 'cursor-pointer' : 'opacity-70'
                          } ${
                            isResumeEpisode
                              ? 'border-[var(--sc-accent)] bg-[var(--sc-accent-soft)]'
                              : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] hover:border-white/30 hover:bg-white/[0.04]'
                          }`}
                        >
                          {ep.thumbnailUrl && !epOffline && (
                            <div className="relative hidden h-16 w-28 shrink-0 overflow-hidden rounded-[var(--sc-radius-sm)] bg-neutral-900 sm:block">
                              <img
                                src={ep.thumbnailUrl}
                                alt={`${ep.title}`}
                                loading="lazy"
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none'
                                }}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                                <Play className="h-5 w-5 fill-white text-white" />
                              </span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-[var(--sc-accent)]">
                                E{ep.number}
                              </span>
                              <strong className="truncate text-sm text-white">{ep.title}</strong>
                              {epOffline && (
                                <Badge tone="neutral">Fonte offline</Badge>
                              )}
                              {!epOffline && epProgress >= 90 && (
                                <Badge tone="neutral">Assistido</Badge>
                              )}
                              {!epOffline && epProgress > 0 && epProgress < 90 && (
                                <Badge tone="accent">
                                  {ep.position || `${epProgress}%`}
                                </Badge>
                              )}
                              {!epOffline && epProgress === 0 && isResumeEpisode && (
                                <Badge tone="accent">Próximo</Badge>
                              )}
                              {!epOffline && epProgress === 0 && !isResumeEpisode && (
                                <span className="text-[11px] text-[var(--sc-text-muted)]">Não assistido</span>
                              )}
                            </div>
                            <p className="mt-1 mb-0 truncate text-xs text-[var(--sc-text-muted)]">
                              {ep.duration} · {ep.filename}
                            </p>
                          </div>
                          {ep.mediaUrl && (
                            <Button
                              variant={isResumeEpisode ? 'primary' : 'light'}
                              size="sm"
                              disabled={epOffline}
                              onClick={(event) => {
                                event.stopPropagation()
                                playEp()
                              }}
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                              {epOffline ? 'Offline' : isResumeEpisode ? 'Retome' : 'Assistir'}
                            </Button>
                          )}
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/10">
                            <div
                              className={`h-full transition-all ${
                                epProgress >= 90 ? 'bg-emerald-400' : 'bg-[var(--sc-accent)]'
                              }`}
                              style={{ width: `${epProgress > 0 ? epProgress : isResumeEpisode ? 8 : 0}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-5 text-sm text-[var(--sc-text-secondary)]">
                  <div>
                    <p className="m-0 font-semibold text-white">Informações do arquivo</p>
                    <p className="mt-2 mb-0 break-all text-xs text-[var(--sc-text-muted)]">
                      {show.detail}
                    </p>
                    <p className="mt-3 mb-0 text-xs">
                      Legendas locais: <strong className="text-white">{localSubtitles || 'Original'}</strong>
                    </p>
                  </div>

                  {show.mediaId && (
                    <div className="border-t border-[var(--sc-border-subtle)] pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">Legendas online (OpenSubtitles)</span>
                        <Button variant="secondary" size="sm" disabled={searchingSubs} onClick={() => void searchSubtitles()}>
                          <Subtitles className="h-3.5 w-3.5" />
                          {searchingSubs ? 'Buscando...' : 'Buscar legendas'}
                        </Button>
                      </div>
                      {subMessage && <p className="mt-2 mb-0 text-xs text-[var(--sc-text-muted)]">{subMessage}</p>}
                      {subResults.length > 0 && (
                        <div className="mt-3 flex flex-col gap-2">
                          {subResults.slice(0, 5).map((sub) => (
                            <div key={sub.fileId} className="flex items-center justify-between gap-2 rounded bg-black/30 px-3 py-2 text-xs">
                              <span className="truncate text-white">
                                [{sub.language}] {sub.release}
                              </span>
                              <Button size="sm" variant="primary" onClick={() => void downloadSubtitle(sub.fileId, sub.language)}>
                                <Download className="h-3 w-3" />
                                Baixar
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {show.mediaId && (
              <div>
                <StarRating
                  mediaId={show.mediaId}
                  profileId={profileId}
                  initialRating={show.rating}
                  onSaved={onCatalogUpdated}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
