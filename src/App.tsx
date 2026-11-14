import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminView } from './components/admin/AdminView'
import { HeroCarousel } from './components/home/HeroCarousel'
import { MediaCarousel } from './components/home/MediaCarousel'
import { Sidebar } from './components/layout/Sidebar'
import { MediaCard } from './components/media/MediaCard'
import { ShowDetailView } from './components/media/ShowDetailView'
import type {
  ArtworkCandidateGroup,
  CatalogHistory,
  CatalogRefreshStatus,
} from './components/modals/CatalogModals'
import { VideoPlayer } from './components/player/VideoPlayer'
import { ProfileModal } from './components/profile/ProfileModal'
import { CatalogSkeleton } from './components/ui/CatalogSkeleton'
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
  const [activeKind, setActiveKind] = useState<'Todos' | 'Filme' | 'Série' | 'Continuar'>('Todos')
  const [activeGenre, setActiveGenre] = useState('Todos')
  const [sortOrder, setSortOrder] = useState<'default' | 'az' | 'year-desc'>('default')
  const [unwatchedOnly, setUnwatchedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedShowId, setSelectedShowId] = useState<string | null>(() => getInitialDeepLinkId())
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminTab, setAdminTab] = useState<'review' | 'artwork' | 'history' | 'logs'>('review')

  const [activeProfileId, setActiveProfileId] = useState('profile-savio')
  const [catalog, setCatalog] = useState<LibraryItem[]>(
    () => readCachedCatalog('profile-savio') ?? mockLibrary,
  )
  const [catalogLoading, setCatalogLoading] = useState(
    () => !readCachedCatalog('profile-savio'),
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

  const handleProfileChange = useCallback(
    (nextId: string) => {
      if (nextId === activeProfileId) return
      setProfileFading(true)
      const cached = readCachedCatalog(nextId)
      if (cached) {
        setCatalog(cached)
        setCatalogLoading(false)
      } else {
        setCatalogLoading(true)
      }
      setActiveProfileId(nextId)
      window.setTimeout(() => setProfileFading(false), 240)
    },
    [activeProfileId],
  )

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

    refreshReview()
    refreshArtworkCandidates()
    refreshHistory()
  }, [activeProfileId, refreshArtworkCandidates, refreshHistory, refreshReview])

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

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? mockProfiles[0]

  const [catalogNotice, setCatalogNotice] = useState('')
  const connectedGamepad = useGamepadNavigation(Boolean(selectedMedia))

  const playLibraryItem = useCallback((item: LibraryItem) => {
    if (item.sourceStatus === 'offline') {
      setCatalogNotice(
        `A fonte "${item.sourceName || 'HD externo'}" está desconectada no momento. Conecte o dispositivo e clique em Atualizar na barra lateral.`,
      )
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
      } else if (activeKind !== 'Todos' && item.kind !== activeKind) {
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
    () => catalog.filter((item) => Boolean(item.resume) || (item.progress ?? 0) > 0),
    [catalog],
  )

  const watchlistItems = useMemo(
    () => catalog.filter((item) => Boolean(item.inWatchlist)),
    [catalog],
  )

  const moviesRow = useMemo(
    () => catalog.filter((item) => item.kind === 'Filme').slice(0, 20),
    [catalog],
  )

  const seriesRow = useMemo(
    () => catalog.filter((item) => item.kind === 'Série').slice(0, 20),
    [catalog],
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
        items: catalog.filter((item) => (item.genres ?? []).includes(genre)).slice(0, 18),
      }))
      .filter((row) => row.items.length >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [catalog, dailySeed, genreOptions])

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
      <Sidebar
        sources={sources}
        sourcesError={sourcesError}
        activeProfile={activeProfile}
        profiles={profiles}
        activeKind={activeKind}
        onSelectKind={setActiveKind}
        onSelectProfile={handleProfileChange}
        onOpenProfileEditor={(profile) => {
          setEditingProfile(profile)
          setProfileEditorOpen(true)
        }}
        onGoHome={() => {
          setActiveKind('Todos')
          goHome()
        }}
        onOpenAdmin={() => {
          setSelectedShow(null)
          setAdminOpen(true)
        }}
        adminActive={adminOpen}
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
      />

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-8 sm:py-7">
        {/* Top Search & Genre Filter Bar */}
        {!adminOpen && (
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
            className="mb-4 flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-xs text-amber-100"
          >
            <span>{catalogNotice}</span>
            <button
              type="button"
              onClick={() => setCatalogNotice('')}
              className="rounded border-0 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {adminOpen ? (
          <AdminView
            initialTab={adminTab}
            reviewItems={reviewItems}
            reviewError={reviewError}
            artworkGroups={artworkCandidates}
            artworkError={artworkCandidatesError}
            history={catalogHistory}
            onBack={() => setAdminOpen(false)}
            onRefreshAll={refreshCatalogAndSources}
          />
        ) : catalogLoading ? (
          <CatalogSkeleton />
        ) : selectedShow ? (
          <ShowDetailView
            show={selectedShow}
            library={catalog}
            profileId={activeProfile.id}
            onBack={() => setSelectedShow(null)}
            onPlayMedia={(media) => setSelectedMedia(media)}
            onPlayItem={playLibraryItem}
            onOpenDetails={(item) => setSelectedShow(item)}
            onToggleWatchlist={(item) => void toggleWatchlist(item)}
            onSearchArtwork={(item) => void triggerArtworkSearch(item)}
            onCatalogUpdated={refreshCatalogAndSources}
            onArchived={() => {
              setSelectedShow(null)
              refreshCatalogAndSources()
            }}
          />
        ) : isFilteredView ? (
          <section className="flex flex-col gap-5">
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="m-0 text-xl font-bold text-white">
                {activeKind === 'Todos'
                  ? 'Resultados'
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

            {filteredItems.length === 0 ? (
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
            ) : (
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
      )}

      <ProfileModal
        key={editingProfile?.id ?? (profileEditorOpen ? 'new' : 'closed')}
        open={profileEditorOpen}
        profile={editingProfile}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={(savedId) => {
          refreshProfiles()
          handleProfileChange(savedId)
        }}
      />
    </div>
  )
}

export default App
