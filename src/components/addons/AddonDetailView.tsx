import { ArrowLeft, Download, ExternalLink, Film, HardDrive, HeartHandshake, Play, Subtitles, Tv } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { LibraryItem, Profile } from '../../domain/catalog'
import { extractStreamLanguages } from '../../domain/streamLanguages'
import { parseRuntimeToSeconds, translateGenre, type AlternativeSource, type PlayableMedia } from '../../domain/uiHelpers'
import { SocialRecommendModal } from '../social/SocialRecommendModal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { LanguageFlagBadge } from '../ui/LanguageFlagBadge'
import { Modal } from '../ui/Modal'
import { SavanoLoader } from '../ui/SavanoLoader'
import type { AddonMetaSummary } from '../../domain/addonTypes'

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
  externalUrl?: string | null
  proxyHeaders?: Record<string, string> | null
  notWebReady?: boolean
  isDirectHttp: boolean
  ytId: string | null
  infoHash: string | null
  fileIdx?: number | null
  seeders?: number | null
  sizeLabel?: string | null
}

function parseSizeGb(sizeLabel?: string | null): number | null {
  if (!sizeLabel) return null
  const match = sizeLabel.match(/([\d.,]+)\s*(gb|tb|mb)/i)
  if (!match) return null
  const value = Number.parseFloat(match[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const unit = match[2].toLowerCase()
  if (unit === 'tb') return value * 1024
  if (unit === 'mb') return value / 1024
  return value
}

function buildStreamPlaybackUrl(s: AddonStreamItem): string | null {
  if (s.isDirectHttp && s.url) {
    if (s.notWebReady) {
      const params = new URLSearchParams({ url: s.url })
      if (s.proxyHeaders && Object.keys(s.proxyHeaders).length > 0) {
        params.set('headers', JSON.stringify(s.proxyHeaders))
      }
      return `/api/addons/http-transcode?${params.toString()}`
    }
    if (s.proxyHeaders && Object.keys(s.proxyHeaders).length > 0) {
      const params = new URLSearchParams({
        url: s.url,
        headers: JSON.stringify(s.proxyHeaders),
      })
      return `/api/addons/http-proxy?${params.toString()}`
    }
    return s.url
  }
  if (s.infoHash) {
    const params = new URLSearchParams({ infoHash: s.infoHash })
    if (typeof s.fileIdx === 'number') params.set('fileIdx', String(s.fileIdx))
    return `/api/addons/torrent-stream?${params.toString()}`
  }
  return null
}

function scoreAddonStream(s: AddonStreamItem, reputationMap: Record<string, number>): number {
  const repBonus = (reputationMap[s.addonId] || 0) * 25
  if (s.isDirectHttp && s.url) {
    return (s.notWebReady ? 350 : 500) + repBonus
  }
  if (s.infoHash) {
    const seeds = s.seeders ?? 0
    const sizeGb = parseSizeGb(s.sizeLabel)
    const heavyPenalty = sizeGb !== null && sizeGb > 15 ? -150 : 0
    if (seeds >= 10 && (sizeGb === null || sizeGb <= 4)) {
      return 450 + Math.min(seeds, 200) + repBonus
    }
    if (seeds >= 10) {
      return 300 + Math.min(seeds, 200) + heavyPenalty + repBonus
    }
    if (seeds > 0) {
      return 100 + seeds + heavyPenalty + repBonus
    }
    return -50 + heavyPenalty + repBonus
  }
  if (s.externalUrl || s.ytId) return -200
  return -1000
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
  profileId?: string
  profiles?: Profile[]
  isAdmin?: boolean
  onBack: () => void
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal: (item: LibraryItem) => void
}

/** Dedicated full-page detail view for online/addon movies and series (replacing cramped modals). */
export function AddonDetailView({
  item,
  localCatalog,
  profileId = 'profile-savio',
  profiles = [],
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
  const [subtitlesModalOpen, setSubtitlesModalOpen] = useState(false)
  const [socialModalOpen, setSocialModalOpen] = useState(false)
  const [streamGroupBy, setStreamGroupBy] = useState<'language' | 'addon'>('language')
  const [streamFilter, setStreamFilter] = useState<'all' | 'pt' | 'hd'>('all')
  const [nextOnlineEpisode, setNextOnlineEpisode] = useState<PlayableMedia | undefined>(undefined)
  const [resumeTarget, setResumeTarget] = useState<{ season: number; episode: number; positionSec: number } | null>(null)
  const [episodeProgressMap, setEpisodeProgressMap] = useState<Record<string, number>>({})
  const [visibleStreamLimit, setVisibleStreamLimit] = useState(30)
  const [quickPlaying, setQuickPlaying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const targetNorm = normalizeMatchTitle(detail.name || '')
    if (!targetNorm) return
    fetch(`/api/addons/progress?profileId=${encodeURIComponent(profileId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ title?: string; season?: number | null; episode?: number | null; positionSec?: number; durationSec?: number }>) => {
        if (!active || !Array.isArray(rows)) return
        const nextMap: Record<string, number> = {}
        let firstResume: { season: number; episode: number; positionSec: number } | null = null
        for (const row of rows) {
          const clean = String(row.title || '')
            .replace(/\s*[—-]\s*T\d+:E\d+.*$/i, '')
            .replace(/\s*\([^)]*\)\s*$/, '')
            .trim()
          if (normalizeMatchTitle(clean) !== targetNorm) continue
          if (typeof row.season === 'number' && typeof row.episode === 'number') {
            const key = `${row.season}:${row.episode}`
            const dur = Number(row.durationSec) || 0
            const pos = Number(row.positionSec) || 0
            const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0
            if (!(key in nextMap)) nextMap[key] = pct
            if (!firstResume) {
              firstResume = { season: row.season, episode: row.episode, positionSec: pos }
            }
          }
        }
        setEpisodeProgressMap(nextMap)
        if (firstResume) setResumeTarget(firstResume)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [detail.name, profileId])

  const orderedVideos = useMemo(
    () =>
      [...(detail.videos ?? [])].sort(
        (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0),
      ),
    [detail.videos],
  )

  const heroTargetEpisode = useMemo(() => {
    if (orderedVideos.length === 0) return null
    if (resumeTarget) {
      const found = orderedVideos.find(
        (v) => v.season === resumeTarget.season && v.episode === resumeTarget.episode,
      )
      if (found) return found
    }
    return orderedVideos[0]
  }, [orderedVideos, resumeTarget])

  // Prefetch streams in background for the 1-click Hero episode target
  useEffect(() => {
    if (detail.type !== 'series' || !heroTargetEpisode?.id) return
    const params = new URLSearchParams({ type: 'series', id: heroTargetEpisode.id })
    void fetch(`/api/addons/streams?${params.toString()}`).catch(() => undefined)
  }, [detail.type, heroTargetEpisode?.id])

  async function handleQuickPlayHero() {
    setQuickPlaying(true)
    setError('')
    try {
      const isSeries = detail.type === 'series' && heroTargetEpisode
      const targetType = isSeries ? 'series' : detail.type
      const targetId = isSeries ? heroTargetEpisode.id : detail.id
      const targetLabel = isSeries
        ? `${detail.name} — T${heroTargetEpisode.season ?? '?'}:E${heroTargetEpisode.episode ?? '?'}`
        : detail.name

      if (isSeries) {
        setSelectedSeason(heroTargetEpisode.season ?? 1)
        setSelectedEpisodeId(heroTargetEpisode.id)
      }
      setStreamTargetLabel(targetLabel)

      const params = new URLSearchParams({ type: targetType, id: targetId })
      const [streamRes, subRes] = await Promise.all([
        fetch(`/api/addons/streams?${params.toString()}`),
        fetch(`/api/addons/subtitles?${params.toString()}`),
      ])
      const streamPayload = await streamRes.json().catch(() => null)
      const subPayload = await subRes.json().catch(() => null)
      const loadedStreams: AddonStreamItem[] = Array.isArray(streamPayload?.streams) ? streamPayload.streams : []
      const loadedSubs: AddonSubtitleItem[] = Array.isArray(subPayload?.subtitles) ? subPayload.subtitles : []
      setStreams(loadedStreams)
      setSubtitles(loadedSubs)

      const repMap = (() => {
        try {
          return JSON.parse(localStorage.getItem('savano-cine-addon-reputation') || '{}') as Record<string, number>
        } catch {
          return {} as Record<string, number>
        }
      })()
      const viable = loadedStreams.filter((s) => Boolean((s.isDirectHttp && s.url) || s.infoHash))
      const sorted = [...viable].sort((a, b) => scoreAddonStream(b, repMap) - scoreAddonStream(a, repMap))
      const best = sorted.find((s) => Boolean(buildStreamPlaybackUrl(s)))
      const bestUrl = best ? buildStreamPlaybackUrl(best) : null
      if (!best || !bestUrl) {
        setError('Nenhuma fonte reproduzível encontrada para iniciar automaticamente.')
        return
      }
      const altSources: AlternativeSource[] = sorted
        .map((s, idx) => {
          const url = buildStreamPlaybackUrl(s)
          if (!url) return null
          return {
            id: `${s.addonId}-${idx}`,
            label: `${s.addonName} · ${s.name}`,
            detail: s.title,
            url,
            badges: extractStreamLanguages(`${s.name} ${s.title}`),
            seeders: s.seeders ?? null,
            sizeLabel: s.sizeLabel ?? null,
            addonName: s.addonName,
          } as AlternativeSource
        })
        .filter((x): x is AlternativeSource => Boolean(x))

      const startPos =
        isSeries &&
        resumeTarget &&
        resumeTarget.season === heroTargetEpisode.season &&
        resumeTarget.episode === heroTargetEpisode.episode
          ? resumeTarget.positionSec
          : undefined

      onPlayStream({
        mediaId: '',
        title: `${targetLabel} (${best.addonName})`,
        url: bestUrl,
        duration: parseRuntimeToSeconds(detail.runtime),
        poster: detail.poster || undefined,
        overview: detail.description,
        startPosition: startPos,
        alternativeSources: altSources,
        externalSubtitles: loadedSubs.slice(0, 30).map((sub) => ({
          label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
          url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
        })),
      })
    } catch {
      setError('Erro de rede ao iniciar reprodução rápida.')
    } finally {
      setQuickPlaying(false)
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
    setVisibleStreamLimit(30)
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
    const isStreamUrlId =
      item.id === 'search' ||
      item.id.startsWith('/api/') ||
      item.id.startsWith('http') ||
      (!item.id.includes(':') && !/^tt\d+$/i.test(item.id) && !/^\d+$/.test(item.id))
    const epMatch = item.name.match(/T(\d+):E(\d+)/i)
    const cleanSearchTitle = item.name
      .replace(/\s*[—-]\s*T\d+:E\d+.*$/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()

    const resolveMeta = async () => {
      let resolvedMeta: AddonMetaSummary | null = null
      if (!isStreamUrlId) {
        const metaUrl = item.addonId
          ? `/api/addons/${encodeURIComponent(item.addonId)}/meta?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.id)}`
          : `/api/addons/fallback-meta?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.id)}`
        const res = await fetch(metaUrl).catch(() => null)
        const payload = res && res.ok ? await res.json().catch(() => null) : null
        if (payload?.meta) {
          resolvedMeta = { ...item, ...payload.meta }
        }
      }

      if (!resolvedMeta && cleanSearchTitle) {
        const searchRes = await fetch(`/api/addons/search?q=${encodeURIComponent(cleanSearchTitle)}`).catch(() => null)
        const searchData = searchRes && searchRes.ok ? await searchRes.json().catch(() => null) : null
        const hits = Array.isArray(searchData?.metas) ? (searchData.metas as AddonMetaSummary[]) : []
        const desiredType = epMatch ? 'series' : item.type
        const match = hits.find((h) => h.type === desiredType && h.id) ?? hits.find((h) => h.id)
        if (match?.id) {
          const fbRes = await fetch(
            `/api/addons/fallback-meta?type=${encodeURIComponent(match.type || desiredType)}&id=${encodeURIComponent(match.id)}`,
          ).catch(() => null)
          const fbData = fbRes && fbRes.ok ? await fbRes.json().catch(() => null) : null
          resolvedMeta = fbData?.meta ? { ...match, ...fbData.meta } : match
        }
      }

      if (!active) return
      if (resolvedMeta) {
        setDetail(resolvedMeta)
        if (epMatch && resolvedMeta.videos?.length) {
          const targetSeason = Number(epMatch[1])
          const targetEpisode = Number(epMatch[2])
          setSelectedSeason(targetSeason)
          const matchedEp = resolvedMeta.videos.find(
            (v) => v.season === targetSeason && v.episode === targetEpisode,
          )
          if (matchedEp) {
            setSelectedEpisodeId(matchedEp.id)
            void fetchStreamsFor(
              'series',
              matchedEp.id,
              `${resolvedMeta.name} — T${targetSeason}:E${targetEpisode}`,
            )
          }
        } else if (resolvedMeta.type !== 'series' && isStreamUrlId && resolvedMeta.id) {
          void fetchStreamsFor(resolvedMeta.type, resolvedMeta.id, resolvedMeta.name)
        }
      }
      setLoadingMeta(false)
    }

    void resolveMeta()

    if (item.type !== 'series' && !isStreamUrlId) {
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

  useEffect(() => {
    if (detail.type !== 'series' || !selectedEpisodeId || !detail.videos?.length) {
      return
    }
    const ordered = [...detail.videos].sort(
      (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0),
    )
    const idx = ordered.findIndex((v) => v.id === selectedEpisodeId)
    const nextVid = idx >= 0 && idx + 1 < ordered.length ? ordered[idx + 1] : null
    if (!nextVid) return
    let active = true
    const params = new URLSearchParams({ type: 'series', id: nextVid.id })
    fetch(`/api/addons/streams?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { streams?: AddonStreamItem[] } | null) => {
        if (!active || !Array.isArray(payload?.streams)) return
        const firstPlayable = payload.streams.find((s) => (s.isDirectHttp && s.url) || s.infoHash)
        if (!firstPlayable) return
        const url = firstPlayable.isDirectHttp && firstPlayable.url
          ? firstPlayable.url
          : `/api/addons/torrent-stream?infoHash=${encodeURIComponent(firstPlayable.infoHash!)}${typeof firstPlayable.fileIdx === 'number' ? `&fileIdx=${firstPlayable.fileIdx}` : ''}`
        setNextOnlineEpisode({
          mediaId: '',
          title: `${detail.name} — T${nextVid.season ?? '?'}:E${nextVid.episode ?? '?'} ${nextVid.title}`,
          url,
          duration: parseRuntimeToSeconds(detail.runtime),
          poster: detail.poster || undefined,
          overview: nextVid.overview || detail.description,
        })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [detail.description, detail.name, detail.poster, detail.runtime, detail.type, detail.videos, selectedEpisodeId])

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
                <Badge key={g} tone="neutral">{translateGenre(g)}</Badge>
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
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {(detail.type !== 'series' || heroTargetEpisode) && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={quickPlaying}
                  onClick={() => void handleQuickPlayHero()}
                >
                  <Play className="h-4 w-4" />
                  {quickPlaying
                    ? 'Buscando melhor fonte...'
                    : detail.type === 'series' && heroTargetEpisode
                      ? resumeTarget &&
                        resumeTarget.season === heroTargetEpisode.season &&
                        resumeTarget.episode === heroTargetEpisode.episode
                        ? `Continuar T${heroTargetEpisode.season ?? '?'}:E${heroTargetEpisode.episode ?? '?'} (Melhor Fonte)`
                        : `Assistir T${heroTargetEpisode.season ?? '?'}:E${heroTargetEpisode.episode ?? '?'} (Melhor Fonte)`
                      : 'Assistir (Melhor Fonte)'}
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={() => setSocialModalOpen(true)}>
                <HeartHandshake className="h-4 w-4" />
                Comentar / Indicar
              </Button>
            </div>
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
                          <div className="flex items-center gap-2">
                            <p className="m-0 truncate font-semibold">
                              T{video.season ?? '?'}:E{video.episode ?? '?'} · {video.title}
                            </p>
                            {(() => {
                              const epPct =
                                typeof video.season === 'number' && typeof video.episode === 'number'
                                  ? episodeProgressMap[`${video.season}:${video.episode}`]
                                  : undefined
                              if (epPct === undefined) return null
                              return epPct >= 85 ? (
                                <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  Visto
                                </span>
                              ) : epPct > 0 ? (
                                <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                  {epPct}%
                                </span>
                              ) : null
                            })()}
                          </div>
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
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
                  <Film className="h-4 w-4 text-[var(--sc-accent)]" />
                  Informações do Filme
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
              <p className="m-0 text-sm leading-relaxed text-[var(--sc-text-secondary)]">
                {detail.description || 'Sinopse indisponível para este título nos metadados atuais.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {detail.releaseInfo ? <Badge tone="neutral">Ano: {detail.releaseInfo}</Badge> : null}
                {detail.runtime ? <Badge tone="neutral">Duração: {detail.runtime}</Badge> : null}
                {detail.genres?.slice(0, 4).map((g) => (
                  <Badge key={`info-${g}`} tone="neutral">{translateGenre(g)}</Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={subtitles.length === 0 && !loadingStreams}
                  onClick={() => setSubtitlesModalOpen(true)}
                >
                  <Subtitles className="h-4 w-4" />
                  {loadingStreams
                    ? 'Buscando legendas...'
                    : `Baixar legendas (${subtitles.length})`}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Streams */}
        <div className="min-w-0 space-y-3 overflow-hidden rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 truncate text-base font-bold text-[var(--sc-text-primary)]">
              Fontes de Reprodução {streamTargetLabel ? `· ${streamTargetLabel}` : ''}
            </h2>
            {streams.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: 'pt', label: '🇧🇷 PT / Dublado' },
                    { id: 'hd', label: '4K / 1080p' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStreamFilter(f.id)}
                    className={`rounded-full border px-2.5 py-0.5 font-semibold transition cursor-pointer ${
                      streamFilter === f.id
                        ? 'border-[var(--sc-accent)] bg-[var(--sc-accent-soft)] text-[var(--sc-accent)]'
                        : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStreamGroupBy((prev) => (prev === 'language' ? 'addon' : 'language'))}
                  className="rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-0.5 font-semibold text-[var(--sc-text-secondary)] hover:border-[var(--sc-accent)] hover:text-[var(--sc-text-primary)] cursor-pointer"
                >
                  Agrupar: {streamGroupBy === 'language' ? 'Idioma' : 'Addon'}
                </button>
              </div>
            )}
          </div>
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
          ) : (() => {
            const buildPlaybackUrl = buildStreamPlaybackUrl

            const reputationMap = (() => {
              try {
                return JSON.parse(localStorage.getItem('savano-cine-addon-reputation') || '{}') as Record<string, number>
              } catch {
                return {} as Record<string, number>
              }
            })()

            const scoreStream = (s: AddonStreamItem): number => scoreAddonStream(s, reputationMap)

            // Hide dead entries that have no playable URL, infoHash, YouTube ID, or externalUrl.
            const viableStreams = streams.filter(
              (s) => Boolean((s.isDirectHttp && s.url) || s.infoHash || s.ytId || s.externalUrl),
            )
            const sortedStreams = [...viableStreams].sort((a, b) => scoreStream(b) - scoreStream(a))

            const alternativeSources: AlternativeSource[] = sortedStreams
              .map((s, idx) => {
                const url = buildPlaybackUrl(s)
                if (!url) return null
                return {
                  id: `${s.addonId}-${idx}`,
                  label: `${s.addonName} · ${s.name}`,
                  detail: s.title,
                  url,
                  badges: extractStreamLanguages(`${s.name} ${s.title}`),
                  seeders: s.seeders ?? null,
                  sizeLabel: s.sizeLabel ?? null,
                  addonName: s.addonName,
                } as AlternativeSource
              })
              .filter((x): x is AlternativeSource => Boolean(x))

            const bestPlayableStream = sortedStreams.find((s) => Boolean(buildPlaybackUrl(s))) ?? null

            const playStreamItem = (stream: AddonStreamItem) => {
              const targetUrl = buildPlaybackUrl(stream)
              if (!targetUrl) return
              try {
                const stats = JSON.parse(localStorage.getItem('savano-cine-addon-reputation') || '{}')
                stats[stream.addonId] = (Number(stats[stream.addonId]) || 0) + 1
                localStorage.setItem('savano-cine-addon-reputation', JSON.stringify(stats))
              } catch {
                // ignore
              }
              onPlayStream({
                mediaId: '',
                title: `${streamTargetLabel} (${stream.addonName})`,
                url: targetUrl,
                duration: parseRuntimeToSeconds(detail.runtime),
                poster: detail.poster || undefined,
                overview: detail.description,
                nextEpisode: detail.type === 'series' ? nextOnlineEpisode : undefined,
                alternativeSources,
                externalSubtitles: subtitles.slice(0, 30).map((sub) => ({
                  label: `${sub.lang.toUpperCase()} (${sub.addonName})`,
                  url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}`,
                })),
              })
            }

            const filteredStreams = sortedStreams.filter((s) => {
              const text = `${s.addonName} ${s.name} ${s.title}`.toLowerCase()
              if (streamFilter === 'pt') {
                return /pt-br|ptbr|dublado|\bdub\b|dual|brasil|brazil|mico-le|fenix|brazuca|🇧🇷|🇵🇹/.test(text)
              }
              if (streamFilter === 'hd') {
                return /2160p|4k|1080p|uhd|bluray/.test(text)
              }
              return true
            })

            const visibleFilteredStreams = filteredStreams.slice(0, visibleStreamLimit)
            const remainingStreamCount = Math.max(0, filteredStreams.length - visibleFilteredStreams.length)

            const grouped = new Map<string, AddonStreamItem[]>()
            for (const s of visibleFilteredStreams) {
              const badges = extractStreamLanguages(`${s.name} ${s.title}`)
              let groupKey = s.addonName
              if (streamGroupBy === 'language') {
                const text = `${s.addonName} ${s.name} ${s.title}`.toLowerCase()
                if (badges.some((b) => b.includes('Dublado') || b.includes('PT-BR') || b.includes('Dual')) || /mico-le|fenix|brazuca/.test(text)) {
                  groupKey = 'Dublado / Português'
                } else if (badges.some((b) => b.includes('ENG'))) {
                  groupKey = 'Original / Inglês'
                } else {
                  groupKey = 'Outras Fontes / Multi'
                }
              }
              if (!grouped.has(groupKey)) grouped.set(groupKey, [])
              grouped.get(groupKey)!.push(s)
            }

            if (sortedStreams.length === 0) {
              return (
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  Nenhuma fonte reproduzível encontrada nos addons ativos para este título.
                </p>
              )
            }

            if (filteredStreams.length === 0) {
              return (
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  Nenhuma fonte corresponde a este filtro. Tente clicar em "Todas".
                </p>
              )
            }

            return (
              <div className="space-y-3">
                {bestPlayableStream ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--sc-radius-md)] border border-[var(--sc-accent)]/40 bg-[var(--sc-accent-soft)]/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-semibold text-[var(--sc-text-primary)]">
                        Melhor fonte recomendada: {bestPlayableStream.addonName} · {bestPlayableStream.name}
                      </p>
                      <p className="m-0 truncate text-[11px] text-[var(--sc-text-secondary)]">
                        {bestPlayableStream.isDirectHttp
                          ? 'Stream HTTP direto (início rápido)'
                          : `${bestPlayableStream.seeders ?? 0} seeds${bestPlayableStream.sizeLabel ? ` · ${bestPlayableStream.sizeLabel}` : ''}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => playStreamItem(bestPlayableStream)}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Assistir Melhor Fonte
                    </Button>
                  </div>
                ) : null}
                <div className="max-h-[520px] space-y-4 overflow-x-hidden overflow-y-auto pr-1">
                {[...grouped.entries()].map(([groupTitle, groupItems]) => (
                  <div key={groupTitle} className="space-y-2">
                    <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--sc-bg-elevated)]/95 py-1 backdrop-blur-xs">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--sc-accent)]">
                        {groupTitle}
                      </span>
                      <span className="text-[11px] text-[var(--sc-text-muted)]">{groupItems.length} fonte(s)</span>
                    </div>
                    {groupItems.map((stream, index) => {
                const langBadges = extractStreamLanguages(`${stream.name} ${stream.title}`)
                const canPlayDirect = Boolean(stream.isDirectHttp && stream.url)
                const canPlayTorrent = Boolean(stream.infoHash)
                const isPlayable = canPlayDirect || canPlayTorrent
                const sizeGb = parseSizeGb(stream.sizeLabel)
                const isHeavyFile = sizeGb !== null && sizeGb > 15
                const directDownloadHref = buildPlaybackUrl(stream)
                const startPlay = () => playStreamItem(stream)
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
                        {(reputationMap[stream.addonId] || 0) >= 2 && (
                          <Badge tone="gold">Preferido</Badge>
                        )}
                        {langBadges.map((badge) => (
                          <LanguageFlagBadge key={badge} label={badge} />
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
                        {canPlayDirect ? (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                            {stream.notWebReady ? 'HTTP · Transcode' : 'HTTP Direto'}
                          </span>
                        ) : null}
                        {stream.sizeLabel ? (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[var(--sc-text-secondary)]">
                            {stream.sizeLabel}
                          </span>
                        ) : null}
                        {isHeavyFile ? (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                            Arquivo pesado · Pode travar
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
                      {canPlayDirect && directDownloadHref ? (
                        <a
                          href={directDownloadHref}
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
                      ) : stream.externalUrl ? (
                        <a
                          href={stream.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir no Navegador
                        </a>
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
                ))}
                {remainingStreamCount > 0 && (
                  <div className="pt-1 text-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setVisibleStreamLimit((n) => n + 40)}
                    >
                      Mostrar mais fontes ({remainingStreamCount} restantes)
                    </Button>
                  </div>
                )}
              </div>
              </div>
            )
          })()}
          {downloadStatus ? (
            <p className="text-xs font-medium text-emerald-400">{downloadStatus}</p>
          ) : null}
        </div>
      </div>

      <Modal
        open={subtitlesModalOpen}
        onClose={() => setSubtitlesModalOpen(false)}
        title={`Legendas disponíveis · ${detail.name}`}
      >
        {subtitles.length === 0 ? (
          <p className="m-0 text-xs text-[var(--sc-text-secondary)]">
            Nenhuma legenda externa encontrada nos addons para este título.
          </p>
        ) : (
          <div className="flex max-h-[380px] flex-wrap gap-2 overflow-y-auto pr-1">
            {subtitles.slice(0, 32).map((sub, idx) => (
              <a
                key={`modal-${sub.addonId}-${sub.id}-${idx}`}
                href={`/api/addons/subtitle-proxy?url=${encodeURIComponent(sub.url)}&download=1&filename=${encodeURIComponent(`${detail.name}-${sub.lang}.srt`)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
              >
                <Download className="h-3.5 w-3.5 text-[var(--sc-accent)]" />
                {sub.lang.toUpperCase()} · {sub.addonName}
              </a>
            ))}
          </div>
        )}
      </Modal>
      <SocialRecommendModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        profileId={profileId}
        profiles={profiles}
        contentKey={detail.id}
        contentType={detail.type === 'series' ? 'series' : 'movie'}
        title={detail.name}
        poster={detail.poster}
      />
    </div>
  )
}
