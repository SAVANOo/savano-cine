import { Search } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AddonMetaSummary } from './components/addons/AddonStreamModal'
import { HeroCarousel } from './components/home/HeroCarousel'
import { MediaCarousel } from './components/home/MediaCarousel'
import { Sidebar } from './components/layout/Sidebar'
import { MediaCard } from './components/media/MediaCard'
import type {
  ArtworkCandidateGroup,
  CatalogHistory,
  CatalogRefreshStatus,
} from './components/modals/CatalogModals'
import { PinGate } from './components/profile/PinGate'
import { ProfileGate } from './components/profile/ProfileGate'
import { ProfileModal } from './components/profile/ProfileModal'
import { CatalogSkeleton } from './components/ui/CatalogSkeleton'
import { SavanoLoader } from './components/ui/SavanoLoader'

const AddonDetailView = lazy(() =>
  import('./components/addons/AddonDetailView').then((m) => ({ default: m.AddonDetailView })),
)

const OnlineCatalogView = lazy(() =>
  import('./components/addons/OnlineCatalogView').then((m) => ({ default: m.OnlineCatalogView })),
)
const AdminView = lazy(() =>
  import('./components/admin/AdminView').then((m) => ({ default: m.AdminView })),
)
const ShowDetailView = lazy(() =>
  import('./components/media/ShowDetailView').then((m) => ({ default: m.ShowDetailView })),
)
const VideoPlayer = lazy(() =>
  import('./components/player/VideoPlayer').then((m) => ({ default: m.VideoPlayer })),
)
import {
  library as mockLibrary,
  mediaSources as mockSources,
  profiles as mockProfiles,
} from './data/mockCatalog'
import type { LibraryItem, MediaSource, Profile, ReviewItem } from './domain/catalog'
import { useGamepadNavigation } from './hooks/useGamepadNavigation'
import {
  resolvePlayableMedia,
  translateGenre,
  type PlayableMedia,
} from './domain/uiHelpers'

