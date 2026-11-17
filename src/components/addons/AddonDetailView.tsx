import { ArrowLeft, Download, ExternalLink, Film, HardDrive, Play, Tv } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import { extractStreamLanguages } from '../../domain/streamLanguages'
import { parseRuntimeToSeconds, type PlayableMedia } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SavanoLoader } from '../ui/SavanoLoader'
import type { AddonMetaSummary } from './AddonStreamModal'

function normalizeMatchTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type AddonStreamItem = {
  addonId: string
  addonName: string
  name: string
  title: string
  url: string | null
  isDirectHttp: boolean
  ytId: string | null
  infoHash: string | null
  fileIdx?: number | null
  seeders?: number | null
  sizeLabel?: string | null
}

type AddonSubtitleItem = {
  addonId: string
  addonName: string
  id: string
  lang: string
  url: string
}

type AddonDetailViewProps = {
  item: AddonMetaSummary
  localCatalog: LibraryItem[]
  isAdmin?: boolean
  onBack: () => void
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal: (item: LibraryItem) => void
}

/** Dedicated full-page detail view for online/addon movies and series (replacing cramped modals). */
export function AddonDetailView({
  item,
  localCatalog,
  isAdmin = false,
  onBack,
  onPlayStream,
  onPlayLocal,
}: AddonDetailViewProps) {
  const [detail, setDetail] = useState<AddonMetaSummary>(item)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [streams, setStreams] = useState<AddonStreamItem[]>([])
  const [subtitles, setSubtitles] = useState<AddonSubtitleItem[]>([])
  const [loadingStreams, setLoadingStreams] = useState(item.type !== 'series')
  const [streamTargetLabel, setStreamTargetLabel] = useState(item.type !== 'series' ? item.name : '')
  const [selectedSeason, setSelectedSeason] = useState<number>(1)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('')
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set())
  const [downloadStatus, setDownloadStatus] = useState('')
  const [error, setError] = useState('')

  const matchedLocalItem = useMemo(() => {
    if (!localCatalog?.length) return null
    const targetNorm = normalizeMatchTitle(detail.name || '')
    if (!targetNorm) return null
    const desiredKind = detail.type === 'series' ? 'Série' : 'Filme'
    return (
      localCatalog.find((entry) => entry.kind === desiredKind && normalizeMatchTitle(entry.title) === targetNorm) ??
      localCatalog.find((entry) => normalizeMatchTitle(entry.title) === targetNorm) ??
      null
    )
  }, [detail.name, detail.type, localCatalog])

  const seasonOptions = useMemo(() => {
    const set = new Set<number>()
    for (const v of detail.videos ?? []) {
      if (typeof v.season === 'number') set.add(v.season)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [detail.videos])

  const activeSeason = useMemo(() => {
    if (seasonOptions.length === 0) return null
    return seasonOptions.includes(selectedSeason) ? selectedSeason : seasonOptions[0]
  }, [seasonOptions, selectedSeason])

  const visibleVideos = useMemo(() => {
    const list = detail.videos ?? []
    if (activeSeason === null) return list
    return list.filter((v) => v.season === activeSeason)
  }, [activeSeason, detail.videos])

  async function fetchStreamsFor(type: string, targetId: string, label: string) {
    setLoadingStreams(true)
    setStreamTargetLabel(label)
    setStreams([])
    setSubtitles([])
    setError('')
    try {
      const params = new URLSearchParams({ type, id: targetId })
      const [streamRes, subRes] = await Promise.all([
        fetch(`/api/addons/streams?${params.toString()}`),
        fetch(`/api/addons/subtitles?${params.toString()}`),
      ])
      const streamPayload = await streamRes.json().catch(() => null)
      const subPayload = await subRes.json().catch(() => null)
      if (!streamRes.ok) {
        setError(streamPayload?.error || 'Falha ao consultar streams nos addons.')
        return
      }
      setStreams(Array.isArray(streamPayload?.streams) ? streamPayload.streams : [])
      setSubtitles(Array.isArray(subPayload?.subtitles) ? subPayload.subtitles : [])
    } catch {
      setError('Erro de rede ao buscar streams nos addons.')
    } finally {
      setLoadingStreams(false)
    }
  }

  async function queueLocalDownload(stream: AddonStreamItem) {
    setDownloadStatus('Enviando para download no Acervo Local...')
    try {
      const res = await fetch('/api/addons/download-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: streamTargetLabel || detail.name,
          url: stream.url || undefined,
          infoHash: stream.infoHash || undefined,
          fileIdx: stream.fileIdx,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        setDownloadStatus(payload?.error || 'Não foi possível iniciar o download.')
        return
      }
      setDownloadStatus(payload?.message || `Download iniciado em ${payload?.targetDir || 'Acervo Local'}`)
    } catch {
      setDownloadStatus('Erro de rede ao iniciar download local.')
    }
  }

  useEffect(() => {
    let active = true
    const metaUrl = item.addonId
      ? `/api/addons/${encodeURIComponent(item.addonId)}/meta?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.id)}`
      : `/api/addons/fallback-meta?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.id)}`

    fetch(metaUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!active) return
        if (payload?.meta) setDetail({ ...item, ...payload.meta })
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingMeta(false)
      })

    if (item.type !== 'series') {
      const params = new URLSearchParams({ type: item.type, id: item.id })
      Promise.all([
        fetch(`/api/addons/streams?${params.toString()}`).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) })),
        fetch(`/api/addons/subtitles?${params.toString()}`).then((r) => (r.ok ? r.json().catch(() => null) : null)),
      ])
        .then(([streamRes, subPayload]) => {
          if (!active) return
          if (!streamRes.ok) {
            setError(streamRes.data?.error || 'Falha ao consultar streams nos addons.')
            return
          }
          setStreams(Array.isArray(streamRes.data?.streams) ? streamRes.data.streams : [])
          setSubtitles(Array.isArray(subPayload?.subtitles) ? subPayload.subtitles : [])
        })
        .catch(() => {
          if (active) setError('Erro de rede ao buscar streams nos addons.')
        })
        .finally(() => {
          if (active) setLoadingStreams(false)
        })
    }

    return () => {
      active = false
    }
  }, [item])

  const backdrop = detail.background || detail.poster

  return (
    <div className="flex min-w-0 w-full flex-col gap-6 overflow-x-hidden">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
      </div>

      {/* Hero Banner */}
      <section
        data-dark-surface="true"
        className="relative overflow-hidden rounded-[var(--sc-radius-xl)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)]"
      >
        {backdrop ? (
          <img
            src={backdrop}
            alt={detail.name}
            className="absolute inset-0 h-full w-full object-cover opacity-35"
          />
        ) : null}
        <div className="relative z-10 flex flex-col gap-6 bg-gradient-to-t from-black/95 via-black/75 to-black/45 p-6 sm:flex-row sm:items-end sm:p-8">
          {detail.poster ? (
            <img
              src={detail.poster}
              alt={detail.name}
              className="hidden h-52 w-36 shrink-0 rounded-[var(--sc-radius-lg)] border border-white/15 object-cover shadow-2xl sm:block"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{detail.type === 'series' ? 'Série Online' : 'Filme Online'}</Badge>
              {detail.releaseInfo ? <Badge tone="neutral">{detail.releaseInfo}</Badge> : null}
              {detail.genres?.slice(0, 4).map((g) => (
                <Badge key={g} tone="neutral">{g}</Badge>
              ))}
            </div>
            <h1 className="m-0 text-2xl font-black tracking-tight text-white sm:text-4xl">
              {detail.name}
            </h1>
            {detail.description ? (
              <p className="m-0 max-w-3xl text-sm leading-relaxed text-white/85">
                {detail.description}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {matchedLocalItem ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--sc-radius-lg)] border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-sm font-bold text-[var(--sc-text-primary)]">
              <HardDrive className="h-4 w-4 text-emerald-500" />
              Disponível no seu Acervo Local · {matchedLocalItem.title}
            </p>
            <p className="mt-0.5 mb-0 truncate text-xs text-[var(--sc-text-secondary)]">
              {matchedLocalItem.sourceName || 'Acervo Local'}
              {matchedLocalItem.sourceStatus === 'offline' ? ' (HD desconectado no momento)' : ' · Reprodução instantânea sem buffering'}
            </p>
          </div>
          <Button type="button" size="sm" variant="primary" onClick={() => onPlayLocal(matchedLocalItem)}>
            <Play className="h-3.5 w-3.5" />
            Assistir do Acervo Local
          </Button>
        </div>
      ) : null}

      {/* Main Two-Column Content */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Left Column: Episodes (Series) or Subtitles/Info (Movie) */}
        <div className="min-w-0 space-y-4 overflow-hidden rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
          {detail.type === 'series' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
                  <Tv className="h-4 w-4 text-[var(--sc-accent)]" />
                  Episódios ({visibleVideos.length})
                </h2>
                {seasonOptions.length > 1 && activeSeason !== null ? (
                  <select
                    aria-label="Selecionar temporada"
                    value={activeSeason}
                    onChange={(e) => setSelectedSeason(Number(e.target.value))}
                    className="rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)]"
                  >
                    {seasonOptions.map((s) => (
                      <option key={s} value={s}>
                        Temporada {s}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {loadingMeta ? (
                <SavanoLoader label="Carregando episódios..." />
              ) : visibleVideos.length === 0 ? (
                <p className="text-xs text-[var(--sc-text-secondary)]">Nenhum episódio listado nos metadados deste addon.</p>
              ) : (
                <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1">
                  {visibleVideos.map((video) => {
                    const isSelected = selectedEpisodeId === video.id
                    const hasThumb = Boolean(video.thumbnail) && !brokenThumbs.has(video.thumbnail!)
                    return (
                      <button
                        key={video.id}
                        type="button"
                        onClick={() => {
                          setSelectedEpisodeId(video.id)
                          void fetchStreamsFor(
                            'series',
                            video.id,
                            `${detail.name} — T${video.season ?? '?'}:E${video.episode ?? '?'} ${video.title}`,
                          )
                        }}
                        className={`flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border p-2.5 text-left text-xs text-[var(--sc-text-primary)] transition cursor-pointer ${
                          isSelected
                            ? 'border-[var(--sc-accent)] bg-[var(--sc-accent-soft)] ring-1 ring-[var(--sc-accent)]'
                            : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] hover:border-[var(--sc-accent)]'
                        }`}
                      >
                        {hasThumb ? (
                          <img
                            src={video.thumbnail!}
                            alt=""
                            onError={() =>
                              setBrokenThumbs((prev) => {
                                const next = new Set(prev)
                                next.add(video.thumbnail!)
                                return next
                              })
                            }
                            className="h-12 w-20 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-black/30 text-[var(--sc-text-muted)]">
                            <Tv className="h-4 w-4" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate font-semibold">
                            T{video.season ?? '?'}:E{video.episode ?? '?'} · {video.title}
                          </p>
                          {video.overview ? (
                            <p className="mt-0.5 mb-0 line-clamp-2 text-[11px] text-[var(--sc-text-secondary)]">
                              {video.overview}
                            </p>
                          ) : null}
                        </div>
                        <Play className="h-4 w-4 shrink-0 text-[var(--sc-accent)]" />
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
                  <Film className="h-4 w-4 text-[var(--sc-accent)]" />
                  Legendas encontradas ({subtitles.length})
                </h2>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={loadingStreams}
                  onClick={() => void fetchStreamsFor(detail.type, detail.id, detail.name)}
                >
                  {loadingStreams ? 'Atualizando...' : 'Atualizar fontes'}
                </Button>
              </div>
              {subtitles.length === 0 ? (
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  {loadingStreams ? 'Buscando legendas nos addons...' : 'Nenhuma legenda externa retornada para este filme.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {subtitles.slice(0, 16).map((sub, idx) => (
                    <a
                      key={`${sub.addonId}-${sub.id}-${idx}`}
                      href={`/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}&download=1&filename=${encodeURIComponent(`${detail.name}-${sub.lang}.srt`)}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--sc-accent)]" />
                      {sub.lang.toUpperCase()} · {sub.addonName}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column: Streams */}
        <div className="min-w-0 space-y-3 overflow-hidden rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
          <h2 className="m-0 truncate text-base font-bold text-[var(--sc-text-primary)]">
            Fontes de Reprodução {streamTargetLabel ? `· ${streamTargetLabel}` : ''}
          </h2>
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
          {!streamTargetLabel ? (
            <p className="text-xs text-[var(--sc-text-secondary)]">
              Selecione um episódio ao lado para carregar os streams e legendas dos addons.
            </p>
          ) : loadingStreams ? (
            <SavanoLoader label="Buscando streams nos addons..." />
          ) : streams.length === 0 ? (
            <p className="text-xs text-[var(--sc-text-secondary)]">
              Nenhum stream retornado pelos addons ativos para este título.
            </p>
          ) : (
            <div className="max-h-[520px] space-y-2.5 overflow-x-hidden overflow-y-auto pr-1">
              {streams.map((stream, index) => {
                const langBadges = extractStreamLanguages(`${stream.name} ${stream.title}`)
                const canPlayDirect = Boolean(stream.isDirectHttp && stream.url)
                const canPlayTorrent = Boolean(stream.infoHash)
                const isPlayable = canPlayDirect || canPlayTorrent
                const runtimeSeconds = parseRuntimeToSeconds(detail.runtime)
                const startPlay = () => {
                  if (canPlayDirect) {
                    onPlayStream({
                      mediaId: '',
                      title: `${streamTargetLabel} (${stream.addonName})`,
                      url: stream.url!,
                      duration: runtimeSeconds,
                      poster: detail.poster || undefined,
                      overview: detail.description,
                      externalSubtitles: subtitles.slice(0, 30).map((sub) => ({
                        label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
                        url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
                      })),
                    })
                  } else if (canPlayTorrent) {
                    const params = new URLSearchParams({ infoHash: stream.infoHash! })
                    if (typeof stream.fileIdx === 'number') {
                      params.set('fileIdx', String(stream.fileIdx))
                    }
                    onPlayStream({
                      mediaId: '',
                      title: `${streamTargetLabel} (${stream.addonName})`,
                      url: `/api/addons/torrent-stream?${params.toString()}`,
                      duration: runtimeSeconds,
                      poster: detail.poster || undefined,
                      overview: detail.description,
                      externalSubtitles: subtitles.slice(0, 30).map((sub) => ({
                        label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
                        url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
                      })),
                    })
                  }
                }
                return (
                  <div
                    key={`${stream.addonId}-${index}`}
                    role={isPlayable ? 'button' : undefined}
                    tabIndex={isPlayable ? 0 : undefined}
                    onClick={() => {
                      if (isPlayable) startPlay()
                    }}
                    onKeyDown={(e) => {
                      if (isPlayable && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        startPlay()
                      }
                    }}
                    className={`flex min-w-0 flex-col gap-2.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3 transition sm:flex-row sm:items-center sm:justify-between ${
                      isPlayable ? 'hover:border-[var(--sc-accent)] hover:bg-[var(--sc-bg-surface)]/80 cursor-pointer' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="m-0 truncate text-xs font-semibold text-[var(--sc-text-primary)]">
                          {stream.addonName} · {stream.name}
                        </p>
                        {langBadges.map((badge) => (
                          <span
                            key={badge}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              badge.includes('🇧🇷') || badge.includes('Dual')
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-white/10 text-[var(--sc-text-primary)]'
                            }`}
                          >
                            {badge}
                          </span>
                        ))}
                        {typeof stream.seeders === 'number' ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              stream.seeders >= 20
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : stream.seeders >= 5
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {stream.seeders} seeds · {stream.seeders >= 20 ? 'Rápido' : stream.seeders >= 5 ? 'Médio' : 'Lento'}
                          </span>
                        ) : null}
                        {stream.sizeLabel ? (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[var(--sc-text-secondary)]">
                            {stream.sizeLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 mb-0 break-words line-clamp-2 text-xs text-[var(--sc-text-secondary)]">
                        {stream.title}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {isAdmin && ((stream.isDirectHttp && stream.url) || stream.infoHash) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          title="Salvar no Acervo Local do Servidor (Admin)"
                          onClick={(e) => {
                            e.stopPropagation()
                            void queueLocalDownload(stream)
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Acervo
                        </Button>
                      ) : null}
                      {canPlayDirect && stream.url ? (
                        <a
                          href={stream.url}
                          download={`${streamTargetLabel || detail.name}.mp4`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Baixar arquivo neste dispositivo"
                          className="inline-flex items-center gap-1.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-2.5 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Baixar
                        </a>
                      ) : canPlayTorrent && stream.infoHash ? (
                        <a
                          href={`/api/addons/torrent-stream?infoHash=${encodeURIComponent(stream.infoHash)}${typeof stream.fileIdx === 'number' ? `&fileIdx=${stream.fileIdx}` : ''}`}
                          download={`${streamTargetLabel || detail.name}.mp4`}
                          onClick={(e) => e.stopPropagation()}
                          title="Baixar arquivo neste dispositivo"
                          className="inline-flex items-center gap-1.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-2.5 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Baixar
                        </a>
                      ) : null}
                      {isPlayable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            startPlay()
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {canPlayTorrent ? 'Reproduzir Torrent' : 'Reproduzir'}
                        </Button>
                      ) : stream.ytId ? (
                        <a
                          href={`https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          YouTube
                        </a>
                      ) : (
                        <span className="text-xs text-amber-300">Sem URL direta</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {downloadStatus ? (
            <p className="text-xs font-medium text-emerald-400">{downloadStatus}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
