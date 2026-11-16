import { Download, ExternalLink, HardDrive, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

function normalizeMatchTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type AddonMetaSummary = {
  id: string
  type: string
  name: string
  poster: string | null
  background?: string | null
  description: string
  releaseInfo: string | null
  genres?: string[]
  addonId?: string
  addonName?: string
  videos?: Array<{
    id: string
    title: string
    season: number | null
    episode: number | null
    thumbnail: string | null
    overview: string
  }>
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

type AddonStreamModalProps = {
  item: AddonMetaSummary | null
  localCatalog?: LibraryItem[]
  onClose: () => void
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal?: (item: LibraryItem) => void
}

/** Modal that loads addon metadata/episodes and immediately queries streams & subtitles. */
export function AddonStreamModal({ item, localCatalog, onClose, onPlayStream, onPlayLocal }: AddonStreamModalProps) {
  if (!item) return null
  return (
    <AddonStreamModalContent
      key={`${item.type}:${item.id}`}
      item={item}
      localCatalog={localCatalog}
      onClose={onClose}
      onPlayStream={onPlayStream}
      onPlayLocal={onPlayLocal}
    />
  )
}

function AddonStreamModalContent({
  item,
  localCatalog,
  onClose,
  onPlayStream,
  onPlayLocal,
}: {
  item: AddonMetaSummary
  localCatalog?: LibraryItem[]
  onClose: () => void
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal?: (item: LibraryItem) => void
}) {
  const [detail, setDetail] = useState<AddonMetaSummary>(item)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [streams, setStreams] = useState<AddonStreamItem[]>([])
  const [subtitles, setSubtitles] = useState<AddonSubtitleItem[]>([])
  const [loadingStreams, setLoadingStreams] = useState(item.type !== 'series')
  const [streamTargetLabel, setStreamTargetLabel] = useState(item.type !== 'series' ? item.name : '')
  const [selectedSeason, setSelectedSeason] = useState<number | 'all'>(1)
  const [downloadStatus, setDownloadStatus] = useState('')
  const [error, setError] = useState('')

  const seasonOptions = useMemo(() => {
    const set = new Set<number>()
    for (const v of detail.videos ?? []) {
      if (typeof v.season === 'number') set.add(v.season)
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [detail.videos])

  const activeSeason = useMemo(() => {
    if (seasonOptions.length === 0) return 'all' as const
    if (selectedSeason !== 'all' && seasonOptions.includes(selectedSeason)) return selectedSeason
    return seasonOptions[0]
  }, [seasonOptions, selectedSeason])

  const visibleVideos = useMemo(() => {
    const list = detail.videos ?? []
    if (activeSeason === 'all') return list
    return list.filter((v) => v.season === activeSeason)
  }, [activeSeason, detail.videos])

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

  const fetchStreamsFor = useCallback(async (type: string, targetId: string, label: string) => {
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
  }, [])

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

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={detail.addonName || 'ADDONS STREMIO'}
      title={detail.name || ''}
      subtitle={detail.releaseInfo || (detail.type === 'series' ? 'Série' : 'Filme')}
      maxWidthClass="max-w-3xl"
    >
      {detail ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {detail.poster ? (
              <img
                src={detail.poster}
                alt={detail.name}
                className="h-44 w-30 shrink-0 rounded-[var(--sc-radius-md)] object-cover shadow-lg"
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              {detail.genres && detail.genres.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {detail.genres.slice(0, 5).map((g) => (
                    <Badge key={g} tone="neutral">{g}</Badge>
                  ))}
                </div>
              ) : null}
              {detail.description ? (
                <p className="text-sm text-[var(--sc-text-secondary)]">{detail.description}</p>
              ) : null}
              {detail.type !== 'series' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={loadingStreams}
                  onClick={() => void fetchStreamsFor(detail.type, detail.id, detail.name)}
                >
                  <Play className="h-3.5 w-3.5" />
                  {loadingStreams ? 'Buscando streams...' : 'Atualizar streams'}
                </Button>
              ) : null}
            </div>
          </div>

          {loadingMeta ? (
            <p className="text-xs text-[var(--sc-text-muted)]">Carregando episódios...</p>
          ) : null}

          {detail.videos && detail.videos.length > 0 ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)]">
                  Episódios ({visibleVideos.length} de {detail.videos.length})
                </p>
                {seasonOptions.length > 1 ? (
                  <select
                    aria-label="Selecionar temporada"
                    value={activeSeason}
                    onChange={(e) => setSelectedSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--sc-text-primary)]"
                  >
                    {seasonOptions.map((s) => (
                      <option key={s} value={s}>
                        Temporada {s}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visibleVideos.map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() =>
                      void fetchStreamsFor(
                        'series',
                        video.id,
                        `${detail.name} — T${video.season ?? '?'}:E${video.episode ?? '?'} ${video.title}`,
                      )
                    }
                    className="flex items-center justify-between gap-2.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-2 text-left text-xs text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)] cursor-pointer"
                  >
                    {video.thumbnail ? (
                      <img src={video.thumbnail} alt="" className="h-9 w-14 shrink-0 rounded object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      T{video.season ?? '?'}:E{video.episode ?? '?'} · {video.title}
                    </span>
                    <Play className="h-3.5 w-3.5 shrink-0 text-[var(--sc-accent)]" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-red-400">{error}</p> : null}

          {matchedLocalItem ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--sc-text-primary)]">
                  <HardDrive className="h-3.5 w-3.5 text-emerald-500" />
                  Disponível no seu Acervo Local · {matchedLocalItem.title}
                </p>
                <p className="truncate text-[11px] text-[var(--sc-text-secondary)]">
                  {matchedLocalItem.sourceName || 'Acervo Local'}
                  {matchedLocalItem.sourceStatus === 'offline' ? ' (HD desconectado no momento)' : ' · Reprodução instantânea'}
                </p>
              </div>
              {onPlayLocal ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onClose()
                    onPlayLocal(matchedLocalItem)
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                  Assistir do Acervo Local
                </Button>
              ) : null}
            </div>
          ) : null}

          {streamTargetLabel ? (
            <div className="space-y-2 border-t border-[var(--sc-border-subtle)] pt-3">
              <p className="text-xs font-semibold text-[var(--sc-text-primary)]">
                Streams para: <span className="text-[var(--sc-accent)]">{streamTargetLabel}</span>
              </p>
              {loadingStreams ? (
                <p className="text-xs text-[var(--sc-text-secondary)]">Consultando seus addons ativos...</p>
              ) : streams.length === 0 ? (
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  Nenhum stream retornado pelos addons ativos para este título.
                </p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {streams.map((stream, index) => (
                    <div
                      key={`${stream.addonId}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-semibold text-[var(--sc-text-primary)]">
                            {stream.addonName} · {stream.name}
                          </p>
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
                        <p className="truncate text-xs text-[var(--sc-text-secondary)]">{stream.title}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                      {(stream.isDirectHttp && stream.url) || stream.infoHash ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          title="Baixar para o Acervo Local (D:\Filmes\Downloads)"
                          onClick={() => void queueLocalDownload(stream)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Offline
                        </Button>
                      ) : null}
                      {stream.isDirectHttp && stream.url ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            onClose()
                            onPlayStream({
                              mediaId: '',
                              title: `${streamTargetLabel} (${stream.addonName})`,
                              url: stream.url!,
                              overview: detail.description,
                              externalSubtitles: subtitles.slice(0, 10).map((sub) => ({
                                label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
                                url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
                              })),
                            })
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Reproduzir no Player
                        </Button>
                      ) : stream.ytId ? (
                        <a
                          href={`https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-[var(--sc-radius-md)] border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir no YouTube
                        </a>
                      ) : stream.infoHash ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const params = new URLSearchParams({ infoHash: stream.infoHash! })
                            if (typeof stream.fileIdx === 'number') {
                              params.set('fileIdx', String(stream.fileIdx))
                            }
                            onClose()
                            onPlayStream({
                              mediaId: '',
                              title: `${streamTargetLabel} (${stream.addonName})`,
                              url: `/api/addons/torrent-stream?${params.toString()}`,
                              overview: detail.description,
                              externalSubtitles: subtitles.slice(0, 10).map((sub) => ({
                                label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
                                url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
                              })),
                            })
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Reproduzir Torrent
                        </Button>
                      ) : (
                        <span className="text-xs text-amber-300">Sem URL HTTP direta</span>
                      )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {downloadStatus ? (
                <p className="text-xs font-medium text-emerald-400">{downloadStatus}</p>
              ) : null}
              {subtitles.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-semibold text-emerald-500">
                    {subtitles.length} legenda(s) encontrada(s) nos addons e vinculada(s) ao player:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {subtitles.slice(0, 8).map((sub, idx) => (
                      <a
                        key={`${sub.addonId}-${sub.id}-${idx}`}
                        href={`/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}&download=1&filename=${encodeURIComponent(`${detail.name}-${sub.lang}.srt`)}`}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                      >
                        <Download className="h-3 w-3 text-[var(--sc-accent)]" />
                        {sub.lang.toUpperCase()} · {sub.addonName}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