function readCachedCatalog(profileId: string): LibraryItem[] | null {
  try {
    const raw = sessionStorage.getItem(`sc_catalog_${profileId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

const TODAY_KEY = new Date().toISOString().slice(0, 10)

function getInitialDeepLinkId(): string | null {
  const match = window.location.pathname.match(/^\/(?:series|movies)\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function App() {
  const [activeKind, setActiveKind] = useState<'Todos' | 'Local' | 'Online' | 'Filme' | 'Série' | 'Continuar'>('Todos')
  const [activeGenre, setActiveGenre] = useState('Todos')
  const [sortOrder, setSortOrder] = useState<'default' | 'az' | 'year-desc'>('default')
  const [unwatchedOnly, setUnwatchedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [catalogNotice, setCatalogNotice] = useState('')
  const [addonSearchResults, setAddonSearchResults] = useState<
    Array<{ id: string; type: string; name: string; poster: string | null; releaseInfo: string | null; description?: string; addonName: string }>
  >([])
  const [addonSearching, setAddonSearching] = useState(false)
  const [homeTrendingOnline, setHomeTrendingOnline] = useState<
    Array<{ id: string; type: string; name: string; poster: string | null; releaseInfo: string | null; description?: string; addonName: string }>
  >([])
  const [onlineContinueItems, setOnlineContinueItems] = useState<
    Array<{
      contentKey: string
      title: string
      type: string
      poster: string | null
      season: number | null
      episode: number | null
      positionSec: number
      durationSec: number
      updatedAt: string
    }>
  >([])
  const [activeAddonItem, setActiveAddonItem] = useState<AddonMetaSummary | null>(null)
  const [selectedShowId, setSelectedShowId] = useState<string | null>(() => getInitialDeepLinkId())
  const [adminOpen, setAdminOpen] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'server',
  )
  const [adminTab, setAdminTab] = useState<'review' | 'artwork' | 'history' | 'logs' | 'addons' | 'server'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'server'
      ? 'server'
      : 'review',
  )

  const getProfileSessionCookie = () => {
    if (typeof document === 'undefined') return ''
    const match = document.cookie.match(/(?:^|;\s*)sc_profile_session=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  const setProfileSessionCookie = (profileId: string) => {
    if (typeof document === 'undefined') return
    document.cookie = `sc_profile_session=${encodeURIComponent(profileId)}; Max-Age=86400; Path=/; SameSite=Lax`
  }

  const initialCookieProfile = getProfileSessionCookie()
  const [theme, setTheme] = useState<'dark' | 'light' | 'momolada'>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sc_theme') : null
    return saved === 'light' || saved === 'momolada' ? saved : 'dark'
  })
  const [pinLocked, setPinLocked] = useState(false)
  const [profileGateOpen, setProfileGateOpen] = useState(() => !initialCookieProfile)
  const [pendingUnlockProfile, setPendingUnlockProfile] = useState<Profile | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlockedProfiles, setUnlockedProfiles] = useState<Set<string>>(() => new Set())
  const [activeProfileId, setActiveProfileId] = useState(() => initialCookieProfile || 'profile-savio')
  const [catalog, setCatalog] = useState<LibraryItem[]>(
    () => readCachedCatalog(initialCookieProfile || 'profile-savio') ?? mockLibrary,
  )
  const [catalogLoading, setCatalogLoading] = useState(
    () => !readCachedCatalog(initialCookieProfile || 'profile-savio'),
  )
  const [sources, setSources] = useState<MediaSource[]>(mockSources)
  const [sourcesError, setSourcesError] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>(mockProfiles)
  const [profileFading, setProfileFading] = useState(false)

  const [selectedMedia, setSelectedMedia] = useState<PlayableMedia | null>(null)
  const [playerCapabilities, setPlayerCapabilities] = useState<{
    ffmpeg: boolean
    transcoding?: boolean
    ffprobe: boolean
    vlc: boolean
  } | null>(null)

  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [reviewError, setReviewError] = useState('')
  const [artworkCandidates, setArtworkCandidates] = useState<ArtworkCandidateGroup[]>([])
  const [artworkCandidatesError, setArtworkCandidatesError] = useState('')
  const [catalogHistory, setCatalogHistory] = useState<CatalogHistory>({
    archived: [],
    titleChanges: [],
  })
  const [catalogRefresh, setCatalogRefresh] = useState<CatalogRefreshStatus>({
    state: 'idle',
    sourceIds: [],
    results: [],
  })
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Profile | undefined>(undefined)
  const lastRefreshState = useRef(catalogRefresh.state)

  const selectedShow = useMemo(
    () => (selectedShowId ? catalog.find((item) => item.id === selectedShowId || item.mediaId === selectedShowId) ?? null : null),
    [catalog, selectedShowId],
  )

  const setSelectedShow = useCallback((item: LibraryItem | null) => {
    setSelectedShowId(item?.id ?? null)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('sc_theme', theme)
    } catch {
      // ignore storage quota errors
    }
  }, [theme])

  const completeProfileSwitch = useCallback(
    (nextId: string) => {
      setProfileSessionCookie(nextId)
      setProfileGateOpen(false)
      if (nextId === activeProfileId) return
      setProfileFading(true)
      const cached = readCachedCatalog(nextId)
      if (cached) {
        setCatalog(cached)
        setCatalogLoading(false)
      } else {
        setCatalogLoading(true)
      }
      setActiveKind('Todos')
      setSelectedShowId(null)
      setActiveAddonItem(null)
      setQuery('')
      setCatalogNotice('')
      setAdminOpen(false)
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/')
      }
      setActiveProfileId(nextId)
      window.setTimeout(() => setProfileFading(false), 550)
    },
    [activeProfileId],
  )

  const handleProfileChange = useCallback(
    (nextId: string) => {
      const target = profiles.find((p) => p.id === nextId)
      if (target?.hasPassword && !unlockedProfiles.has(nextId)) {
        setPendingUnlockProfile(target)
        setUnlockPassword('')
        setUnlockError('')
        return
      }
      completeProfileSwitch(nextId)
    },
    [completeProfileSwitch, profiles, unlockedProfiles],
  )

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      if (active) setAddonSearching(true)
      fetch('/api/addons')
        .then((res) => (res.ok ? res.json() : []))
        .then(async (addons: Array<{ id: string; name: string; enabled: boolean; catalogs: Array<{ type: string; id: string }> }>) => {
          const enabledAddons = (addons || []).filter((a) => a.enabled)
          if (enabledAddons.length === 0) {
            if (active) setAddonSearchResults([])
            return
          }
          const catalogAddons = enabledAddons.filter((a) => a.catalogs?.length > 0)
          const lookups = catalogAddons.slice(0, 3).flatMap((addon) =>
            addon.catalogs.slice(0, 2).map((cat) =>
              fetch(
                `/api/addons/${encodeURIComponent(addon.id)}/catalog?type=${encodeURIComponent(cat.type)}&catalogId=${encodeURIComponent(cat.id)}&search=${encodeURIComponent(trimmed)}`,
              )
                .then((r) => (r.ok ? r.json() : null))
                .then((data) =>
                  (data?.metas || []).slice(0, 4).map((meta: { id: string; type: string; name: string; poster: string | null; releaseInfo: string | null; description?: string }) => ({
                    ...meta,
                    addonName: addon.name,
                  })),
                )
                .catch(() => []),
            ),
          )
          const chunks = await Promise.all(lookups)
          if (!active) return
          const seen = new Set<string>()
          let merged = chunks.flat().filter((item) => {
            const key = `${item.type}:${item.id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          if (merged.length === 0) {
            const fallbackRes = await fetch(`/api/addons/search?q=${encodeURIComponent(trimmed)}`).catch(() => null)
            const fallbackData = fallbackRes && fallbackRes.ok ? await fallbackRes.json().catch(() => null) : null
            if (!active) return
            merged = (fallbackData?.metas || []).slice(0, 12).map(
              (meta: { id: string; type: string; name: string; poster: string | null; releaseInfo: string | null; description?: string }) => ({
                ...meta,
                addonName: enabledAddons[0]?.name || 'Addons',
              }),
            )
          }
          if (active) {
            setAddonSearchResults(merged.slice(0, 12))
            setAddonSearching(false)
          }
        })
        .catch(() => {
          if (active) {
            setAddonSearchResults([])
            setAddonSearching(false)
          }
        })
    }, 400)
    return () => {
      active = false
      setAddonSearching(false)
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    fetch('/api/auth/pin')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { required?: boolean; authenticated?: boolean } | null) => {
        if (data?.required && !data.authenticated) {
          setPinLocked(true)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    fetch('/api/player/capabilities')
      .then((res) => (res.ok ? res.json() : null))
      .then(setPlayerCapabilities)
      .catch(() => undefined)
  }, [])

  const refreshReview = useCallback(() => {
    fetch('/api/review')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || 'Não foi possível carregar os itens de revisão.')
        }
        return res.json()
      })
      .then((items) => {
        setReviewItems(items)
        setReviewError('')
      })
      .catch((err: Error) => setReviewError(err.message))
  }, [])

  const refreshHistory = useCallback(() => {
    fetch('/api/catalog/history')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(setCatalogHistory)
      .catch(() => setCatalogHistory({ archived: [], titleChanges: [] }))
  }, [])

  const refreshArtworkCandidates = useCallback(() => {
    fetch('/api/artwork/candidates')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || 'Não foi possível carregar os candidatos de arte.')
        }
        return res.json()
      })
      .then((groups) => {
        setArtworkCandidates(groups)
        setArtworkCandidatesError('')
      })
      .catch((err: Error) => setArtworkCandidatesError(err.message))
  }, [])

  const refreshProfiles = useCallback(() => {
    fetch('/api/profiles')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((items: Profile[]) => {
        if (items.length > 0) setProfiles(items)
      })
      .catch(() => undefined)
  }, [])

  const refreshCatalogAndSources = useCallback(() => {
    fetch(`/api/library?profileId=${encodeURIComponent(activeProfileId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((items: LibraryItem[]) => {
        setCatalog(items)
        try {
          sessionStorage.setItem(`sc_catalog_${activeProfileId}`, JSON.stringify(items))
        } catch {
          // ignore quota exceeded
        }
      })
      .catch(() => undefined)
      .finally(() => setCatalogLoading(false))

    fetch('/api/sources')
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((items) => {
        setSources(items)
        setSourcesError('')
      })
      .catch(() => setSourcesError('API indisponível no momento.'))

    fetch(`/api/addons/progress?profileId=${encodeURIComponent(activeProfileId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((items) => setOnlineContinueItems(Array.isArray(items) ? items : []))
      .catch(() => setOnlineContinueItems([]))

    refreshReview()
    refreshArtworkCandidates()
    refreshHistory()
  }, [activeProfileId, refreshArtworkCandidates, refreshHistory, refreshReview])

  useEffect(() => {
    let active = true
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : []))
      .then(async (addons: Array<{ id: string; name: string; enabled: boolean; catalogs: Array<{ type: string; id: string }> }>) => {
        const catalogAddons = (addons || []).filter((a) => a.enabled && a.catalogs?.length > 0)
        if (catalogAddons.length === 0) return
        const lookups = catalogAddons.slice(0, 2).map((addon) => {
          const cat = addon.catalogs[0]
          return fetch(
            `/api/addons/${encodeURIComponent(addon.id)}/catalog?type=${encodeURIComponent(cat.type)}&catalogId=${encodeURIComponent(cat.id)}`,
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((data) =>
              (data?.metas || []).slice(0, 8).map((meta: { id: string; type: string; name: string; poster: string | null; releaseInfo: string | null; description?: string }) => ({
                ...meta,
                addonName: addon.name,
              })),
            )
            .catch(() => [])
        })
        const chunks = await Promise.all(lookups)
        if (!active) return
        const seen = new Set<string>()
        const merged = chunks.flat().filter((item) => {
          if (!item.poster) return false
          const key = `${item.type}:${item.id}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setHomeTrendingOnline(merged.slice(0, 12))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    refreshProfiles()
    refreshCatalogAndSources()
  }, [refreshCatalogAndSources, refreshProfiles])

  useEffect(() => {
    let active = true
    const poll = () => {
      fetch('/api/catalog/refresh')
        .then((res) => (res.ok ? res.json() : null))
        .then((status: CatalogRefreshStatus | null) => {
          if (active && status) setCatalogRefresh(status)
        })
        .catch(() => undefined)
    }
    poll()
    if (catalogRefresh.state !== 'running') return () => { active = false }
    const timer = window.setInterval(poll, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [catalogRefresh.state])

  useEffect(() => {
    if (lastRefreshState.current === 'running' && catalogRefresh.state !== 'running') {
      refreshCatalogAndSources()
    }
    lastRefreshState.current = catalogRefresh.state
  }, [catalogRefresh.state, refreshCatalogAndSources])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedMedia) setSelectedMedia(null)
        else if (profileEditorOpen) setProfileEditorOpen(false)
        else if (adminOpen) setAdminOpen(false)
        else if (selectedShow) setSelectedShow(null)
      }
      if (
        event.key === '/' &&
        event.target instanceof HTMLElement &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
      ) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('#sc-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adminOpen, profileEditorOpen, selectedMedia, selectedShow, setSelectedShow])

  useEffect(() => {
    if (selectedMedia) document.title = `${selectedMedia.title} · Savano Cine`
    else if (selectedShow) document.title = `${selectedShow.title} · Savano Cine`
    else if (adminOpen) document.title = `${adminTab === 'addons' ? 'Addons' : 'Admin'} · Savano Cine`
    else if (activeKind !== 'Todos') document.title = `${activeKind} · Savano Cine`
    else document.title = 'Savano Cine'
  }, [activeKind, adminOpen, adminTab, selectedMedia, selectedShow])

  const layerDepth =
    (selectedMedia ? 1 : 0) +
    (activeAddonItem ? 1 : 0) +
    (profileEditorOpen ? 1 : 0) +
    (adminOpen ? 1 : 0) +
    (selectedShow ? 1 : 0)
  const prevLayerDepthRef = useRef(0)

  useEffect(() => {
    if (layerDepth > prevLayerDepthRef.current) {
      window.history.pushState({ scLayer: layerDepth }, '')
    }
    prevLayerDepthRef.current = layerDepth
  }, [layerDepth])

  useEffect(() => {
    const onPopState = () => {
      if (selectedMedia) setSelectedMedia(null)
      else if (activeAddonItem) setActiveAddonItem(null)
      else if (profileEditorOpen) setProfileEditorOpen(false)
      else if (adminOpen) setAdminOpen(false)
      else if (selectedShow) setSelectedShow(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [activeAddonItem, adminOpen, profileEditorOpen, selectedMedia, selectedShow, setSelectedShow])

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? mockProfiles[0]

  const connectedGamepad = useGamepadNavigation(Boolean(selectedMedia))

  const playLibraryItem = useCallback((item: LibraryItem) => {
    if (item.sourceStatus === 'offline') {
      setCatalogNotice(
        `A fonte "${item.sourceName || 'HD externo'}" está desconectada no momento. Conecte o dispositivo e clique em Atualizar na barra lateral.`,
      )
      setSelectedShow(item)
      return
    }
    setCatalogNotice('')
    const playable = resolvePlayableMedia(item)
    if (!playable) {
      setSelectedShow(item)
      return
    }
    if (item.kind === 'Filme' && !playable.nextEpisode) {
      const itemGenres = new Set((item.genres ?? []).map((g) => g.toLowerCase()))
      const candidates = catalog.filter(
        (c) => c.id !== item.id && c.kind === 'Filme' && c.sourceStatus !== 'offline' && Boolean(c.mediaUrl),
      )
      const bestNext =
        candidates.find((c) => (c.genres ?? []).some((g) => itemGenres.has(g.toLowerCase())) && (c.progress ?? 0) < 90) ??
        candidates.find((c) => (c.progress ?? 0) < 90) ??
        candidates[0]
      if (bestNext) {
        const nextPlayable = resolvePlayableMedia(bestNext, true)
        if (nextPlayable) playable.nextEpisode = nextPlayable
      }
    }
    setSelectedMedia(playable)
  }, [catalog, setSelectedShow])

  const toggleWatchlist = useCallback(
    async (item: LibraryItem) => {
      const targetType = item.kind === 'Série' ? 'show' : 'movie'
      const nextVal = !item.inWatchlist
      setCatalog((prev) => {
        const updated = prev.map((entry) =>
          entry.id === item.id ? { ...entry, inWatchlist: nextVal } : entry,
        )
        try {
          sessionStorage.setItem(`sc_catalog_${activeProfileId}`, JSON.stringify(updated))
        } catch {
          // ignore
        }
        return updated
      })
      try {
        await fetch('/api/watchlist/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: activeProfileId, targetType, targetId: item.id }),
        })
      } catch {
        // ignore offline fallback
      }
    },
    [activeProfileId],
  )

  const triggerArtworkSearch = useCallback(
    async (item: LibraryItem) => {
      const targetType = item.kind === 'Série' ? 'show' : 'movie'
      const targetId = item.kind === 'Série' ? item.id : item.mediaId || item.id
      try {
        await fetch('/api/artwork/candidates/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetId }),
        })
        refreshArtworkCandidates()
        refreshCatalogAndSources()
      } finally {
        setAdminTab('artwork')
        setAdminOpen(true)
        setSelectedShow(null)
      }
    },
    [refreshArtworkCandidates, refreshCatalogAndSources, setSelectedShow],
  )

  const genreOptions = useMemo(() => {
    const set = new Set<string>()
    for (const item of catalog) {
      for (const genre of item.genres ?? []) set.add(genre)
    }
    return Array.from(set).sort((a, b) => translateGenre(a).localeCompare(translateGenre(b), 'pt-BR'))
  }, [catalog])

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const list = catalog.filter((item) => {
      if (activeKind === 'Continuar') {
        if (!item.resume && (item.progress ?? 0) <= 0) return false
      } else if (activeKind !== 'Todos' && activeKind !== 'Local' && item.kind !== activeKind) {
        return false
      }
      if (activeGenre !== 'Todos' && !(item.genres ?? []).includes(activeGenre)) return false
      if (unwatchedOnly && (item.progress ?? 0) >= 90) return false
      if (!normalized) return true
      return (
        item.title.toLowerCase().includes(normalized) ||
        item.detail.toLowerCase().includes(normalized) ||
        (item.overview ?? '').toLowerCase().includes(normalized) ||
        (item.genres ?? []).some((g) => translateGenre(g).toLowerCase().includes(normalized))
      )
    })
    if (sortOrder === 'az') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    }
    if (sortOrder === 'year-desc') {
      return [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title, 'pt-BR'))
    }
    if (activeKind === 'Continuar') {
      return [...list].sort((a, b) => {
        const ta = a.resume?.updatedAt ? Date.parse(a.resume.updatedAt) : 0
        const tb = b.resume?.updatedAt ? Date.parse(b.resume.updatedAt) : 0
        return tb - ta
      })
    }
    return list
  }, [activeGenre, activeKind, catalog, query, sortOrder, unwatchedOnly])

  const isFilteredView =
    activeKind !== 'Todos' || activeGenre !== 'Todos' || sortOrder !== 'default' || unwatchedOnly || query.trim().length > 0

  const dailySeed = useMemo(() => {
    const raw = `${activeProfileId}:${TODAY_KEY}`
    let hash = 2166136261
    for (let i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }, [activeProfileId])

  const recommendedItems = useMemo(() => {
    const preferredGenres = new Map<string, number>()
    for (const item of catalog) {
      const weight =
        (item.inWatchlist ? 3 : 0) +
        ((item.progress ?? 0) > 0 ? 2 : 0) +
        ((item.rating?.score ?? 0) >= 4 ? 3 : 0)
      if (weight <= 0) continue
      for (const genre of item.genres ?? []) {
        const key = genre.toLowerCase()
        preferredGenres.set(key, (preferredGenres.get(key) ?? 0) + weight)
      }
    }

    const hashId = (id: string) => {
      let h = dailySeed
      for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return (h >>> 0) % 1000
    }

    return [...catalog]
      .filter((item) => (item.progress ?? 0) === 0 && !item.resume)
      .map((item) => {
        const genreScore = (item.genres ?? []).reduce(
          (acc, g) => acc + (preferredGenres.get(g.toLowerCase()) ?? 0),
          0,
        )
        const artBonus = item.artwork.posterUrl || item.artwork.bannerUrl ? 2 : 0
        const jitter = hashId(item.id) / 1000
        return { item, score: genreScore + artBonus + jitter }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map((entry) => entry.item)
  }, [catalog, dailySeed])

  const heroItems = useMemo(() => {
    const withArt = catalog.filter((item) => item.artwork.bannerUrl || item.artwork.posterUrl)
    const pool = withArt.length > 0 ? withArt : catalog
    if (pool.length <= 6) return pool
    const scoreHero = (id: string) => {
      let h = dailySeed ^ 0x9e3779b9
      for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return h >>> 0
    }
    return [...pool]
      .sort((a, b) => scoreHero(a.id) - scoreHero(b.id))
      .slice(0, 6)
  }, [catalog, dailySeed])

  const continueWatching = useMemo(
    () =>
      catalog
        .filter((item) => Boolean(item.resume) || ((item.progress ?? 0) > 0 && (item.progress ?? 0) < 90))
        .sort((a, b) => {
          const ta = a.resume?.updatedAt ? Date.parse(a.resume.updatedAt) : 0
          const tb = b.resume?.updatedAt ? Date.parse(b.resume.updatedAt) : 0
          return tb - ta
        }),
    [catalog],
  )

  const watchlistItems = useMemo(
    () => catalog.filter((item) => Boolean(item.inWatchlist)),
    [catalog],
  )

  const shuffleForRow = useCallback(
    (items: LibraryItem[], rowKey: string) => {
      const score = (id: string) => {
        let h = dailySeed
        const raw = `${rowKey}:${id}`
        for (let i = 0; i < raw.length; i += 1) {
          h ^= raw.charCodeAt(i)
          h = Math.imul(h, 16777619)
        }
        return h >>> 0
      }
      return [...items].sort((a, b) => score(a.id) - score(b.id))
    },
    [dailySeed],
  )

  const moviesRow = useMemo(
    () => shuffleForRow(catalog.filter((item) => item.kind === 'Filme'), 'movies').slice(0, 20),
    [catalog, shuffleForRow],
  )

  const seriesRow = useMemo(
    () => shuffleForRow(catalog.filter((item) => item.kind === 'Série'), 'series').slice(0, 20),
    [catalog, shuffleForRow],
  )

  const genreCarousels = useMemo(() => {
    const genreAffinity = new Map<string, number>()
    for (const item of catalog) {
      const weight =
        (item.inWatchlist ? 3 : 0) +
        ((item.progress ?? 0) > 0 ? 2 : 0) +
        ((item.rating?.score ?? 0) >= 4 ? 3 : 0)
      if (weight <= 0) continue
      for (const g of item.genres ?? []) {
        genreAffinity.set(g, (genreAffinity.get(g) ?? 0) + weight)
      }
    }
    const dailyGenreJitter = (genre: string) => {
      let h = dailySeed
      for (let i = 0; i < genre.length; i += 1) {
        h ^= genre.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return ((h >>> 0) % 100) / 100
    }
    return genreOptions
      .map((genre) => ({
        genre,
        label: translateGenre(genre),
        score: (genreAffinity.get(genre) ?? 0) + dailyGenreJitter(genre),
        items: shuffleForRow(
          catalog.filter((item) => (item.genres ?? []).includes(genre)),
          `genre:${genre}`,
        ).slice(0, 18),
      }))
      .filter((row) => row.items.length >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [catalog, dailySeed, genreOptions, shuffleForRow])

  const goHome = useCallback(() => {
    setSelectedShow(null)
    setAdminOpen(false)
    setActiveGenre('Todos')
    setUnwatchedOnly(false)
    setQuery('')
    setCatalogNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/')
    }
  }, [setSelectedShow])

  return (
    <div
      className={`flex min-h-screen flex-col bg-[var(--sc-bg-canvas)] text-[var(--sc-text-primary)] transition-opacity duration-200 lg:flex-row ${
        profileFading ? 'opacity-25' : 'opacity-100'
      }`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-[var(--sc-accent)] focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:text-white"
      >
        Pular para o conteúdo
      </a>

      <Sidebar
        sources={sources}
        sourcesError={sourcesError}
        activeProfile={activeProfile}
        profiles={profiles}
        activeKind={activeKind}
        onSelectKind={(nextKind) => {
          setActiveAddonItem(null)
          setActiveKind(nextKind)
          goHome()
        }}
        onSelectProfile={handleProfileChange}
        onOpenProfileEditor={(profile) => {
          setEditingProfile(profile)
          setProfileEditorOpen(true)
        }}
        onGoHome={() => {
          setActiveAddonItem(null)
          setActiveKind('Todos')
          goHome()
        }}
        onOpenAdmin={() => {
          setActiveAddonItem(null)
          setSelectedShow(null)
          setAdminTab('review')
          setAdminOpen(true)
        }}
        onOpenAddons={() => {
          setActiveAddonItem(null)
          setSelectedShow(null)
          setAdminTab('addons')
          setAdminOpen(true)
        }}
        adminActive={adminOpen}
        addonsActive={adminOpen && adminTab === 'addons'}
        onRefreshCatalog={() => void fetch('/api/catalog/refresh', { method: 'POST' })}
        onSourceAdded={refreshCatalogAndSources}
        refreshing={catalogRefresh.state === 'running'}
        refreshStatus={
          catalogRefresh.state === 'running'
            ? 'Escaneando fontes...'
            : catalogRefresh.state === 'succeeded'
              ? 'Catálogo atualizado.'
              : catalogRefresh.error || ''
        }
        adminBadgeCount={reviewItems.length + artworkCandidates.length}
        gamepadConnected={Boolean(connectedGamepad)}
        theme={theme}
        onChangeTheme={setTheme}
      />

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 outline-none sm:px-8 sm:py-7">
        {/* Top Search & Genre Filter Bar */}
        {!adminOpen && activeKind !== 'Online' && (
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--sc-text-muted)]" />
              <input
                id="sc-search-input"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSelectedShow(null)
                }}
                placeholder="Buscar filmes, séries ou gêneros (/)"
                className="h-10 w-full rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] pr-4 pl-10 text-sm text-white placeholder:text-[var(--sc-text-muted)] focus:border-white/35 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Filtrar por gênero"
                value={activeGenre}
                onChange={(event) => {
                  setActiveGenre(event.target.value)
                  setSelectedShow(null)
                }}
                className="h-10 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-4 text-xs font-semibold text-white focus:border-white/35 focus:outline-none"
              >
                <option value="Todos">Todos os gêneros</option>
                {genreOptions.map((genre) => (
                  <option key={genre} value={genre}>
                    {translateGenre(genre)}
                  </option>
                ))}
              </select>

              <select
                aria-label="Ordenar catálogo"
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(event.target.value as 'default' | 'az' | 'year-desc')
                  setSelectedShow(null)
                }}
                className="h-10 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-4 text-xs font-semibold text-white focus:border-white/35 focus:outline-none"
              >
                <option value="default">Ordem padrão</option>
                <option value="az">Título (A–Z)</option>
                <option value="year-desc">Mais recentes</option>
              </select>

              <button
                type="button"
                aria-pressed={unwatchedOnly}
                onClick={() => {
                  setUnwatchedOnly((value) => !value)
                  setSelectedShow(null)
                }}
                className={`h-10 rounded-full border px-3.5 text-xs font-semibold transition ${
                  unwatchedOnly
                    ? 'border-[var(--sc-accent)] bg-[var(--sc-accent)]/20 text-white'
                    : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-[var(--sc-text-secondary)] hover:text-white'
                }`}
              >
                Não assistidos
              </button>

              <span className="hidden text-xs text-[var(--sc-text-muted)] sm:inline">
                {filteredItems.length} título(s)
              </span>
            </div>
          </header>
        )}

        {catalogNotice && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-amber-500/50 bg-amber-500/15 px-4 py-3 text-xs font-medium text-[var(--sc-text-primary)]"
          >
            <span>{catalogNotice}</span>
            <button
              type="button"
              onClick={() => setCatalogNotice('')}
              className="rounded border-0 bg-black/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--sc-text-primary)] hover:bg-black/25 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {adminOpen ? (
          <Suspense fallback={<CatalogSkeleton />}>
            <AdminView
              key={adminTab}
              initialTab={adminTab}
              reviewItems={reviewItems}
              reviewError={reviewError}
              artworkGroups={artworkCandidates}
              artworkError={artworkCandidatesError}
              history={catalogHistory}
              onBack={() => setAdminOpen(false)}
              onRefreshAll={refreshCatalogAndSources}
              onPlayMedia={(media) => setSelectedMedia(media)}
            />
          </Suspense>
        ) : activeAddonItem ? (
          <Suspense fallback={<CatalogSkeleton />}>
            <AddonDetailView
              key={`${activeAddonItem.type}:${activeAddonItem.id}`}
              item={activeAddonItem}
              localCatalog={catalog}
              onBack={() => setActiveAddonItem(null)}
              onPlayStream={(media) => setSelectedMedia(media)}
              onPlayLocal={(localItem) => playLibraryItem(localItem)}
            />
          </Suspense>
        ) : activeKind === 'Online' ? (
          <Suspense fallback={<CatalogSkeleton />}>
            <OnlineCatalogView
              profileId={activeProfile.id}
              isAdmin={Boolean(activeProfile.isAdmin ?? activeProfile.id === 'profile-savio')}
              localCatalog={catalog}
              onPlayStream={(media) => setSelectedMedia(media)}
              onPlayLocal={(localItem) => playLibraryItem(localItem)}
              onOpenItem={(item) => setActiveAddonItem(item)}
              onOpenAddonsManager={() => {
                setSelectedShow(null)
                setAdminTab('addons')
                setAdminOpen(true)
              }}
            />
          </Suspense>
        ) : catalogLoading ? (
          <CatalogSkeleton />
        ) : selectedShow ? (
          <Suspense fallback={<CatalogSkeleton />}>
            <ShowDetailView
              show={selectedShow}
              library={catalog}
              profileId={activeProfile.id}
              onBack={() => setSelectedShow(null)}
              onPlayMedia={(media) => setSelectedMedia(media)}
              onPlayItem={playLibraryItem}
              onOpenDetails={(item) => setSelectedShow(item)}
              onOpenAddonItem={(item) => setActiveAddonItem(item)}
              onToggleWatchlist={(item) => void toggleWatchlist(item)}
              onSearchArtwork={(item) => void triggerArtworkSearch(item)}
              onCatalogUpdated={refreshCatalogAndSources}
              onArchived={() => {
                setSelectedShow(null)
                refreshCatalogAndSources()
              }}
            />
          </Suspense>
        ) : isFilteredView ? (
          <section className="flex flex-col gap-5">
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="m-0 text-xl font-bold text-[var(--sc-text-primary)]">
                {activeKind === 'Todos'
                  ? 'Resultados'
                  : activeKind === 'Local'
                    ? 'Acervo Local'
                    : activeKind === 'Continuar'
                      ? 'Continuar assistindo'
                      : activeKind === 'Filme'
                        ? 'Filmes'
                        : 'Séries'}
                {activeGenre !== 'Todos' ? ` · ${translateGenre(activeGenre)}` : ''}
              </h1>
              <span className="text-xs text-[var(--sc-text-muted)]">
                Capa reproduz · ⓘ abre detalhes
              </span>
            </div>

            {activeKind === 'Continuar' && onlineContinueItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="m-0 text-sm font-bold uppercase tracking-wider text-[var(--sc-text-secondary)]">
                  Continuar assistindo (Online · Addons)
                </h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {onlineContinueItems.map((entry) => {
                    const pct =
                      entry.durationSec > 0
                        ? Math.min(100, Math.round((entry.positionSec / entry.durationSec) * 100))
                        : 0
                    const cleanId = entry.contentKey.replace(/^addon:/, '')
                    return (
                      <button
                        key={`cont-online-${entry.contentKey}`}
                        type="button"
                        onClick={() =>
                          setActiveAddonItem({
                            id: cleanId,
                            type: entry.type || 'movie',
                            name: entry.title,
                            poster: entry.poster,
                            description: '',
                            releaseInfo: null,
                          })
                        }
                        className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)]/60 cursor-pointer"
                      >
                        <div className="relative aspect-[2/3] w-full bg-black/50">
                          {entry.poster ? (
                            <img
                              src={entry.poster}
                              alt={entry.title}
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center p-2 text-center text-xs text-[var(--sc-text-muted)]">
                              {entry.title}
                            </div>
                          )}
                          <div className="absolute right-0 bottom-0 left-0 h-1 bg-white/20">
                            <div className="h-full bg-[var(--sc-accent)]" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="p-2.5">
                          <p className="truncate text-xs font-semibold text-[var(--sc-text-primary)]">{entry.title}</p>
                          <p className="truncate text-[11px] text-[var(--sc-text-muted)]">
                            {entry.season && entry.episode ? `T${entry.season}:E${entry.episode} · ` : ''}
                            {pct}% assistido
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {filteredItems.length === 0 && !(activeKind === 'Continuar' && onlineContinueItems.length > 0) ? (
              <div className="flex flex-col items-center gap-3 rounded-[var(--sc-radius-xl)] border border-dashed border-white/15 p-12 text-center text-sm text-[var(--sc-text-muted)]">
                <p className="m-0">
                  {activeKind === 'Continuar'
                    ? 'Você ainda não começou a assistir nenhum título neste perfil. Dê o play em um filme ou série para continuar daqui depois.'
                    : 'Nenhum título encontrado para os filtros atuais.'}
                </p>
                {activeKind === 'Continuar' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveKind('Todos')
                      goHome()
                    }}
                    className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-white/90 cursor-pointer"
                  >
                    Explorar catálogo
                  </button>
                )}
              </div>
            ) : query.trim().length > 0 && filteredItems.length > 0 ? (
              <div className="space-y-6">
                {(['Filme', 'Série'] as const).map((kindGroup) => {
                  const groupItems = filteredItems.filter((item) => item.kind === kindGroup)
                  if (groupItems.length === 0) return null
                  return (
                    <div key={kindGroup} className="space-y-3">
                      <h2 className="m-0 text-sm font-bold uppercase tracking-wider text-[var(--sc-text-secondary)]">
                        {kindGroup === 'Filme' ? 'Filmes' : 'Séries'} ({groupItems.length})
                      </h2>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                        {groupItems.map((item) => (
                          <MediaCard
                            key={item.id}
                            item={item}
                            onPlay={playLibraryItem}
                            onOpenDetails={(target) => setSelectedShow(target)}
                            onToggleWatchlist={(target) => void toggleWatchlist(target)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : filteredItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {filteredItems.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    onPlay={playLibraryItem}
                    onOpenDetails={(target) => setSelectedShow(target)}
                    onToggleWatchlist={(target) => void toggleWatchlist(target)}
                  />
                ))}
              </div>
            ) : null}
            {query.trim().length >= 2 && addonSearching && (
              <div className="mt-4 border-t border-[var(--sc-border-subtle)] pt-5">
                <SavanoLoader label="Buscando nos addons..." />
              </div>
            )}
            {query.trim().length >= 2 && !addonSearching && addonSearchResults.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-[var(--sc-border-subtle)] pt-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="m-0 text-base font-bold text-[var(--sc-text-primary)]">
                    Resultados nos Addons (Stremio)
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveKind('Online')}
                    className="text-xs font-semibold text-[var(--sc-accent)] hover:underline cursor-pointer"
                  >
                    Abrir Acervo Online →
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                  {addonSearchResults.map((item) => (
                    <button
                      key={`addon-${item.type}-${item.id}`}
                      type="button"
                      onClick={() =>
                        setActiveAddonItem({
                          id: item.id,
                          type: item.type,
                          name: item.name,
                          poster: item.poster,
                          description: item.description || '',
                          releaseInfo: item.releaseInfo,
                        })
                      }
                      className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-white/30 cursor-pointer"
                    >
                      <div className="aspect-[2/3] w-full bg-black/50">
                        {item.poster ? (
                          <img src={item.poster} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-[var(--sc-text-muted)]">
                            Sem capa
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="truncate text-xs font-semibold text-[var(--sc-text-primary)]">{item.name}</p>
                        <p className="truncate text-[11px] text-[var(--sc-text-muted)]">
                          {item.addonName}{item.releaseInfo ? ` · ${item.releaseInfo}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="flex flex-col gap-9">
            <HeroCarousel
              items={heroItems}
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            <MediaCarousel
              title="Continue assistindo"
              subtitle="Retome exatamente de onde parou"
              items={continueWatching}
              variant="landscape"
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            <MediaCarousel
              title="Minha lista"
              subtitle="Seus títulos salvos neste perfil"
              items={watchlistItems}
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            <MediaCarousel
              title="Recomendados para você"
              subtitle="Baseado no seu perfil e rotacionado diariamente"
              items={recommendedItems}
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            <MediaCarousel
              title="Filmes no catálogo"
              items={moviesRow}
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            <MediaCarousel
              title="Séries e animações"
              items={seriesRow}
              onPlay={playLibraryItem}
              onOpenDetails={(target) => setSelectedShow(target)}
              onToggleWatchlist={(target) => void toggleWatchlist(target)}
            />

            {homeTrendingOnline.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-lg font-bold tracking-tight text-[var(--sc-text-primary)]">
                      Em alta nos Addons (Online)
                    </h2>
                    <p className="m-0 text-xs text-[var(--sc-text-muted)]">
                      Destaques populares dos seus addons ativos combinados ao acervo local
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveKind('Online')}
                    className="text-xs font-semibold text-[var(--sc-accent)] hover:underline cursor-pointer"
                  >
                    Ver tudo →
                  </button>
                </div>
                <div className="flex gap-3.5 overflow-x-auto pb-2">
                  {homeTrendingOnline.map((item) => (
                    <button
                      key={`home-online-${item.type}-${item.id}`}
                      type="button"
                      onClick={() =>
                        setActiveAddonItem({
                          id: item.id,
                          type: item.type,
                          name: item.name,
                          poster: item.poster,
                          description: item.description || '',
                          releaseInfo: item.releaseInfo,
                        })
                      }
                      className="group w-[150px] shrink-0 overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)]/60 sm:w-[170px] cursor-pointer"
                    >
                      <div className="aspect-[2/3] w-full bg-black/50">
                        {item.poster ? (
                          <img
                            src={item.poster}
                            alt={item.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition group-hover:scale-105"
                          />
                        ) : null}
                      </div>
                      <div className="p-2.5">
                        <p className="truncate text-xs font-semibold text-[var(--sc-text-primary)]">
                          {item.name}
                        </p>
                        <p className="truncate text-[11px] text-[var(--sc-text-muted)]">
                          {item.addonName}{item.releaseInfo ? ` · ${item.releaseInfo}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {genreCarousels.map((row) => (
              <MediaCarousel
                key={row.genre}
                title={row.label}
                items={row.items}
                onPlay={playLibraryItem}
                onOpenDetails={(target) => setSelectedShow(target)}
                onToggleWatchlist={(target) => void toggleWatchlist(target)}
              />
            ))}
          </div>
        )}
      </main>

      {selectedMedia && (
        <Suspense fallback={null}>
          <VideoPlayer
            key={selectedMedia.url}
            media={selectedMedia}
            profileId={activeProfile.id}
            capabilities={playerCapabilities}
            onPlayNext={(next) => setSelectedMedia(next)}
            onClose={() => {
              setSelectedMedia(null)
              window.setTimeout(() => refreshCatalogAndSources(), 250)
            }}
          />
        </Suspense>
      )}

      {pinLocked && (
        <PinGate
          onUnlocked={() => {
            setPinLocked(false)
            refreshCatalogAndSources()
          }}
        />
      )}

      {!pinLocked && profileGateOpen && !profileEditorOpen && (
        <ProfileGate
          profiles={profiles}
          backdropUrl={heroItems[0]?.artwork.bannerUrl || heroItems[0]?.artwork.posterUrl}
          onSelectProfile={(id) => handleProfileChange(id)}
          onAddProfile={() => {
            setEditingProfile(undefined)
            setProfileEditorOpen(true)
          }}
          onEditProfile={(profile) => {
            if (profile?.hasPassword && !unlockedProfiles.has(profile.id)) {
              setPendingUnlockProfile(profile)
              setUnlockPassword('')
              setUnlockError('')
              return
            }
            setEditingProfile(profile)
            setProfileEditorOpen(true)
          }}
        />
      )}

      {pendingUnlockProfile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Desbloquear perfil ${pendingUnlockProfile.name}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setUnlockError('')
              try {
                const res = await fetch(`/api/profiles/${encodeURIComponent(pendingUnlockProfile.id)}/unlock`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: unlockPassword }),
                })
                const data = await res.json().catch(() => null)
                if (!res.ok) {
                  setUnlockError(data?.error || 'Senha incorreta.')
                  return
                }
                const unlockedId = pendingUnlockProfile.id
                setUnlockedProfiles((prev) => new Set(prev).add(unlockedId))
                setPendingUnlockProfile(null)
                setUnlockPassword('')
                completeProfileSwitch(unlockedId)
              } catch {
                setUnlockError('Falha ao validar senha do perfil.')
              }
            }}
            className="w-full max-w-sm space-y-4 rounded-[var(--sc-radius-xl)] border border-white/15 bg-[#12141c] p-6 text-white shadow-2xl"
          >
            <h2 className="m-0 text-lg font-bold">Senha do perfil: {pendingUnlockProfile.name}</h2>
            <input
              type="password"
              autoFocus
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Digite a senha deste perfil"
              className="w-full rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3.5 py-2 text-sm text-white outline-none focus:border-white/50"
            />
            {unlockError ? <p className="text-xs text-red-400">{unlockError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingUnlockProfile(null)}
                className="rounded-[var(--sc-radius-md)] border border-white/15 bg-transparent px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-[var(--sc-radius-md)] bg-[var(--sc-accent)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--sc-accent-hover)] cursor-pointer"
              >
                Desbloquear
              </button>
            </div>
          </form>
        </div>
      )}

      <ProfileModal
        key={editingProfile?.id ?? (profileEditorOpen ? 'new' : 'closed')}
        open={profileEditorOpen}
        profile={editingProfile}
        canDelete={profiles.length > 1}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={(savedId) => {
          refreshProfiles()
          handleProfileChange(savedId)
        }}
        onDeleted={(deletedId) => {
          refreshProfiles()
          if (deletedId === activeProfileId) {
            const fallback = profiles.find((p) => p.id !== deletedId)?.id ?? 'profile-savio'
            handleProfileChange(fallback)
          }
        }}
      />
      {profileFading && <SavanoLoader fullscreen label="Trocando perfil..." />}
    </div>
  )
}

export default App
