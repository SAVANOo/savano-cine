import Hls from 'hls.js'
import { ArrowLeft, Check, ListVideo, Maximize2, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipForward, Subtitles, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayableMedia } from '../../domain/uiHelpers'

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
export function VideoPlayer({ media, profileId, capabilities, onPlayNext, onClose }: VideoPlayerProps) {
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
  const [loadingAddonSubs, setLoadingAddonSubs] = useState(false)
  const [addonSubsNotice, setAddonSubsNotice] = useState('')
  const [torrentStats, setTorrentStats] = useState<{ numPeers: number; downloadSpeed: number; progress: number } | null>(null)
  const [seekToast, setSeekToast] = useState<string>('')
  const lastTouchTapRef = useRef<{ at: number; x: number } | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [episodesMenuOpen, setEpisodesMenuOpen] = useState(false)
  const [hoveredEpisodeId, setHoveredEpisodeId] = useState<string | null>(null)
  const [selectedEpisodeSeason, setSelectedEpisodeSeason] = useState<number>(() => {
    for (const s of media.showSeasons ?? []) {
      if (s.episodes.some((ep) => ep.mediaId === media.mediaId)) return s.number
    }
    return media.showSeasons?.[0]?.number ?? 1
  })
  const [isPaused, setIsPaused] = useState(false)
  const [showPausedInfo, setShowPausedInfo] = useState(false)
  const [nextCountdown, setNextCountdown] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(initialTranscode ? initialStart : 0)
  const [duration, setDuration] = useState(0)
  const [, setTranscodeOffset] = useState(initialTranscode ? initialStart : 0)
  const transcodeOffsetRef = useRef(initialTranscode ? initialStart : 0)
  const totalDurationRef = useRef(0)
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
      const mapped = found.slice(0, 12).map((s: { lang?: string; addonName?: string; url: string }) => ({
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
  }, [media.mediaId, media.title, media.url, profileId])

  useEffect(() => () => saveProgress(true), [saveProgress])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playbackUrl.includes('.m3u8')) return
    if (!Hls.isSupported()) return
    const hls = new Hls()
    hls.loadSource(playbackUrl)
    hls.attachMedia(video)
    return () => {
      hls.destroy()
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
          onPlay={() => {
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
            }
            if (videoRef.current && !playbackUrl.includes('/transcode') && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
              totalDurationRef.current = videoRef.current.duration
              setDuration(videoRef.current.duration)
            }
            if (pendingPosition.current !== null && videoRef.current) {
              if (!playbackUrl.includes('/transcode')) {
                videoRef.current.currentTime = pendingPosition.current
              }
              pendingPosition.current = null
              void videoRef.current.play().catch(() => undefined)
            }
          }}
          onTimeUpdate={() => {
            if (videoRef.current) {
              setCurrentTime(transcodeOffsetRef.current + videoRef.current.currentTime)
              if (!totalDurationRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
                totalDurationRef.current = videoRef.current.duration
                setDuration(videoRef.current.duration)
              }
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
            setPlaybackError('Não foi possível reproduzir este arquivo no navegador. Verifique se a fonte está online ou se o FFmpeg está disponível.')
          }}
        >
          {selectedSubtitleUrl && (
            <track kind="subtitles" label="Legenda" src={selectedSubtitleUrl} default />
          )}
        </video>

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
            </div>
          </div>

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
                max={duration || 100}
                step={1}
                value={Math.min(currentTime, duration || 100)}
                onChange={(event) => {
                  seekTo(Number(event.target.value))
                }}
                className="h-1.5 w-full accent-[var(--sc-accent)]"
              />
            </div>
            <span className="w-12 text-xs font-medium tabular-nums text-white/65">
              {formatClock(duration)}
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
              <button
                type="button"
                onClick={() => {
                  setEpisodesMenuOpen(false)
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
        {episodesMenuOpen && media.showSeasons && media.showSeasons.length > 0 && (
          <div className="pointer-events-auto absolute right-6 bottom-24 z-30 flex max-h-[65vh] w-[min(92vw,440px)] flex-col overflow-hidden rounded-[var(--sc-radius-lg)] border border-white/15 bg-[#14151e]/96 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <strong className="truncate text-sm font-bold text-white">
                {media.showTitle || 'Episódios'}
              </strong>
              {media.showSeasons.length > 1 && (
                <select
                  aria-label="Selecionar temporada"
                  value={selectedEpisodeSeason}
                  onChange={(event) => setSelectedEpisodeSeason(Number(event.target.value))}
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
              {(media.showSeasons.find((s) => s.number === selectedEpisodeSeason) ?? media.showSeasons[0]).episodes.map(
                (ep) => {
                  const isCurrent = ep.mediaId === media.mediaId
                  const isExpanded = isCurrent || hoveredEpisodeId === ep.id
                  const epProgress = Math.max(0, Math.min(100, ep.progress ?? 0))
                  const flatEpisodes = (media.showSeasons ?? []).flatMap((s) =>
                    s.episodes.filter((item) => Boolean(item.mediaUrl)),
                  )
                  const epIdx = flatEpisodes.findIndex((item) => item.mediaId === ep.mediaId)
                  const nextAfterEp =
                    epIdx >= 0 && epIdx + 1 < flatEpisodes.length ? flatEpisodes[epIdx + 1] : undefined
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onMouseEnter={() => setHoveredEpisodeId(ep.id)}
                      onMouseLeave={() => setHoveredEpisodeId(null)}
                      onClick={() => {
                        if (!ep.mediaUrl || !onPlayNext) return
                        setEpisodesMenuOpen(false)
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
                },
              )}
            </div>
          </div>
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

        {/* Netflix-style Two-Column Idioma | Legendas Popover */}
        {trackMenuOpen && (
          <div className="absolute right-6 bottom-24 z-30 grid w-[min(92vw,440px)] grid-cols-2 gap-4 rounded-[var(--sc-radius-lg)] border border-white/15 bg-[#14161f]/95 p-5 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col gap-1.5 border-r border-white/10 pr-3">
              <h4 className="m-0 mb-1 text-xs font-bold uppercase tracking-wider text-white">
                Idioma
              </h4>
              <button
                type="button"
                onClick={() => changeAudioStream('')}
                className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                  !audioStream ? 'bg-white/15 font-semibold text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
                }`}
              >
                <span>Original</span>
                {!audioStream && <Check className="h-3.5 w-3.5" />}
              </button>
              {streamInfo?.audio.map((track) => {
                const key = String(track.index)
                const active = audioStream === key
                return (
                  <button
                    key={track.index}
                    type="button"
                    onClick={() => changeAudioStream(key)}
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
                  setSelectedSubtitleUrl('')
                  changeSubtitleStream('')
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
              {subtitleTracks.map((track) => {
                const active = selectedSubtitleUrl === track.url
                return (
                  <button
                    key={track.url}
                    type="button"
                    onClick={() => {
                      setSubtitleStream('')
                      setSelectedSubtitleUrl(track.url)
                    }}
                    className={`flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                      active ? 'bg-white/15 font-semibold text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8'
                    }`}
                  >
                    <span className="truncate">{track.label}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
              {streamInfo?.subtitles.map((track) => {
                const key = String(track.index)
                const active = subtitleStream === key
                return (
                  <button
                    key={track.index}
                    type="button"
                    onClick={() => changeSubtitleStream(key)}
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
                  onClick={() => void fetchAddonSubtitlesInPlayer()}
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
                      onClick={() => adjustSubtitleOffset(-0.5)}
                      className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustSubtitleOffset(0)}
                      className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-white/20"
                    >
                      0s
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustSubtitleOffset(0.5)}
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
                        onClick={() => setSubtitleSize(sz)}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          subtitleSize === sz ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        {sz === 'sm' ? 'P' : sz === 'md' ? 'M' : 'G'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
