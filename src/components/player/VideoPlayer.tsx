import { ArrowLeft, Check, Maximize2, Pause, Play, RotateCcw, RotateCw, Subtitles, Volume2, VolumeX, X } from 'lucide-react'
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

/** Netflix-style immersive player with auto-hiding overlays, paused screen, and Idioma | Legendas popover. */
export function VideoPlayer({ media, profileId, capabilities, onPlayNext, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastSavedPosition = useRef(0)
  const pendingPosition = useRef<number | null>(media.startPosition ?? null)
  const hideTimer = useRef<number | null>(null)
  const pauseOverlayTimer = useRef<number | null>(null)

  const [playbackUrl, setPlaybackUrl] = useState(media.url)
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ label: string; url: string }>>([])
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null)
  const [audioStream, setAudioStream] = useState('')
  const [subtitleStream, setSubtitleStream] = useState('')
  const [selectedSubtitleUrl, setSelectedSubtitleUrl] = useState('')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [showPausedInfo, setShowPausedInfo] = useState(false)
  const [nextCountdown, setNextCountdown] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [, setTranscodeOffset] = useState(0)
  const transcodeOffsetRef = useRef(0)
  const totalDurationRef = useRef(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  const scheduleHideControls = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    setControlsVisible(true)
    hideTimer.current = window.setTimeout(() => {
      if (!trackMenuOpen && videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
      }
    }, 2800)
  }, [trackMenuOpen])

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    if (pauseOverlayTimer.current) window.clearTimeout(pauseOverlayTimer.current)
  }, [])

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
    if (!video || !media.mediaId) return
    const effectivePos = transcodeOffsetRef.current + video.currentTime
    const effectiveDur = totalDurationRef.current || (Number.isFinite(video.duration) ? video.duration : 0)
    if (!effectiveDur || Number.isNaN(effectiveDur)) return
    if (!force && Math.abs(effectivePos - lastSavedPosition.current) < 5 && effectivePos < effectiveDur - 2) return
    lastSavedPosition.current = effectivePos
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
  }, [media.mediaId, profileId])

  useEffect(() => () => saveProgress(true), [saveProgress])

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
      const startParam = startSec > 1 ? `&start=${Math.floor(startSec)}` : ''
      return `/api/media/${encodeURIComponent(media.mediaId)}/transcode?format=mp4&audioStream=${encodeURIComponent(streamIdx)}${startParam}`
    },
    [media.mediaId, media.url],
  )

  const changeAudioStream = (value: string) => {
    setAudioStream(value)
    const effectivePos = transcodeOffsetRef.current + (videoRef.current?.currentTime ?? 0)
    if (!value) {
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
    if (!audioStream) {
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
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen?.()
  }

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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scheduleHideControls])

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
          className="h-full w-full object-contain"
          src={playbackUrl}
          autoPlay
          playsInline
          onClick={() => {
            if (trackMenuOpen) setTrackMenuOpen(false)
            else togglePlay()
          }}
          onDoubleClick={toggleFullscreen}
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
        >
          {selectedSubtitleUrl && (
            <track kind="subtitles" label="Legenda" src={selectedSubtitleUrl} default />
          )}
        </video>

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
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar player"
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
              className="h-1.5 flex-1 accent-[var(--sc-accent)]"
            />
            <span className="w-12 text-xs font-medium tabular-nums text-white/65">
              {formatClock(duration)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="pointer-events-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
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
                    if (videoRef.current) videoRef.current.muted = nextMuted
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
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const nextVol = Number(event.target.value)
                    setVolume(nextVol)
                    setMuted(nextVol === 0)
                    if (videoRef.current) {
                      videoRef.current.volume = nextVol
                      videoRef.current.muted = nextVol === 0
                    }
                  }}
                  className="h-1 w-20 accent-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTrackMenuOpen((value) => !value)}
                className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white hover:bg-white/20"
              >
                <Subtitles className="h-4 w-4" />
                Idioma e legendas
              </button>
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
