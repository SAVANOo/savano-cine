import { ArrowLeft, Download, Layers, ListVideo, Maximize2, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipForward, Subtitles, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { findActiveCueText, parseWebVtt, type VttCue } from '../../domain/vttParser'
import { LanguageFlagBadge } from '../ui/LanguageFlagBadge'
import { PlayerEpisodesDrawer } from './PlayerEpisodesDrawer'
import { PlayerTrackMenu } from './PlayerTrackMenu'
import { SavanoLoader } from '../ui/SavanoLoader'

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

type VideoPlayerProps = {
  media: PlayableMedia
  profileId: string
  isAdmin?: boolean
  capabilities: { ffmpeg: boolean; transcoding?: boolean; ffprobe: boolean; vlc: boolean } | null
  onPlayNext?: (next: PlayableMedia) => void
  onClose: () => void
}

type StreamInfo = {
  duration?: number
  audio: Array<{ index: number; language: string; title: string }>
  subtitles: Array<{ index: number; language: string; title: string }>
}

function shiftTextTrackCues(tracks: TextTrackList, appliedDelta: number) {
  for (let i = 0; i < tracks.length; i += 1) {
    const cues = tracks[i]?.cues
    if (!cues) continue
    for (let j = 0; j < cues.length; j += 1) {
      const cue = cues[j] as VTTCue
      const nextStart = Math.max(0, cue.startTime + appliedDelta)
      const nextEnd = Math.max(nextStart + 0.2, cue.endTime + appliedDelta)
      Object.assign(cue, { startTime: nextStart, endTime: nextEnd })
    }
  }
}

/** Netflix-style immersive player with auto-hiding overlays, paused screen, and Idioma | Legendas popover. */
export function VideoPlayer({ media, profileId, isAdmin = false, capabilities, onPlayNext, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastSavedPosition = useRef(0)
  const pendingPosition = useRef<number | null>(media.startPosition ?? null)
  const hideTimer = useRef<number | null>(null)
  const pauseOverlayTimer = useRef<number | null>(null)

  const initialTranscode = Boolean(media.needsTranscode && media.mediaId && capabilities?.transcoding !== false)
  const initialStart = Math.max(0, Math.floor(media.startPosition ?? 0))
  const [playbackUrl, setPlaybackUrl] = useState(() =>
    initialTranscode && media.mediaId
      ? `/api/media/${encodeURIComponent(media.mediaId)}/transcode?format=mp4${initialStart > 1 ? `&start=${initialStart}` : ''}`
      : media.url,
  )
  const [playbackError, setPlaybackError] = useState('')
  const [downloadToast, setDownloadToast] = useState('')
  const isOnlineStream =
    media.url.startsWith('/api/addons/torrent-stream') || /^https?:\/\//i.test(media.url)
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ label: string; url: string }>>(
    () => media.externalSubtitles ?? [],
  )
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null)
  const [audioStream, setAudioStream] = useState('')
  const [subtitleStream, setSubtitleStream] = useState('')
  const [selectedSubtitleUrl, setSelectedSubtitleUrl] = useState(() => {
    const ext = media.externalSubtitles ?? []
    const pt = ext.find((t) => /\b(pob|por|pt|pt-br|portugu)/i.test(t.label))
    return pt?.url ?? ''
  })
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState(0)
  const [subtitleSize, setSubtitleSize] = useState<'sm' | 'md' | 'lg'>('md')
  const [secondarySubtitleUrl, setSecondarySubtitleUrl] = useState('')
  const [dualSubLayout, setDualSubLayout] = useState<'native-larger' | 'study-larger'>(() => {
    try {
      const saved = localStorage.getItem('sc_dual_sub_layout')
      return saved === 'study-larger' ? 'study-larger' : 'native-larger'
    } catch {
      return 'native-larger'
    }
  })
  const [dualSubColor, setDualSubColor] = useState<'amber' | 'cyan' | 'white'>(() => {
    try {
      const saved = localStorage.getItem('sc_dual_sub_color')
      return saved === 'cyan' || saved === 'white' ? saved : 'amber'
    } catch {
      return 'amber'
    }
  })
  const [primaryCues, setPrimaryCues] = useState<VttCue[]>([])
  const [secondaryCues, setSecondaryCues] = useState<VttCue[]>([])

  useEffect(() => {
    if (!secondarySubtitleUrl || !selectedSubtitleUrl) return
    let active = true
    fetch(selectedSubtitleUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        if (active) setPrimaryCues(text ? parseWebVtt(text) : [])
      })
      .catch(() => {
        if (active) setPrimaryCues([])
      })
    return () => {
      active = false
    }
  }, [secondarySubtitleUrl, selectedSubtitleUrl])

  useEffect(() => {
    if (!secondarySubtitleUrl) return
    let active = true
    fetch(secondarySubtitleUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        if (active) setSecondaryCues(text ? parseWebVtt(text) : [])
      })
      .catch(() => {
        if (active) setSecondaryCues([])
      })
    return () => {
      active = false
    }
  }, [secondarySubtitleUrl])
  const [loadingAddonSubs, setLoadingAddonSubs] = useState(false)
  const [addonSubsNotice, setAddonSubsNotice] = useState('')
  const [torrentStats, setTorrentStats] = useState<{ numPeers: number; downloadSpeed: number; progress: number } | null>(null)
  const [seekToast, setSeekToast] = useState<string>('')
  const lastTouchTapRef = useRef<{ at: number; x: number } | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [sourcesMenuOpen, setSourcesMenuOpen] = useState(false)
  const [episodesMenuOpen, setEpisodesMenuOpen] = useState(false)
  const [hoveredEpisodeId, setHoveredEpisodeId] = useState<string | null>(null)
  const [selectedEpisodeSeason, setSelectedEpisodeSeason] = useState<number>(() => {
    for (const s of media.showSeasons ?? []) {
      if (s.episodes.some((ep) => ep.mediaId === media.mediaId)) return s.number
    }
    return media.showSeasons?.[0]?.number ?? 1
  })
  const [isPaused, setIsPaused] = useState(false)
  const [isLoadingMedia, setIsLoadingMedia] = useState(true)
  const [showPausedInfo, setShowPausedInfo] = useState(false)
  const [nextCountdown, setNextCountdown] = useState<number | null>(null)
  const initialDuration = media.duration && media.duration > 2 ? media.duration : 0
  const [currentTime, setCurrentTime] = useState(initialTranscode ? initialStart : 0)
  const [duration, setDuration] = useState(initialDuration)
  const [, setTranscodeOffset] = useState(initialTranscode ? initialStart : 0)
  const transcodeOffsetRef = useRef(initialTranscode ? initialStart : 0)
  const totalDurationRef = useRef(initialDuration)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const prefsKey = `savano-cine-player-prefs:${profileId}`
  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(prefsKey) || '{}')
      return typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 3 ? saved.volume : 1
    } catch {
      return 1
    }
  })
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(prefsKey) || '{}')
      return typeof saved.playbackRate === 'number' && [0.75, 1, 1.25, 1.5, 2].includes(saved.playbackRate)
        ? saved.playbackRate
        : 1
    } catch {
      return 1
    }
  })
  const [hoverPreview, setHoverPreview] = useState<{ seconds: number; percent: number; bucket: number; imgOk: boolean } | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify({ volume, playbackRate }))
    } catch {
      // ignore storage quota errors
    }
  }, [prefsKey, volume, playbackRate])

  const applyVolume = useCallback((nextVol: number, nextMuted: boolean) => {
    const video = videoRef.current
    if (!video) return
    if (nextVol > 1 && !gainNodeRef.current && typeof AudioContext !== 'undefined') {
      try {
        const ctx = new AudioContext()
        const source = ctx.createMediaElementSource(video)
        const gain = ctx.createGain()
        const compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -4
        compressor.knee.value = 10
        compressor.ratio.value = 6
        compressor.attack.value = 0.003
        compressor.release.value = 0.15
        source.connect(gain)
        gain.connect(compressor)
        compressor.connect(ctx.destination)
        audioCtxRef.current = ctx
        gainNodeRef.current = gain
      } catch {
        // Fallback to native volume if Web Audio is unavailable
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => undefined)
    }
    if (gainNodeRef.current) {
      video.volume = 1
      video.muted = nextMuted
      gainNodeRef.current.gain.value = nextMuted ? 0 : nextVol
    } else {
      video.volume = Math.max(0, Math.min(1, nextVol))
      video.muted = nextMuted
    }
  }, [])

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    setControlsVisible(true)
    hideTimer.current = window.setTimeout(() => {
      if (!trackMenuOpen && videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
      }
    }, 2800)
  }, [trackMenuOpen])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    if (pauseOverlayTimer.current) window.clearTimeout(pauseOverlayTimer.current)
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
    void audioCtxRef.current?.close().catch(() => undefined)
  }, [])

  useEffect(() => {
    const match = playbackUrl.match(/[?&]infoHash=([a-fA-F0-9]{40}|[A-Z2-7]{32})/i)
    if (!match) return
    const infoHash = match[1]
    let active = true
    const poll = () => {
      fetch(`/api/addons/torrent-status?infoHash=${encodeURIComponent(infoHash)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (active && data && typeof data.numPeers === 'number') {
            setTorrentStats({
              numPeers: data.numPeers,
              downloadSpeed: Number(data.downloadSpeed || 0),
              progress: Number(data.progress || 0),
            })
          }
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [playbackUrl])

  const fetchAddonSubtitlesInPlayer = async () => {
    setLoadingAddonSubs(true)
    setAddonSubsNotice('')
    try {
      const epMatch = media.title.match(/T(\d+):E(\d+)/i)
      const baseQuery = (media.showTitle || media.title.replace(/\s*[—-]\s*T\d+:E\d+.*$/i, '').replace(/\s*\([^)]*\)\s*$/, '')).trim()
      const searchRes = await fetch(`/api/addons/search?q=${encodeURIComponent(baseQuery)}`)
      const searchData = await searchRes.json().catch(() => null)
      const metas = Array.isArray(searchData?.metas) ? searchData.metas : []
      const desiredType = epMatch || media.showTitle ? 'series' : 'movie'
      const match = metas.find((m: { type?: string }) => m.type === desiredType) ?? metas[0]
      if (!match?.id) {
        setAddonSubsNotice('Título não encontrado nos addons.')
        return
      }
      const targetId = epMatch ? `${match.id}:${Number(epMatch[1])}:${Number(epMatch[2])}` : match.id
      const subRes = await fetch(`/api/addons/subtitles?type=${encodeURIComponent(desiredType)}&id=${encodeURIComponent(targetId)}`)
      const subData = await subRes.json().catch(() => null)
      const found = Array.isArray(subData?.subtitles) ? subData.subtitles : []
      if (found.length === 0) {
        setAddonSubsNotice('Nenhuma legenda encontrada nos addons.')
        return
      }
      const mapped = found.slice(0, 30).map((s: { lang?: string; addonName?: string; url: string }) => ({
        label: `${String(s.lang || 'SUB').toUpperCase()} (${s.addonName || 'Addon'})`,
        url: `/api/addons/subtitle-proxy?url=${encodeURIComponent(s.url)}`,
      }))
      setSubtitleTracks((prev) => {
        const existing = new Set(prev.map((p) => p.url))
        return [...prev, ...mapped.filter((m: { url: string }) => !existing.has(m.url))]
      })
      const pt = mapped.find((m: { label: string }) => /\b(pob|por|pt|pt-br|portugu)/i.test(m.label)) ?? mapped[0]
      if (pt) {
        setSubtitleStream('')
        setSelectedSubtitleUrl(pt.url)
      }
      setAddonSubsNotice(`${mapped.length} legenda(s) carregada(s)!`)
    } catch {
      setAddonSubsNotice('Erro ao buscar legendas nos addons.')
    } finally {
      setLoadingAddonSubs(false)
    }
  }

  const adjustSubtitleOffset = (delta: number) => {
    const nextOffset = delta === 0 ? 0 : Math.round((subtitleOffsetSec + delta) * 10) / 10
    const appliedDelta = delta === 0 ? -subtitleOffsetSec : delta
    setSubtitleOffsetSec(nextOffset)
    const video = videoRef.current
    if (!video || appliedDelta === 0) return
    shiftTextTrackCues(video.textTracks, appliedDelta)
  }

  useEffect(() => {
    if (nextCountdown === null || !media.nextEpisode || !onPlayNext) return
    if (nextCountdown <= 0) {
      onPlayNext(media.nextEpisode)
      return
    }
    const timer = window.setTimeout(() => setNextCountdown((c) => (c !== null ? c - 1 : null)), 1000)
    return () => window.clearTimeout(timer)
  }, [media.nextEpisode, nextCountdown, onPlayNext])

  useEffect(() => {
    if (!media.mediaId || media.startPosition === 0) return
    fetch(`/api/progress?profileId=${encodeURIComponent(profileId)}&mediaId=${encodeURIComponent(media.mediaId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((progress) => {
        if (progress?.position && progress.position > 0 && videoRef.current && media.startPosition === undefined) {
          if (videoRef.current.readyState >= 1) {
            videoRef.current.currentTime = progress.position
          } else {
            pendingPosition.current = progress.position
          }
        }
      })
      .catch(() => undefined)
  }, [media.mediaId, media.startPosition, profileId])

  const saveProgress = useCallback((force = false) => {
    const video = videoRef.current
    if (!video) return
    const effectivePos = transcodeOffsetRef.current + video.currentTime
    const effectiveDur = totalDurationRef.current || (Number.isFinite(video.duration) ? video.duration : 0)
    if (!effectiveDur || Number.isNaN(effectiveDur)) return
    if (!force && Math.abs(effectivePos - lastSavedPosition.current) < 5 && effectivePos < effectiveDur - 2) return
    lastSavedPosition.current = effectivePos
    if (!media.mediaId) {
      void fetch('/api/addons/progress', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          mediaKey: media.url.slice(0, 240),
          title: media.title,
          poster: media.poster || undefined,
          positionSec: effectivePos,
          durationSec: effectiveDur,
        }),
      }).catch(() => undefined)
      return
    }
    void fetch('/api/progress', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId,
        mediaId: media.mediaId,
        position: effectivePos,
        duration: effectiveDur,
        watched: effectivePos >= effectiveDur * 0.9,
      }),
    })
  }, [media.mediaId, media.poster, media.title, media.url, profileId])

  useEffect(() => () => saveProgress(true), [saveProgress])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playbackUrl.includes('.m3u8')) return
    let active = true
    let hlsInstance: { destroy: () => void } | null = null
    void import('hls.js').then(({ default: Hls }) => {
      if (!active || !Hls.isSupported()) return
      const hls = new Hls()
      hlsInstance = hls
      hls.loadSource(playbackUrl)
      hls.attachMedia(video)
    })
    return () => {
      active = false
      hlsInstance?.destroy()
    }
  }, [playbackUrl])

  useEffect(() => {
    if (!media.url.startsWith('/api/addons/torrent-stream?')) return
    const query = media.url.split('?')[1] || ''
    const infoHash = new URLSearchParams(query).get('infoHash')
    if (!infoHash) return
    return () => {
      void fetch(`/api/addons/torrent-stream/${encodeURIComponent(infoHash)}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => undefined)
    }
  }, [media.url])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    if (!media.subtitleUrl) return
    fetch(media.subtitleUrl)
      .then((response) => (response.ok ? response.json() : []))
      .then(setSubtitleTracks)
      .catch(() => setSubtitleTracks([]))
  }, [media.subtitleUrl])

  useEffect(() => {
    if (!media.mediaId) return
    fetch(`/api/media/${encodeURIComponent(media.mediaId)}/streams`)
      .then((response) => (response.ok ? response.json() : null))
      .then((info: StreamInfo | null) => {
        setStreamInfo(info)
        if (info?.duration && info.duration > 0) {
          totalDurationRef.current = info.duration
          setDuration(info.duration)
        }
      })
      .catch(() => setStreamInfo(null))
  }, [media.mediaId])

  const buildTranscodeUrl = useCallback(
    (streamIdx: string, startSec: number) => {
      if (!media.mediaId) return media.url
      const audioParam = streamIdx ? `&audioStream=${encodeURIComponent(streamIdx)}` : ''
      const startParam = startSec > 1 ? `&start=${Math.floor(startSec)}` : ''
      return `/api/media/${encodeURIComponent(media.mediaId)}/transcode?format=mp4${audioParam}${startParam}`
    },
    [media.mediaId, media.url],
  )

  const changeAudioStream = (value: string) => {
    setAudioStream(value)
    setPlaybackError('')
    const effectivePos = transcodeOffsetRef.current + (videoRef.current?.currentTime ?? 0)
    if (!value && !media.needsTranscode) {
      transcodeOffsetRef.current = 0
      setTranscodeOffset(0)
      pendingPosition.current = effectivePos
      setPlaybackUrl(media.url)
      return
    }
    if (!media.mediaId || !capabilities?.transcoding) return
    const offset = Math.floor(effectivePos)
    transcodeOffsetRef.current = offset
    setTranscodeOffset(offset)
    setCurrentTime(effectivePos)
    pendingPosition.current = null
    setPlaybackUrl(buildTranscodeUrl(value, offset))
  }

  const seekTo = (targetSeconds: number) => {
    const clamped = Math.max(0, totalDurationRef.current ? Math.min(targetSeconds, totalDurationRef.current) : targetSeconds)
    setCurrentTime(clamped)
    const video = videoRef.current
    if (!video) return
    if (!playbackUrl.includes('/transcode')) {
      video.currentTime = clamped
      scheduleHideControls()
      return
    }
    const rel = clamped - transcodeOffsetRef.current
    if (rel >= 0 && Number.isFinite(video.duration) && rel <= video.duration) {
      video.currentTime = rel
    } else {
      const offset = Math.floor(clamped)
      transcodeOffsetRef.current = offset
      setTranscodeOffset(offset)
      setPlaybackUrl(buildTranscodeUrl(audioStream, offset))
    }
    scheduleHideControls()
  }

  const switchPlaybackSource = (nextUrl: string) => {
    const effectivePos = transcodeOffsetRef.current + (videoRef.current?.currentTime ?? 0)
    transcodeOffsetRef.current = 0
    setTranscodeOffset(0)
    pendingPosition.current = effectivePos
    setPlaybackError('')
    setIsLoadingMedia(true)
    setPlaybackUrl(nextUrl)
    setSourcesMenuOpen(false)
  }

  const changeSubtitleStream = (value: string) => {
    setSubtitleStream(value)
    if (!value) {
      setSelectedSubtitleUrl('')
      return
    }
    if (!media.mediaId) return
    setSelectedSubtitleUrl(
      `/api/media/${encodeURIComponent(media.mediaId)}/subtitles/embedded/${encodeURIComponent(value)}`,
    )
  }

  const seekBy = (delta: number) => {
    const effectivePos = transcodeOffsetRef.current + (videoRef.current?.currentTime ?? 0)
    seekTo(effectivePos + delta)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const toggleFullscreen = () => {
    const stage = videoRef.current?.parentElement
    if (!stage) return
    if (document.fullscreenElement) {
      try {
        ;(screen.orientation as { unlock?: () => void })?.unlock?.()
      } catch {
        // ignore
      }
      void document.exitFullscreen()
    } else {
      void stage
        .requestFullscreen?.()
        ?.then(() => {
          try {
            void (screen.orientation as { lock?: (mode: string) => Promise<void> })?.lock?.('landscape')?.catch(() => undefined)
          } catch {
            // ignore
          }
        })
        ?.catch(() => undefined)
    }
  }

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: media.title,
        artist: media.showTitle || 'Savano Cine',
      })
      navigator.mediaSession.setActionHandler('play', () => {
        void videoRef.current?.play().catch(() => undefined)
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        videoRef.current?.pause()
      })
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10)
        }
      })
      navigator.mediaSession.setActionHandler('seekforward', () => {
        if (videoRef.current) {
          videoRef.current.currentTime += 10
        }
      })
      if (media.nextEpisode && onPlayNext) {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          onPlayNext(media.nextEpisode!)
        })
      }
    } catch {
      // ignore unsupported MediaSession handlers
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
        navigator.mediaSession.setActionHandler('nexttrack', null)
      } catch {
        // ignore
      }
    }
  }, [media.nextEpisode, media.showTitle, media.title, onPlayNext])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (typeof navigator.mediaSession.setPositionState !== 'function') return
    if (!duration || duration <= 0 || !Number.isFinite(duration)) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.max(0, Math.min(currentTime, duration)),
      })
    } catch {
      // ignore invalid position state
    }
  }, [currentTime, duration, playbackRate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
        return
      }
      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const video = videoRef.current
        if (!video) return
        if (video.paused) void video.play()
        else video.pause()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10)
        scheduleHideControls()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (videoRef.current) videoRef.current.currentTime += 10
        scheduleHideControls()
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const stage = videoRef.current?.parentElement
        if (!stage) return
        if (document.fullscreenElement) void document.exitFullscreen()
        else void stage.requestFullscreen?.()
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setMuted((prev) => {
          const nextMuted = !prev
          applyVolume(volume, nextMuted)
          return nextMuted
        })
        scheduleHideControls()
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setTrackMenuOpen((prev) => !prev)
        scheduleHideControls()
      } else if (event.key.toLowerCase() === 'n' && media.nextEpisode && onPlayNext) {
        event.preventDefault()
        onPlayNext(media.nextEpisode)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const delta = event.key === 'ArrowUp' ? 0.1 : -0.1
        setVolume((prev) => {
          const nextVol = Math.max(0, Math.min(3, Math.round((prev + delta) * 100) / 100))
          const nextMuted = nextVol === 0
          setMuted(nextMuted)
          applyVolume(nextVol, nextMuted)
          return nextVol
        })
        scheduleHideControls()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyVolume, media.nextEpisode, onPlayNext, scheduleHideControls, volume])

  const syncMeasuredDuration = (video: HTMLVideoElement) => {
    if (playbackUrl.includes('/transcode')) return
    const isLiveTorrent = playbackUrl.includes('/api/addons/torrent-stream')
    let measured = Number.isFinite(video.duration) && video.duration > 2 ? video.duration : 0
    if (!measured && !isLiveTorrent && video.seekable && video.seekable.length > 0) {
      const end = video.seekable.end(video.seekable.length - 1)
      if (Number.isFinite(end) && end > 2) measured = end
    }
    if (measured > Math.max(2, totalDurationRef.current || 0)) {
      totalDurationRef.current = measured
      setDuration(measured)
    }
  }

  const effectiveDuration = duration > 2 && duration >= currentTime - 1 ? duration : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={media.title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black"
        onMouseMove={scheduleHideControls}
      >
        <video
          ref={videoRef}
          className={`h-full w-full object-contain ${
            subtitleSize === 'sm'
              ? '[&::cue]:text-sm'
              : subtitleSize === 'lg'
                ? '[&::cue]:text-2xl'
                : '[&::cue]:text-lg'
          }`}
          src={playbackUrl}
          autoPlay
          playsInline
          onClick={() => {
            if (trackMenuOpen) {
              setTrackMenuOpen(false)
              return
            }
            if (episodesMenuOpen) {
              setEpisodesMenuOpen(false)
              return
            }
            const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
            if (isTouch || !controlsVisible) {
              setControlsVisible((prev) => {
                const next = !prev
                if (next) scheduleHideControls()
                return next
              })
              return
            }
            togglePlay()
          }}
          onDoubleClick={toggleFullscreen}
          onTouchEnd={(event) => {
            const touch = event.changedTouches[0]
            if (!touch) return
            const now = Date.now()
            const prev = lastTouchTapRef.current
            if (prev && now - prev.at < 300 && Math.abs(touch.clientX - prev.x) < 80) {
              const width = event.currentTarget.clientWidth || window.innerWidth
              const ratio = touch.clientX / width
              if (ratio < 0.35) {
                seekBy(-10)
                setSeekToast('« 10s')
                window.setTimeout(() => setSeekToast(''), 700)
              } else if (ratio > 0.65) {
                seekBy(10)
                setSeekToast('10s »')
                window.setTimeout(() => setSeekToast(''), 700)
              }
              lastTouchTapRef.current = null
            } else {
              lastTouchTapRef.current = { at: now, x: touch.clientX }
            }
          }}
          onWaiting={() => setIsLoadingMedia(true)}
          onCanPlay={() => setIsLoadingMedia(false)}
          onPlaying={() => setIsLoadingMedia(false)}
          onPlay={() => {
            setIsLoadingMedia(false)
            setIsPaused(false)
            setShowPausedInfo(false)
            if (pauseOverlayTimer.current) window.clearTimeout(pauseOverlayTimer.current)
            scheduleHideControls()
          }}
          onPause={() => {
            setIsPaused(true)
            setControlsVisible(true)
            saveProgress(true)
            if (pauseOverlayTimer.current) window.clearTimeout(pauseOverlayTimer.current)
            pauseOverlayTimer.current = window.setTimeout(() => setShowPausedInfo(true), 2200)
          }}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              videoRef.current.playbackRate = playbackRate
              if (volume !== 1 || muted) {
                applyVolume(volume, muted)
              }
              syncMeasuredDuration(videoRef.current)
            }
            if (pendingPosition.current !== null && videoRef.current) {
              if (!playbackUrl.includes('/transcode')) {
                videoRef.current.currentTime = pendingPosition.current
              }
              pendingPosition.current = null
              void videoRef.current.play().catch(() => undefined)
            }
          }}
          onDurationChange={() => {
            if (videoRef.current) {
              syncMeasuredDuration(videoRef.current)
            }
          }}
          onTimeUpdate={() => {
            if (videoRef.current) {
              setCurrentTime(transcodeOffsetRef.current + videoRef.current.currentTime)
              syncMeasuredDuration(videoRef.current)
            }
            saveProgress()
          }}
          onEnded={() => {
            saveProgress()
            if (media.nextEpisode && onPlayNext) {
              setNextCountdown(5)
            }
          }}
          onError={() => {
            if (!playbackUrl.includes('/transcode') && media.mediaId && capabilities?.transcoding !== false) {
              const offset = Math.floor(transcodeOffsetRef.current + (videoRef.current?.currentTime ?? 0))
              transcodeOffsetRef.current = offset
              setTranscodeOffset(offset)
              setPlaybackUrl(buildTranscodeUrl(audioStream, offset))
              return
            }
            setIsLoadingMedia(false)
            setPlaybackError('Não foi possível reproduzir este arquivo no navegador. Verifique se a fonte está online ou se o FFmpeg está disponível.')
          }}
        >
          {selectedSubtitleUrl && !secondarySubtitleUrl && (
            <track kind="subtitles" label="Legenda" src={selectedSubtitleUrl} default />
          )}
        </video>

        {secondarySubtitleUrl && (() => {
          const syncTime = currentTime + subtitleOffsetSec
          const primaryText = selectedSubtitleUrl ? findActiveCueText(primaryCues, syncTime) : ''
          const studyText = findActiveCueText(secondaryCues, syncTime)
          if (!primaryText && !studyText) return null
          const studyColorClass =
            dualSubColor === 'cyan'
              ? 'text-cyan-200'
              : dualSubColor === 'white'
                ? 'text-white/90'
                : 'text-amber-200'
          const largerSizeClass =
            subtitleSize === 'lg'
              ? 'text-xl sm:text-3xl'
              : subtitleSize === 'sm'
                ? 'text-base sm:text-lg'
                : 'text-lg sm:text-2xl'
          const smallerSizeClass =
            subtitleSize === 'lg'
              ? 'text-sm sm:text-lg'
              : subtitleSize === 'sm'
                ? 'text-xs sm:text-sm'
                : 'text-xs sm:text-base'
          return (
            <div
              aria-live="off"
              className={`pointer-events-none absolute inset-x-4 z-15 flex flex-col items-center gap-1.5 text-center transition-all ${
                controlsVisible || isPaused ? 'bottom-28' : 'bottom-8'
              }`}
            >
              {dualSubLayout === 'native-larger' ? (
                <>
                  {studyText && (
                    <span
                      className={`max-w-3xl whitespace-pre-line rounded bg-black/65 px-3 py-1 font-medium drop-shadow ${smallerSizeClass} ${studyColorClass}`}
                    >
                      {studyText}
                    </span>
                  )}
                  {primaryText && (
                    <span
                      className={`max-w-3xl whitespace-pre-line rounded bg-black/75 px-3.5 py-1 font-bold text-white drop-shadow ${largerSizeClass}`}
                    >
                      {primaryText}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {primaryText && (
                    <span
                      className={`max-w-3xl whitespace-pre-line rounded bg-black/65 px-3 py-1 font-medium text-white/90 drop-shadow ${smallerSizeClass}`}
                    >
                      {primaryText}
                    </span>
                  )}
                  {studyText && (
                    <span
                      className={`max-w-3xl whitespace-pre-line rounded bg-black/75 px-3.5 py-1 font-bold drop-shadow ${largerSizeClass} ${studyColorClass}`}
                    >
                      {studyText}
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {isLoadingMedia && !playbackError && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-xs">
            <SavanoLoader label="Preparando reprodução..." />
          </div>
        )}

        {seekToast && (
          <div className="pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-5 py-2 text-sm font-bold text-white backdrop-blur-md">
            {seekToast}
          </div>
        )}

        {playbackError && (
          <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-6 text-center">
            <div className="max-w-md rounded-[var(--sc-radius-lg)] border border-red-500/40 bg-[#14151e] p-6 shadow-2xl">
              <p className="m-0 text-sm font-semibold text-white">Falha na reprodução</p>
              <p className="mt-2 mb-4 text-xs text-[var(--sc-text-secondary)]">{playbackError}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 cursor-pointer"
              >
                Voltar ao catálogo
              </button>
            </div>
          </div>
        )}

        {/* Top Bar Overlay */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent p-5 transition-opacity duration-200 ${
            controlsVisible || isPaused ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="pointer-events-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md hover:bg-white/20"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="m-0 text-[10px] font-bold uppercase tracking-widest text-[var(--sc-accent)]">
                Reproduzindo
              </p>
              <h2 className="m-0 text-base font-bold text-white sm:text-lg">{media.title}</h2>
              {torrentStats && (
                <p className="mt-0.5 mb-0 text-[11px] font-medium text-emerald-300">
                  Torrent · {torrentStats.numPeers} peer(s) · {Math.round(torrentStats.downloadSpeed / 1024)} KB/s · {Math.round(torrentStats.progress * 100)}%
                </p>
              )}
              {downloadToast && (
                <p className="mt-0.5 mb-0 text-[11px] font-medium text-emerald-300">{downloadToast}</p>
              )}
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            {isOnlineStream && (
              <a
                href={media.url}
                download={`${media.title || 'video'}.mp4`}
                target={media.url.startsWith('http') ? '_blank' : undefined}
                rel={media.url.startsWith('http') ? 'noreferrer' : undefined}
                title="Baixar este vídeo neste dispositivo"
                className="flex h-10 items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/20"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Baixar</span>
              </a>
            )}
            {isAdmin && isOnlineStream && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const isTorrent = media.url.startsWith('/api/addons/torrent-stream')
                    if (isTorrent) {
                      const qs = media.url.split('?')[1] || ''
                      const infoHash = new URLSearchParams(qs).get('infoHash') || ''
                      if (!infoHash) return
                      setDownloadToast('Enviando para downloads...')
                      const res = await fetch('/api/addons/download-local', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ infoHash, title: media.title }),
                      })
                      const data = await res.json().catch(() => null)
                      setDownloadToast(
                        res.ok
                          ? data?.status === 'qbittorrent'
                            ? 'Enviado para o qBittorrent!'
                            : 'Download salvo na fila!'
                          : data?.error || 'Falha ao iniciar download.',
                      )
                    } else {
                      setDownloadToast('Adicionando à fila de download...')
                      const res = await fetch('/api/addons/download-local', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: media.url, title: media.title }),
                      })
                      const data = await res.json().catch(() => null)
                      setDownloadToast(res.ok ? 'Download iniciado no servidor!' : data?.error || 'Falha ao baixar.')
                    }
                  } catch {
                    setDownloadToast('Falha ao conectar com a API de downloads.')
                  }
                }}
                title="Baixar este título para assistir offline no Acervo Local"
                className="flex h-10 items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/20 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Baixar pro Acervo</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (episodesMenuOpen) {
                  setEpisodesMenuOpen(false)
                } else if (trackMenuOpen) {
                  setTrackMenuOpen(false)
                } else if (showPausedInfo) {
                  setShowPausedInfo(false)
                } else {
                  setControlsVisible(false)
                }
              }}
              aria-label="Ocultar informações do player"
              title="Ocultar informações do player"
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bottom Custom Netflix-style Control Bar */}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-6 pt-10 pb-5 transition-opacity duration-200 ${
            controlsVisible || isPaused || trackMenuOpen ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Scrubber Timeline */}
          <div className="pointer-events-auto flex items-center gap-3">
            <span className="w-12 text-right text-xs font-medium tabular-nums text-white/85">
              {formatClock(currentTime)}
            </span>
            <div
              className="relative flex flex-1 items-center"
              onMouseMove={(event) => {
                if (!duration || duration <= 0) return
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
                const seconds = Math.round(ratio * duration)
                const bucket = Math.floor(seconds / 5) * 5
                const percent = Math.max(6, Math.min(94, ratio * 100))
                if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
                setHoverPreview((prev) => ({
                  seconds,
                  percent,
                  bucket: prev?.bucket ?? bucket,
                  imgOk: prev?.imgOk ?? true,
                }))
                hoverTimerRef.current = window.setTimeout(() => {
                  setHoverPreview((prev) => (prev ? { ...prev, bucket, imgOk: true } : null))
                }, 110)
              }}
              onMouseLeave={() => {
                if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
                setHoverPreview(null)
              }}
            >
              {hoverPreview && (
                <div
                  className="pointer-events-none absolute bottom-6 z-30 flex -translate-x-1/2 flex-col items-center gap-1 rounded-lg border border-white/20 bg-black/90 p-1.5 shadow-2xl"
                  style={{ left: `${hoverPreview.percent}%` }}
                >
                  {media.mediaId && hoverPreview.imgOk && (
                    <img
                      src={`/api/media/${encodeURIComponent(media.mediaId)}/thumbnail?t=${hoverPreview.bucket}`}
                      alt=""
                      className="h-20 w-36 rounded object-cover"
                      onError={() => setHoverPreview((prev) => (prev ? { ...prev, imgOk: false } : null))}
                    />
                  )}
                  <span className="text-[11px] font-semibold tabular-nums text-white">
                    {formatClock(hoverPreview.seconds)}
                  </span>
                </div>
              )}
              <input
                type="range"
                aria-label="Progresso do vídeo"
                min={0}
                max={effectiveDuration || Math.max(currentTime + 60, 100)}
                step={1}
                value={Math.min(currentTime, effectiveDuration || Math.max(currentTime + 60, 100))}
                onChange={(event) => {
                  seekTo(Number(event.target.value))
                }}
                className="h-1.5 w-full accent-[var(--sc-accent)]"
              />
            </div>
            <span className="w-12 text-xs font-medium tabular-nums text-white/65">
              {effectiveDuration > 0 ? formatClock(effectiveDuration) : '--:--'}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap sm:gap-4">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={togglePlay}
                title={isPaused ? 'Retomar (Espaço)' : 'Pausar (Espaço)'}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-950 transition hover:bg-white/90"
              >
                {isPaused ? <Play className="ml-0.5 h-5 w-5 fill-current" /> : <Pause className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={() => seekBy(-10)}
                title="Voltar 10s"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => seekBy(10)}
                title="Avançar 10s"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
              >
                <RotateCw className="h-4 w-4" />
              </button>

              <div className="ml-2 hidden items-center gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => {
                    const nextMuted = !muted
                    setMuted(nextMuted)
                    applyVolume(volume, nextMuted)
                  }}
                  title={muted ? 'Ativar som' : 'Silenciar'}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
                >
                  {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  aria-label="Volume"
                  min={0}
                  max={3}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const nextVol = Number(event.target.value)
                    setVolume(nextVol)
                    const nextMuted = nextVol === 0
                    setMuted(nextMuted)
                    applyVolume(nextVol, nextMuted)
                  }}
                  className="h-1 w-24 accent-white"
                />
                <span
                  className={`min-w-[3.1rem] text-[11px] font-semibold tabular-nums ${
                    !muted && volume > 1 ? 'text-[var(--sc-accent)]' : 'text-white/75'
                  }`}
                >
                  {muted ? '0%' : `${Math.round(volume * 100)}%`}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  const speeds = [0.75, 1, 1.25, 1.5, 2]
                  const idx = speeds.indexOf(playbackRate)
                  setPlaybackRate(speeds[(idx + 1) % speeds.length])
                }}
                title="Velocidade de reprodução"
                className="flex h-9 items-center justify-center rounded-full border border-white/15 bg-white/10 px-3 text-xs font-semibold tabular-nums text-white hover:bg-white/20"
              >
                {playbackRate}x
              </button>
              {media.nextEpisode && onPlayNext && (
                <button
                  type="button"
                  onClick={() => onPlayNext(media.nextEpisode!)}
                  title="Próximo episódio"
                  aria-label="Próximo episódio"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              )}
              {media.showSeasons && media.showSeasons.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTrackMenuOpen(false)
                    setEpisodesMenuOpen((value) => !value)
                  }}
                  title="Episódios"
                  aria-label="Episódios"
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-white transition ${
                    episodesMenuOpen
                      ? 'border-white bg-white/25'
                      : 'border-white/15 bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <ListVideo className="h-4 w-4" />
                </button>
              )}
              {media.alternativeSources && media.alternativeSources.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setTrackMenuOpen(false)
                    setEpisodesMenuOpen(false)
                    setSourcesMenuOpen((value) => !value)
                  }}
                  title="Trocar fonte de reprodução mantendo o ponto atual"
                  aria-label="Trocar fonte"
                  className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-white transition cursor-pointer ${
                    sourcesMenuOpen
                      ? 'border-[var(--sc-accent)] bg-[var(--sc-accent)]/25'
                      : 'border-white/15 bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <Layers className="h-4 w-4 text-[var(--sc-accent)]" />
                  <span className="hidden sm:inline">Fontes ({media.alternativeSources.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setEpisodesMenuOpen(false)
                  setSourcesMenuOpen(false)
                  setTrackMenuOpen((value) => !value)
                }}
                title="Idioma e legendas"
                aria-label="Idioma e legendas"
                className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 sm:px-3.5"
              >
                <Subtitles className="h-4 w-4" />
                <span className="hidden sm:inline">Idioma e legendas</span>
              </button>
              {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current
                    if (!video) return
                    if (document.pictureInPictureElement) {
                      void document.exitPictureInPicture().catch(() => undefined)
                    } else {
                      void video.requestPictureInPicture().catch(() => undefined)
                    }
                  }}
                  title="Modo Picture-in-Picture (janela flutuante)"
                  aria-label="Modo Picture-in-Picture (janela flutuante)"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
                >
                  <PictureInPicture2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                title="Tela cheia (F)"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Netflix-style Episode Selector Drawer */}
        {episodesMenuOpen && (
          <PlayerEpisodesDrawer
            media={media}
            selectedSeason={selectedEpisodeSeason}
            hoveredEpisodeId={hoveredEpisodeId}
            onSelectSeason={setSelectedEpisodeSeason}
            onHoverEpisode={setHoveredEpisodeId}
            onClose={() => setEpisodesMenuOpen(false)}
            onPlayNext={onPlayNext}
          />
        )}

        {/* Netflix-style Paused Overlay */}
        {showPausedInfo && isPaused && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center bg-gradient-to-r from-black/85 via-black/45 to-transparent p-10">
            <div className="max-w-xl">
              <p className="m-0 text-xs font-bold uppercase tracking-widest text-[var(--sc-text-secondary)]">
                Você está assistindo a
              </p>
              <h3 className="mt-2 mb-0 text-3xl font-black text-white sm:text-4xl">
                {media.title}
              </h3>
              {media.year && (
                <p className="mt-2 mb-0 text-sm font-semibold text-[var(--sc-text-secondary)]">
                  {media.year}
                </p>
              )}
              {media.overview && (
                <p className="mt-3 mb-0 line-clamp-4 text-sm leading-relaxed text-white/80">
                  {media.overview}
                </p>
              )}
              <span className="mt-5 inline-block rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                Pausado
              </span>
            </div>
          </div>
        )}

        {/* Netflix-style Next Episode Countdown */}
        {nextCountdown !== null && media.nextEpisode && onPlayNext && (
          <div className="absolute right-8 bottom-20 z-30 flex max-w-sm flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-white/20 bg-[#14161f]/95 p-5 shadow-2xl backdrop-blur-xl">
            <p className="m-0 text-[11px] font-bold uppercase tracking-widest text-[var(--sc-accent)]">
              Próximo episódio em {nextCountdown}s
            </p>
            <strong className="text-sm text-white">{media.nextEpisode.title}</strong>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onPlayNext(media.nextEpisode!)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--sc-radius-sm)] bg-white px-3 py-2 text-xs font-bold text-neutral-950 hover:bg-white/90"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Assistir agora
              </button>
              <button
                type="button"
                onClick={() => setNextCountdown(null)}
                className="rounded-[var(--sc-radius-sm)] border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Quick In-Player Source Switcher */}
        {sourcesMenuOpen && media.alternativeSources && media.alternativeSources.length > 1 && (
          <div className="pointer-events-auto absolute right-6 bottom-20 z-30 w-96 max-w-[calc(100vw-2rem)] rounded-[var(--sc-radius-lg)] border border-white/15 bg-[#11131b]/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h4 className="m-0 text-sm font-bold text-white">Trocar Fonte</h4>
                <p className="m-0 text-[11px] text-white/60">Mantém a posição atual ({formatClock(currentTime)})</p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesMenuOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {media.alternativeSources.map((src) => {
                const isActive = playbackUrl === src.url
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => {
                      if (!isActive) switchPlaybackSource(src.url)
                    }}
                    className={`flex w-full flex-col gap-1 rounded-[var(--sc-radius-md)] border p-2.5 text-left transition cursor-pointer ${
                      isActive
                        ? 'border-[var(--sc-accent)] bg-[var(--sc-accent)]/20'
                        : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="truncate text-xs font-semibold text-white">{src.label}</span>
                      {isActive && (
                        <span className="rounded-full bg-[var(--sc-accent)] px-2 py-0.5 text-[10px] font-bold text-[#090a0d]">
                          Em uso
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {src.badges?.map((b) => (
                        <LanguageFlagBadge key={`${src.id}-${b}`} label={b} />
                      ))}
                      {typeof src.seeders === 'number' && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          {src.seeders} seeds
                        </span>
                      )}
                      {src.sizeLabel && (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/75">
                          {src.sizeLabel}
                        </span>
                      )}
                    </div>
                    {src.detail && <p className="m-0 line-clamp-1 text-[11px] text-white/60">{src.detail}</p>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Netflix-style Two-Column Idioma | Legendas Popover */}
        {trackMenuOpen && (
          <PlayerTrackMenu
            audioTracks={streamInfo?.audio ?? []}
            embeddedSubtitles={streamInfo?.subtitles ?? []}
            subtitleTracks={subtitleTracks}
            audioStream={audioStream}
            subtitleStream={subtitleStream}
            selectedSubtitleUrl={selectedSubtitleUrl}
            secondarySubtitleUrl={secondarySubtitleUrl}
            dualSubLayout={dualSubLayout}
            dualSubColor={dualSubColor}
            loadingAddonSubs={loadingAddonSubs}
            addonSubsNotice={addonSubsNotice}
            subtitleOffsetSec={subtitleOffsetSec}
            subtitleSize={subtitleSize}
            onChangeAudio={changeAudioStream}
            onChangeEmbeddedSubtitle={changeSubtitleStream}
            onSelectExternalSubtitle={setSelectedSubtitleUrl}
            onSelectSecondarySubtitle={setSecondarySubtitleUrl}
            onChangeDualSubLayout={(layout) => {
              setDualSubLayout(layout)
              try {
                localStorage.setItem('sc_dual_sub_layout', layout)
              } catch {
                // ignore
              }
            }}
            onChangeDualSubColor={(color) => {
              setDualSubColor(color)
              try {
                localStorage.setItem('sc_dual_sub_color', color)
              } catch {
                // ignore
              }
            }}
            onFetchAddonSubtitles={() => void fetchAddonSubtitlesInPlayer()}
            onAdjustSubtitleOffset={adjustSubtitleOffset}
            onChangeSubtitleSize={setSubtitleSize}
          />
        )}
      </div>
    </div>
  )
}
