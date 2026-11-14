import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { library as mockLibrary, mediaSources as mockSources } from './data/mockCatalog'
import { profiles as mockProfiles } from './data/mockCatalog'
import type { Episode, LibraryItem, MediaKind, MediaSource, Profile, ResumeInfo, ReviewItem } from './domain/catalog'
import { messages } from './config/messages'
import './App.css'

type LibraryFilter = 'Tudo' | MediaKind | string
const SOURCE_REFRESH_INTERVAL_MS = 30_000

function App() {
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>('Tudo')
  const [query, setQuery] = useState('')
  const [selectedShow, setSelectedShow] = useState<LibraryItem | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [catalog, setCatalog] = useState<LibraryItem[]>(mockLibrary)
  const [sources, setSources] = useState(mockSources)
  const [profiles, setProfiles] = useState<Profile[]>(mockProfiles)
  const [activeProfileId, setActiveProfileId] = useState('profile-savio')
  const [selectedMedia, setSelectedMedia] = useState<{ title: string; url: string; subtitleUrl?: string; mediaId?: string } | null>(null)
  const [playerCapabilities, setPlayerCapabilities] = useState<{ ffmpeg: boolean; transcoding?: boolean; ffprobe: boolean; vlc: boolean } | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [reviewError, setReviewError] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [artworkReviewOpen, setArtworkReviewOpen] = useState(false)
  const [artworkCandidates, setArtworkCandidates] = useState<ArtworkCandidateGroup[]>([])
  const [artworkCandidatesError, setArtworkCandidatesError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [catalogHistory, setCatalogHistory] = useState<CatalogHistory>({ archived: [], titleChanges: [] })
  const [catalogRefresh, setCatalogRefresh] = useState<CatalogRefreshStatus>({ state: 'idle', sourceIds: [], results: [] })
  const lastRefreshState = useRef(catalogRefresh.state)

  useEffect(() => {
    fetch('/api/player/capabilities')
      .then((response) => response.ok ? response.json() : null)
      .then(setPlayerCapabilities)
      .catch(() => undefined)
  }, [])

  const refreshReview = useCallback(() => {
    fetch('/api/review')
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error || 'Não foi possível carregar a revisão.')
        }
        return response.json()
      })
      .then(setReviewItems)
      .then(() => setReviewError(''))
      .catch((error: Error) => setReviewError(error.message))
  }, [])

  const refreshHistory = useCallback(() => {
    fetch('/api/catalog/history')
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then(setCatalogHistory)
      .catch(() => setCatalogHistory({ archived: [], titleChanges: [] }))
  }, [])

  const refreshArtworkCandidates = useCallback(() => {
    fetch('/api/artwork/candidates')
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error || 'Não foi possível carregar os candidatos de arte.')
        }
        return response.json()
      })
      .then(setArtworkCandidates)
      .then(() => setArtworkCandidatesError(''))
      .catch((error: Error) => setArtworkCandidatesError(error.message))
  }, [])

  useEffect(() => {
    refreshReview()
    refreshHistory()
    refreshArtworkCandidates()
  }, [refreshArtworkCandidates, refreshHistory, refreshReview])

  const refreshCatalog = useCallback(() => {
    fetch(`/api/library?profileId=${encodeURIComponent(activeProfileId)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then(setCatalog)
      .catch(() => undefined)
  }, [activeProfileId])

  const refreshSources = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/sources', { signal })
    if (!response.ok) throw new Error('Não foi possível atualizar o estado das fontes.')
    setSources(await response.json() as MediaSource[])
  }, [])

  const updateCatalog = useCallback(() => {
    fetch('/api/catalog/refresh', { method: 'POST' })
      .then((response) => response.ok ? response.json() : response.json().then((body) => Promise.reject(new Error(body.error || 'Não foi possível iniciar a atualização.'))))
      .then(setCatalogRefresh)
      .catch((error: Error) => setCatalogRefresh((current) => ({ ...current, state: 'failed', error: error.message })))
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(`/api/library?profileId=${encodeURIComponent(activeProfileId)}`).then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/profiles').then((response) => response.ok ? response.json() : Promise.reject(response)),
    ]).then(([remoteLibrary, remoteProfiles]) => {
      setCatalog(remoteLibrary)
      setProfiles(remoteProfiles)
    }).catch(() => {
      console.warn('API local indisponível; usando o catálogo de demonstração.')
    })
  }, [activeProfileId])

  useEffect(() => {
    let disposed = false
    let requestInFlight = false
    const controller = new AbortController()
    const refresh = async () => {
      if (disposed || requestInFlight) return
      requestInFlight = true
      try {
        await refreshSources(controller.signal)
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Não foi possível atualizar o estado das fontes.')
        }
      } finally {
        requestInFlight = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), SOURCE_REFRESH_INTERVAL_MS)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refreshSources])

  useEffect(() => {
    const refreshStatus = () => fetch('/api/catalog/refresh/status')
      .then((response) => response.ok ? response.json() : Promise.reject(response))
      .then((status: CatalogRefreshStatus) => {
        setCatalogRefresh(status)
        if (status.state === 'succeeded' && lastRefreshState.current !== 'succeeded') {
          refreshCatalog()
          refreshSources().catch(() => undefined)
          refreshReview()
        }
        lastRefreshState.current = status.state
      })
      .catch(() => undefined)
    refreshStatus()
    const timer = window.setInterval(refreshStatus, 1000)
    return () => window.clearInterval(timer)
  }, [refreshCatalog, refreshReview, refreshSources])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedMedia) {
        setSelectedMedia(null)
        return
      }

      if (event.key === 'Escape' && selectedShow) {
        setSelectedShow(null)
        return
      }

      if (event.key === 'Escape' && reviewOpen) {
        setReviewOpen(false)
        return
      }

      if (event.key === 'Escape' && historyOpen) {
        setHistoryOpen(false)
        return
      }

      if (event.key === 'Escape' && artworkReviewOpen) {
        setArtworkReviewOpen(false)
        return
      }

      if (event.key === '/' && event.target instanceof HTMLElement && event.target.tagName !== 'INPUT') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search-box input')?.focus()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [artworkReviewOpen, historyOpen, reviewOpen, selectedMedia, selectedShow])

  useEffect(() => {
    document.title = selectedMedia
      ? `▶ ${selectedMedia.title} · ${messages.appName}`
      : selectedShow
        ? `SC - ${selectedShow.title}`
        : messages.appName
  }, [selectedMedia, selectedShow])

  useGamepadNavigation()

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return catalog.filter((item) => {
      const matchesFilter = activeFilter === 'Tudo' || item.kind === activeFilter || item.genres?.includes(activeFilter) || item.tags?.includes(activeFilter)
      const matchesQuery =
        !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)

      return matchesFilter && matchesQuery
    })
  }, [activeFilter, catalog, query])

  const genreFilters = useMemo(() => Array.from(new Set(catalog.flatMap((item) => [...(item.genres ?? []), ...(item.tags ?? [])])))
    .filter((tag) => !['Filme', 'Série'].includes(tag))
    .sort((a, b) => a.localeCompare(b)), [catalog])

  const selectedEpisodes =
    selectedShow?.seasons?.find((season) => season.number === selectedSeason)?.episodes ?? []
  const resume = catalog
    .map((item) => item.resume ? { item, resume: item.resume } : null)
    .filter((entry): entry is { item: LibraryItem; resume: ResumeInfo } => Boolean(entry))
    .sort((a, b) => (b.resume.updatedAt ?? '').localeCompare(a.resume.updatedAt ?? ''))[0]

  const openShow = (show: LibraryItem) => {
    setSelectedShow(show)
    setSelectedSeason(show.seasons?.[0]?.number ?? 1)
    window.history.pushState({}, '', `/${show.kind === 'Série' ? 'series' : 'filmes'}/${encodeURIComponent(show.id)}`)
  }

  const closeShow = () => {
    setSelectedShow(null)
    window.history.pushState({}, '', '/inicio')
  }

  const searchArtworkForItem = async (item: LibraryItem) => {
    const targetType = item.kind === 'Série' ? 'show' : 'movie'
    const targetId = item.kind === 'Série' ? item.id : (item.mediaId ?? item.id)
    setArtworkCandidatesError('')
    try {
      const response = await fetch('/api/artwork/candidates/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, query: item.title }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Não foi possível buscar candidatos de arte.')
      if (Array.isArray(body?.groups)) setArtworkCandidates(body.groups)
      else refreshArtworkCandidates()
    } catch (error) {
      setArtworkCandidatesError(error instanceof Error ? error.message : 'Não foi possível buscar candidatos de arte.')
    }
    setArtworkReviewOpen(true)
  }

  useEffect(() => {
    const syncRoute = () => {
      const match = window.location.pathname.match(/^\/(series|filmes)\/(.+)$/)
      const itemId = match ? decodeURIComponent(match[2]) : null
      const show = itemId ? catalog.find((item) => item.id === itemId) : null
      setSelectedShow(show ?? null)
      if (show) setSelectedSeason(show.seasons?.[0]?.number ?? 1)
    }

    syncRoute()
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [catalog])

  if (selectedShow) {
    return (
      <div className="app-shell">
        <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} reviewCount={reviewItems.length} onReview={() => setReviewOpen(true)} artworkCount={artworkCandidates.length} onArtworkReview={() => { refreshArtworkCandidates(); setArtworkReviewOpen(true) }} historyCount={catalogHistory.archived.length + catalogHistory.titleChanges.length} onHistory={() => { refreshHistory(); setHistoryOpen(true) }} catalogRefresh={catalogRefresh} onCatalogRefresh={updateCatalog} onSourceAdded={refreshSources} />
        <main className="content">
          <button className="back-button controller-focus" type="button" onClick={closeShow}>
            ← Voltar para biblioteca
          </button>
          <ShowHeader key={selectedShow.id} show={selectedShow} profileId={activeProfileId} onPlay={setSelectedMedia} onSearchArtwork={searchArtworkForItem} onCatalogUpdated={refreshCatalog} onArchived={() => { refreshCatalog(); refreshHistory(); closeShow() }} />
          {selectedShow.kind === 'Série' && <section className="episodes-section">
            <div className="season-header">
              <div>
                <p className="eyebrow">EPISÓDIOS</p>
                <h2>Escolha um episódio</h2>
              </div>
              <label className="season-select">
                Temporada
                <select
                  value={selectedSeason}
                  onChange={(event) => setSelectedSeason(Number(event.target.value))}
                >
                  {selectedShow.seasons?.map((season) => (
                    <option key={season.number} value={season.number}>
                      {season.label ?? `Temporada ${season.number.toString().padStart(2, '0')}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="episode-list">
              {selectedEpisodes.map((episode) => (
                <EpisodeRow episode={episode} key={episode.id} onPlay={setSelectedMedia} />
              ))}
            </div>
          </section>}
        </main>
        {selectedMedia && <VideoPlayer key={selectedMedia.mediaId ?? selectedMedia.url} media={selectedMedia} profileId={activeProfileId} capabilities={playerCapabilities} onClose={() => setSelectedMedia(null)} />}
        {reviewOpen && <ReviewPanel items={reviewItems} error={reviewError} onRefresh={refreshReview} onClose={() => setReviewOpen(false)} />}
        {artworkReviewOpen && <ArtworkReviewPanel groups={artworkCandidates} error={artworkCandidatesError} onRefresh={() => { refreshArtworkCandidates(); refreshCatalog() }} onClose={() => setArtworkReviewOpen(false)} />}
        {historyOpen && <CatalogHistoryPanel history={catalogHistory} onRefresh={() => { refreshHistory(); refreshCatalog() }} onClose={() => setHistoryOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} reviewCount={reviewItems.length} onReview={() => setReviewOpen(true)} artworkCount={artworkCandidates.length} onArtworkReview={() => { refreshArtworkCandidates(); setArtworkReviewOpen(true) }} historyCount={catalogHistory.archived.length + catalogHistory.titleChanges.length} onHistory={() => { refreshHistory(); setHistoryOpen(true) }} catalogRefresh={catalogRefresh} onCatalogRefresh={updateCatalog} onSourceAdded={refreshSources} />
      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SUA BIBLIOTECA</p>
            <h1>O que vamos assistir?</h1>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input
              type="search"
              placeholder="Buscar na biblioteca"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>

        <OfflineSourceNotice source={sources.find((source) => source.status === 'offline')} />

        <section className="hero-card">
          <div className="hero-copy">
            <span className="hero-label">CONTINUE ASSISTINDO</span>
            {resume ? <>
              <h2>{resume.resume.kind === 'episode' ? resume.resume.showTitle : resume.resume.title}</h2>
              <p>{resume.resume.kind === 'episode'
                ? `Temporada ${resume.resume.season} · Episódio ${resume.resume.episode} · ${resume.resume.title} · ${formatPlaybackTime(resume.resume.position)}${resume.resume.duration ? ` de ${formatPlaybackTime(resume.resume.duration)}` : ''}`
                : `${formatPlaybackTime(resume.resume.position)}${resume.resume.duration ? ` de ${formatPlaybackTime(resume.resume.duration)}` : ''}`}</p>
              <button className="primary-button" type="button" onClick={() => setSelectedMedia({
                title: resume.resume.kind === 'episode' ? `${resume.resume.showTitle} · ${resume.resume.title}` : resume.resume.title,
                url: resume.resume.mediaUrl,
                subtitleUrl: resume.resume.subtitleUrl,
                mediaId: resume.resume.mediaId,
              })}>
                <span>▶</span> Continuar
              </button>
            </> : <>
              <h2>Nada para retomar ainda</h2>
              <p>Quando você parar um filme ou episódio, ele aparecerá aqui.</p>
            </>}
          </div>
          <div className="hero-art" aria-hidden="true" style={resume?.item.artwork.bannerUrl ? { backgroundImage: `url(${resume.item.artwork.bannerUrl})` } : undefined}>
            {!resume?.item.artwork.bannerUrl && <><span>Sua</span><strong>biblioteca</strong></>}
          </div>
        </section>

        <section className="library-section" id="inicio">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CATÁLOGO</p>
              <h2>Sua biblioteca</h2>
            </div>
            <div className="filters" role="group" aria-label="Filtrar biblioteca">
              {(['Tudo', 'Filme', 'Série', ...genreFilters]).map((filter) => (
                <button
                  className={activeFilter === filter ? 'filter active' : 'filter'}
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter === 'Tudo' ? 'Tudo' : `${filter}s`}
                </button>
              ))}
            </div>
          </div>
          <div className="media-grid">
            {visibleItems.map((item) => (
              <MediaCard item={item} key={item.id} onOpen={openShow} />
            ))}
          </div>
          {visibleItems.length === 0 && (
            <div className="empty-state">Nenhum item encontrado na biblioteca.</div>
          )}
        </section>
      </main>
      {selectedMedia && <VideoPlayer key={selectedMedia.mediaId ?? selectedMedia.url} media={selectedMedia} profileId={activeProfileId} capabilities={playerCapabilities} onClose={() => setSelectedMedia(null)} />}
      {reviewOpen && <ReviewPanel items={reviewItems} error={reviewError} onRefresh={refreshReview} onClose={() => setReviewOpen(false)} />}
      {artworkReviewOpen && <ArtworkReviewPanel groups={artworkCandidates} error={artworkCandidatesError} onRefresh={() => { refreshArtworkCandidates(); refreshCatalog() }} onClose={() => setArtworkReviewOpen(false)} />}
      {historyOpen && <CatalogHistoryPanel history={catalogHistory} onRefresh={() => { refreshHistory(); refreshCatalog() }} onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function OfflineSourceNotice({ source }: { source?: MediaSource }) {
  if (!source) return null

  return (
    <aside className="offline-notice" role="status">
      <span className="offline-icon">!</span>
      <div>
        <strong>{source.name} desconectado</strong>
        <p>Conecte o volume <b>{source.volumeLabel}</b> para assistir aos itens armazenados em <code>{source.path}</code>.</p>
      </div>
      <button type="button">Ver itens indisponíveis</button>
    </aside>
  )
}

function Sidebar({
  sources,
  profiles,
  activeProfileId,
  onProfileChange,
  onProfilesChange,
  reviewCount,
  onReview,
  artworkCount,
  onArtworkReview,
  historyCount,
  onHistory,
  catalogRefresh,
  onCatalogRefresh,
  onSourceAdded,
}: {
  sources: typeof mockSources
  profiles: Profile[]
  activeProfileId: string
  onProfileChange: (id: string) => void
  onProfilesChange: (profiles: Profile[]) => void
  reviewCount: number
  onReview: () => void
  artworkCount: number
  onArtworkReview: () => void
  historyCount: number
  onHistory: () => void
  catalogRefresh: CatalogRefreshStatus
  onCatalogRefresh: () => void
  onSourceAdded?: () => void
}) {
  const offlineSources = sources.filter((source) => source.status === 'offline').length
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]
  const [editingProfile, setEditingProfile] = useState<Profile | null | undefined>(undefined)
  const [addingSource, setAddingSource] = useState(false)
  const [sourcePathInput, setSourcePathInput] = useState('')
  const [sourceNameInput, setSourceNameInput] = useState('')
  const [sourceError, setSourceError] = useState('')

  const submitNewSource = async (event: FormEvent) => {
    event.preventDefault()
    setSourceError('')
    try {
      const response = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: sourcePathInput, name: sourceNameInput }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Não foi possível cadastrar a fonte.')
      setSourcePathInput('')
      setSourceNameInput('')
      setAddingSource(false)
      onSourceAdded?.()
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'Não foi possível cadastrar a fonte.')
    }
  }

  return (
    <>
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">S</span>
        <span>{messages.appName}</span>
      </div>
      <ProfileSwitcher
        profiles={profiles}
        activeProfile={activeProfile}
        onProfileChange={onProfileChange}
        onEditProfile={(profile) => setEditingProfile(profile)}
        onCreateProfile={() => setEditingProfile(null)}
      />
      <nav className="main-nav" aria-label="Navegação principal">
        <a className="nav-item active controller-focus" href="#inicio"><span>⌂</span> Início</a>
        <a className="nav-item controller-focus" href="#filmes"><span>▶</span> Filmes</a>
        <a className="nav-item controller-focus" href="#series"><span>▦</span> Séries</a>
      </nav>
      <div className="sidebar-bottom">
        <div className="source-status">
          <span className={offlineSources ? 'status-dot warning' : 'status-dot'} />
          <div><strong>{sources.length} fontes cadastradas</strong><small>{sources.length - offlineSources} conectada(s)</small></div>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <div className="source-item" key={source.id}>
              <span className={source.status === 'offline' ? 'status-dot warning' : 'status-dot'} />
              <div><strong>{source.name}</strong><small>{source.status === 'offline' ? 'Offline · ' : ''}{source.path} · {source.itemCount} itens</small></div>
            </div>
          ))}
        </div>
        {offlineSources > 0 && <small className="offline-count">{offlineSources} fonte aguardando conexão</small>}
        <button className="settings-button controller-focus" type="button" onClick={() => setAddingSource((value) => !value)}>
          + Adicionar fonte
        </button>
        {addingSource && (
          <form className="source-add-form" onSubmit={submitNewSource}>
            <input value={sourcePathInput} onChange={(event) => setSourcePathInput(event.target.value)} placeholder="D:\\Filmes ou https://..." aria-label="Caminho ou URL da fonte" required />
            <input value={sourceNameInput} onChange={(event) => setSourceNameInput(event.target.value)} placeholder="Nome opcional" aria-label="Nome da fonte" />
            {sourceError && <small className="form-error" role="alert">{sourceError}</small>}
            <button className="settings-button controller-focus" type="submit">Salvar fonte</button>
          </form>
        )}
        <button className="settings-button controller-focus" type="button" onClick={onCatalogRefresh} disabled={catalogRefresh.state === 'running'}>
          ⚙ Atualizar catálogo
        </button>
        <small className="catalog-refresh-status" role="status">
          {catalogRefresh.state === 'running' ? 'Atualização em andamento…' : catalogRefresh.state === 'succeeded' ? 'Catálogo atualizado.' : catalogRefresh.state === 'failed' ? `Falha: ${catalogRefresh.error}` : 'Configurações e catálogo'}
        </small>
        <button className="settings-button controller-focus" type="button" onClick={onReview}>⚑ Revisão {reviewCount > 0 ? `(${reviewCount})` : ''}</button>
        <button className="settings-button controller-focus" type="button" onClick={onArtworkReview}>🖼 Arte {artworkCount > 0 ? `(${artworkCount})` : ''}</button>
        <button className="settings-button controller-focus" type="button" onClick={onHistory}>↶ Histórico {historyCount > 0 ? `(${historyCount})` : ''}</button>
      </div>
    </aside>
    {editingProfile !== undefined && (
      <ProfileEditor
        profile={editingProfile}
        onClose={() => setEditingProfile(undefined)}
        onSaved={(profile) => {
          onProfilesChange(profiles.some((item) => item.id === profile.id)
            ? profiles.map((item) => item.id === profile.id ? profile : item)
            : [...profiles, profile])
          onProfileChange(profile.id)
          setEditingProfile(undefined)
        }}
      />
    )}
    </>
  )
}

type CatalogRefreshStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed'
  startedAt?: string | null
  finishedAt?: string | null
  sourceIds: string[]
  results: Array<{ sourceId: string; status: string; message: string }>
  error?: string | null
}

type ArtworkCandidate = {
  id: string
  provider: string
  providerId: string
  title: string
  year?: number
  overview?: string
  posterUrl?: string
  backdropUrl?: string
  language?: string
}

type ArtworkCandidateGroup = {
  targetType: 'movie' | 'show'
  targetId: string
  title: string
  year?: number
  candidates: ArtworkCandidate[]
}

function ArtworkReviewPanel({
  groups,
  error,
  onRefresh,
  onClose,
}: {
  groups: ArtworkCandidateGroup[]
  error: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [savingId, setSavingId] = useState('')
  const [actionError, setActionError] = useState('')

  const act = async (candidateId: string, operation: 'approve' | 'reject') => {
    setSavingId(candidateId)
    setActionError('')
    try {
      const response = await fetch(`/api/artwork/candidates/${encodeURIComponent(candidateId)}/${operation}`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Não foi possível processar o candidato de arte.')
      }
      onRefresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível processar o candidato de arte.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="review-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="review-panel" role="dialog" aria-modal="true" aria-label="Revisão de correspondências de arte" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-heading">
          <div>
            <p className="eyebrow">METADADOS E ARTE</p>
            <h2>Revisão de correspondências</h2>
          </div>
          <button className="controller-focus" type="button" autoFocus aria-label="Fechar revisão de arte" onClick={onClose}>×</button>
        </div>
        <p className="review-note">
          Correspondências ambíguas não são aplicadas automaticamente. Confirme o candidato correto antes de salvar a arte e a sinopse no catálogo.
        </p>
        {error && <p className="form-error" role="alert">Falha ao carregar candidatos: {error}</p>}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {groups.length === 0 && (
          <p className="empty-state">Nenhuma correspondência ambígua aguardando confirmação. Execute `npm run artwork` para coletar metadados e candidatos.</p>
        )}
        <div className="review-list">
          {groups.map((group) => (
            <article className="review-item artwork-group" key={`${group.targetType}:${group.targetId}`}>
              <div>
                <strong>{group.title} {group.year ? `(${group.year})` : ''}</strong>
                <small>{group.targetType === 'show' ? 'Série' : 'Filme'} · {group.candidates.length} candidato(s)</small>
              </div>
              <div className="artwork-candidates-grid">
                {group.candidates.map((candidate) => {
                  const preview = candidate.posterUrl || candidate.backdropUrl
                  return (
                    <div className="artwork-candidate-card" key={candidate.id}>
                      {preview && <img className="artwork-candidate-preview" src={preview} alt={candidate.title} />}
                      <div className="artwork-candidate-body">
                        <strong>{candidate.title} {candidate.year ? `(${candidate.year})` : ''}</strong>
                        <small>{candidate.provider.toUpperCase()}{candidate.language ? ` · ${candidate.language}` : ''}</small>
                        {candidate.overview && <p>{candidate.overview.slice(0, 180)}{candidate.overview.length > 180 ? '…' : ''}</p>}
                        <div className="review-actions">
                          <button type="button" className="controller-focus" disabled={savingId === candidate.id} onClick={() => void act(candidate.id, 'approve')}>
                            Confirmar e aplicar
                          </button>
                          <button type="button" className="controller-focus" disabled={savingId === candidate.id} onClick={() => void act(candidate.id, 'reject')}>
                            Descartar
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

type CatalogHistory = {
  archived: Array<{ id: string; title: string; kind: string; deletedAt: string; relativePath: string; sourceName: string }>
  titleChanges: Array<{ id: string; mediaItemId: string; oldTitle: string; newTitle: string; reason: string; createdAt: string; currentTitle: string; deletedAt?: string; relativePath: string; sourceName: string }>
}

function CatalogHistoryPanel({ history, onRefresh, onClose }: { history: CatalogHistory; onRefresh: () => void; onClose: () => void }) {
  const [savingId, setSavingId] = useState('')
  const action = async (url: string) => {
    setSavingId(url)
    try {
      const response = await fetch(url, { method: 'POST' })
      if (!response.ok) throw new Error('Não foi possível restaurar o registro.')
      onRefresh()
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="review-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="review-panel" role="dialog" aria-modal="true" aria-label="Histórico do catálogo" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Histórico e restauração</h2></div><button className="controller-focus" type="button" autoFocus aria-label="Fechar histórico" onClick={onClose}>×</button></div>
        <p className="history-note">As ações alteram somente o catálogo; nenhum arquivo físico é movido ou apagado.</p>
        <h3>Itens arquivados</h3>
        <div className="review-list">
          {history.archived.map((item) => (
            <article className="review-item history-item" key={item.id}>
              <div><strong>{item.title}</strong><small>{item.sourceName} · {item.relativePath}</small><small>Arquivado em {new Date(item.deletedAt).toLocaleString('pt-BR')}</small></div>
              <button type="button" disabled={savingId.endsWith(item.id)} onClick={() => void action(`/api/catalog/${encodeURIComponent(item.id)}/restore`)}>Restaurar</button>
            </article>
          ))}
          {history.archived.length === 0 && <p className="empty-state">Nenhum item arquivado.</p>}
        </div>
        <h3>Alterações de título</h3>
        <div className="review-list">
          {history.titleChanges.map((change) => (
            <article className="review-item history-item" key={change.id}>
              <div><strong>{change.oldTitle} → {change.newTitle}</strong><small>{change.sourceName} · {change.relativePath}</small><small>{change.reason} · {new Date(change.createdAt).toLocaleString('pt-BR')}</small></div>
              <button type="button" disabled={savingId.endsWith(change.id)} onClick={() => void action(`/api/catalog/title-history/${encodeURIComponent(change.id)}/restore`)}>Restaurar título anterior</button>
            </article>
          ))}
          {history.titleChanges.length === 0 && <p className="empty-state">Nenhuma alteração de título registrada.</p>}
        </div>
      </section>
    </div>
  )
}

function ReviewPanel({
  items,
  error,
  onRefresh,
  onClose,
}: {
  items: ReviewItem[]
  error: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [savingId, setSavingId] = useState('')
  const [actionError, setActionError] = useState('')
  const displayTitle = (item: ReviewItem) => item.title || item.relativePath.split('\\').pop() || item.relativePath
  const [drafts, setDrafts] = useState(() => Object.fromEntries(items.map((item) => [item.id, displayTitle(item)])))

  const update = async (item: ReviewItem, action: 'correct_movie' | 'approve_other' | 'ignore') => {
    setSavingId(item.id)
    setActionError('')
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, title: drafts[item.id] }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Não foi possível atualizar o item.')
      }
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível atualizar o item.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="review-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="review-panel" role="dialog" aria-modal="true" aria-label="Itens para revisão" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Itens para revisar</h2></div><button className="controller-focus" type="button" autoFocus aria-label="Fechar revisão" onClick={onClose}>×</button></div>
        <p className="review-note">Escolha exatamente o destino do item. A revisão altera somente o catálogo e nunca move, renomeia ou apaga o arquivo original.</p>
        {error && <p className="form-error" role="alert">Falha ao carregar a revisão: {error}</p>}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {items.length === 0 && <p className="empty-state">Nenhum item aguardando revisão.</p>}
        <div className="review-list">
          {items.map((item) => (
            <article className="review-item" key={item.id}>
              <div><strong>{displayTitle(item)}</strong><small>{item.sourceName} · {item.relativePath}</small><small>{item.reason || 'Classificação manual necessária.'}</small></div>
              <input value={drafts[item.id] ?? displayTitle(item)} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`Título de ${displayTitle(item)}`} />
              <div className="review-actions">
                <button type="button" disabled={savingId === item.id} onClick={() => void update(item, 'correct_movie')}>Corrigir como filme</button>
                <button type="button" disabled={savingId === item.id} onClick={() => void update(item, 'approve_other')}>Aprovar como especial/outro</button>
                <button type="button" disabled={savingId === item.id} onClick={() => void update(item, 'ignore')}>Ignorar</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ProfileSwitcher({
  profiles,
  activeProfile,
  onProfileChange,
  onEditProfile,
  onCreateProfile,
}: {
  profiles: Profile[]
  activeProfile?: Profile
  onProfileChange: (id: string) => void
  onEditProfile: (profile: Profile) => void
  onCreateProfile: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!activeProfile) return null

  return (
    <div className="profile-switcher">
      <button className="profile-button controller-focus" type="button" onClick={() => setOpen(!open)}>
        <span className={`profile-avatar avatar-${activeProfile.avatarKey}`}>{activeProfile.avatarKey === 'cartman' ? 'C' : activeProfile.name[0]}</span>
        <span><strong>{activeProfile.name}</strong><small>Trocar perfil</small></span>
        <span className="profile-chevron">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="profile-menu">
          <p>Quem está assistindo?</p>
          {profiles.map((profile) => (
            <button
              className="profile-option controller-focus"
              type="button"
              key={profile.id}
              onClick={() => { onProfileChange(profile.id); setOpen(false) }}
            >
              <span className={`profile-avatar avatar-${profile.avatarKey}`}>{profile.avatarKey === 'cartman' ? 'C' : profile.name[0]}</span>
              <span>{profile.name}</span>
              {profile.id === activeProfile.id && <b>✓</b>}
              <span className="profile-edit" onClick={(event) => { event.stopPropagation(); onEditProfile(profile) }}>Editar</span>
            </button>
          ))}
          <button className="profile-add controller-focus" type="button" onClick={onCreateProfile}>＋ Criar perfil</button>
        </div>
      )}
    </div>
  )
}

const avatarPresets = ['cartman', 'south-park', 'ben-10', 'savino'] as const

function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null
  onClose: () => void
  onSaved: (profile: Profile) => void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [avatarKey, setAvatarKey] = useState(profile?.avatarKey ?? avatarPresets[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: profile?.id, name, avatarKey }),
      })
      if (!response.ok) throw new Error('Não foi possível salvar o perfil.')
      onSaved(await response.json())
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-modal-backdrop" role="presentation">
      <form className="profile-modal" onSubmit={save}>
        <div className="profile-modal-heading">
          <div><p className="eyebrow">PERFIL</p><h2>{profile ? 'Editar perfil' : 'Criar perfil'}</h2></div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} autoFocus /></label>
        <fieldset><legend>Avatar</legend><div className="avatar-presets">
          {avatarPresets.map((preset) => (
            <button className={avatarKey === preset ? 'avatar-preset selected' : 'avatar-preset'} type="button" key={preset} onClick={() => setAvatarKey(preset)}>
              <span className={`profile-avatar avatar-${preset}`}>{preset === 'cartman' ? 'C' : preset === 'south-park' ? 'S' : preset === 'ben-10' ? 'B' : 'S'}</span>
              <small>{preset}</small>
            </button>
          ))}
        </div></fieldset>
        {error && <p className="profile-error">{error}</p>}
        <div className="profile-modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar perfil'}</button></div>
      </form>
    </div>
  )
}

function ShowHeader({
  show,
  profileId,
  onPlay,
  onSearchArtwork,
  onCatalogUpdated,
  onArchived,
}: {
  show: LibraryItem
  profileId: string
  onPlay: (media: { title: string; url: string; subtitleUrl?: string; mediaId?: string }) => void
  onSearchArtwork?: (show: LibraryItem) => void
  onCatalogUpdated?: () => void
  onArchived?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(show.title)
  const [draftYear, setDraftYear] = useState(show.year ? String(show.year) : '')
  const [draftOverview, setDraftOverview] = useState(show.overview ?? '')
  const [draftTags, setDraftTags] = useState((show.tags ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const targetId = show.kind === 'Série' ? show.id : (show.mediaId ?? show.id)

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setEditError('')
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(targetId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          year: draftYear ? Number(draftYear) : null,
          overview: draftOverview,
          tags: draftTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Não foi possível salvar os metadados.')
      setEditing(false)
      onCatalogUpdated?.()
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Não foi possível salvar os metadados.')
    } finally {
      setSaving(false)
    }
  }

  const archiveItem = async () => {
    if (!show.mediaId) return
    setSaving(true)
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(show.mediaId)}/archive`, { method: 'POST' })
      if (response.ok) onArchived?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="show-header">
      <div className={`show-poster poster ${show.posterClass}`} style={show.artwork.bannerUrl ? { backgroundImage: `url(${show.artwork.bannerUrl})` } : undefined}>
        {show.artwork.posterUrl && <img className="poster-image" src={show.artwork.posterUrl} alt="" />}
        {!show.artwork.posterUrl && <strong>{show.title}</strong>}
      </div>
      <div className="show-copy">
        <p className="eyebrow">{show.kind.toUpperCase()}</p>
        <h1>{show.title}</h1>
        <p className="show-description">{show.overview || 'Descrição ainda não cadastrada para este título.'}</p>
        <div className="show-stats">
          {show.year && <span>{show.year}</span>}
          <span>{show.meta}</span>
          <span>{show.detail}</span>
          {show.genres?.map((genre) => <span key={genre}>{genre}</span>)}
        </div>
        {show.kind === 'Filme' && <p className="subtitle-summary">{show.subtitles?.length ? `Legendas locais: ${show.subtitles.map((subtitle) => subtitle.label).join(', ')}` : 'Sem legenda local cadastrada'}</p>}
        <RatingControl profileId={profileId} mediaId={show.kind === 'Filme' ? show.mediaId : undefined} showId={show.kind === 'Série' ? show.id : undefined} />
        <div className="detail-actions">
          {show.kind === 'Filme' && show.mediaUrl && <button className="primary-button detail-play" type="button" onClick={() => onPlay({ title: show.title, url: show.mediaUrl!, subtitleUrl: show.subtitleUrl, mediaId: show.mediaId })}>▶ Assistir</button>}
          {onSearchArtwork && <button className="settings-button controller-focus" type="button" onClick={() => onSearchArtwork(show)}>🖼 Buscar arte/metadados</button>}
          <button className="settings-button controller-focus" type="button" onClick={() => setEditing((value) => !value)}>✎ Editar metadados</button>
          {show.kind === 'Filme' && show.mediaId && <button className="settings-button controller-focus" type="button" disabled={saving} onClick={() => void archiveItem()}>Arquivar</button>}
        </div>
        {editing && (
          <form className="metadata-edit-form" onSubmit={saveMetadata}>
            <label>Título<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required /></label>
            <label>Ano<input type="number" min="1900" max="2100" value={draftYear} onChange={(event) => setDraftYear(event.target.value)} /></label>
            {show.kind === 'Filme' && <label>Tags (separadas por vírgula)<input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} /></label>}
            <label>Sinopse<textarea rows={3} value={draftOverview} onChange={(event) => setDraftOverview(event.target.value)} /></label>
            {editError && <small className="form-error" role="alert">{editError}</small>}
            <div className="detail-actions">
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar metadados'}</button>
              <button className="settings-button" type="button" onClick={() => setEditing(false)}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function RatingControl({ profileId, mediaId, showId }: { profileId: string; mediaId?: string; showId?: string }) {
  const [score, setScore] = useState<number | null>(null)
  const [review, setReview] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams({ profileId })
    if (mediaId) params.set('mediaId', mediaId)
    if (showId) params.set('showId', showId)
    fetch(`/api/rating?${params}`)
      .then((response) => response.ok ? response.json() : null)
      .then((rating) => {
        setScore(rating?.score ?? null)
        setReview(rating?.review ?? '')
      })
      .catch(() => undefined)
  }, [mediaId, profileId, showId])

  const save = async () => {
    if (score === null) return
    const response = await fetch('/api/rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, mediaId, showId, score, review }),
    })
    if (response.ok) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    }
  }

  return (
    <div className="rating-control">
      <div className="rating-heading"><span>Sua avaliação</span><small>{saved ? 'Salva' : `Perfil: ${profileId === 'profile-savio' ? 'Savio' : 'Família'}`}</small></div>
      <div className="rating-score">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
          <button type="button" key={value} className={score === value ? 'rating-choice selected' : 'rating-choice'} onClick={() => setScore(value)} aria-label={`Nota ${value}`}>{value}</button>
        ))}
      </div>
      <div className="rating-footer">
        <input value={review} onChange={(event) => setReview(event.target.value)} maxLength={500} placeholder="Comentário opcional" />
        <button type="button" onClick={() => void save()} disabled={score === null}>Salvar</button>
      </div>
    </div>
  )
}

function MediaCard({ item, onOpen }: { item: LibraryItem; onOpen: (item: LibraryItem) => void }) {
  const openItem = () => onOpen(item)

  return (
    <article className="media-card">
      <button className={`poster ${item.posterClass} controller-focus`} type="button" aria-label={`Abrir ${item.title}`} onClick={openItem}>
        {item.artwork.posterUrl && <img className="poster-image" src={item.artwork.posterUrl} alt="" />}
        <span className="poster-kind">{item.kind}</span>
        {item.id === 'south-park' && <strong>South<br />Park</strong>}
        {item.id === 'marighella' && <strong>MARIGHELLA</strong>}
        {item.id === 'a-fuga-do-planeta-terra' && <strong>A FUGA<br />DO PLANETA<br />TERRA</strong>}
        {item.progress && <span className="progress-track"><span style={{ width: `${item.progress}%` }} /></span>}
      </button>
      <div className="card-copy">
        <div>
          <button className="card-title-button controller-focus" type="button" onClick={openItem}>{item.title}</button>
          <p>{item.meta}</p>
        </div>
        <span className="more-button" aria-hidden="true">···</span>
      </div>
      <div className="card-tags">{item.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>
      <small className="card-detail">{item.detail}</small>
    </article>
  )
}

function EpisodeRow({ episode, onPlay }: { episode: Episode; onPlay: (media: { title: string; url: string; subtitleUrl?: string; mediaId?: string }) => void }) {
  const watched = episode.progress !== undefined

  return (
    <article className={watched ? 'episode-row current' : 'episode-row'}>
      <div className="episode-number">{episode.number.toString().padStart(2, '0')}</div>
      <div className="episode-info">
        <div className="episode-title-line">
          <h3>{episode.title}</h3>
          {watched && <span className="now-badge">VOCÊ ESTÁ AQUI</span>}
        </div>
        <p>{episode.filename}</p>
        <div className="episode-meta">
          <span>{episode.duration}</span>
          <span>{episode.subtitles[0].available ? 'CC PT-BR' : 'Sem legenda cadastrada'}</span>
          {watched && <span>Parado em {episode.position}</span>}
        </div>
        {watched && <span className="episode-progress"><span style={{ width: `${episode.progress}%` }} /></span>}
      </div>
      <button className="episode-play controller-focus" type="button" onClick={() => episode.mediaUrl && onPlay({ title: episode.title, url: episode.mediaUrl, subtitleUrl: episode.subtitleUrl, mediaId: episode.mediaId })}>{watched ? 'Continuar' : 'Assistir'}</button>
    </article>
  )
}

function VideoPlayer({ media, profileId, capabilities, onClose }: { media: { title: string; url: string; subtitleUrl?: string; mediaId?: string }; profileId: string; capabilities: { ffmpeg: boolean; transcoding?: boolean; ffprobe: boolean; vlc: boolean } | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastSavedPosition = useRef(0)
  const pendingPosition = useRef(0)
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ label: string; url: string }>>([])
  const [subtitleUrl, setSubtitleUrl] = useState('')
  const [streamInfo, setStreamInfo] = useState<{ available: boolean; reason?: string; audio: Array<{ index: number; language?: string; title?: string; codec?: string }>; subtitles: Array<{ index: number; language?: string; title?: string; codec?: string }> } | null>(null)
  const [audioStream, setAudioStream] = useState('')
  const [subtitleStream, setSubtitleStream] = useState('')
  const [playbackUrl, setPlaybackUrl] = useState(media.url)
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [onlineSubtitlesOpen, setOnlineSubtitlesOpen] = useState(false)
  const [onlineSubtitlesLoading, setOnlineSubtitlesLoading] = useState(false)
  const [onlineSubtitlesMessage, setOnlineSubtitlesMessage] = useState('')
  const [onlineSubtitlesResults, setOnlineSubtitlesResults] = useState<Array<{ fileId: number; language: string; release: string; downloads: number; hearingImpaired: boolean }>>([])
  const [downloadingSubtitleId, setDownloadingSubtitleId] = useState<number | null>(null)

  useEffect(() => {
    if (!media.mediaId) return
    fetch(`/api/progress?profileId=${encodeURIComponent(profileId)}&mediaId=${encodeURIComponent(media.mediaId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((progress) => {
        if (progress?.position && videoRef.current) videoRef.current.currentTime = progress.position
      })
      .catch(() => undefined)
  }, [media.mediaId, profileId])

  const saveProgress = useCallback(() => {
    const video = videoRef.current
    if (!video || !media.mediaId || video.duration === Infinity || Number.isNaN(video.duration)) return
    if (Math.abs(video.currentTime - lastSavedPosition.current) < 5 && video.currentTime < video.duration - 2) return
    lastSavedPosition.current = video.currentTime
    void fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId,
        mediaId: media.mediaId,
        position: video.currentTime,
        duration: video.duration,
        watched: video.currentTime >= video.duration * 0.9,
      }),
    })
  }, [media.mediaId, profileId])

  useEffect(() => () => saveProgress(), [saveProgress])

  useEffect(() => {
    if (!media.subtitleUrl) return
    fetch(media.subtitleUrl)
      .then((response) => response.ok ? response.json() : [])
      .then((tracks) => setSubtitleTracks(tracks))
      .catch(() => setSubtitleTracks([]))
  }, [media.subtitleUrl])

  useEffect(() => {
    if (!media.mediaId) return
    fetch(`/api/media/${encodeURIComponent(media.mediaId)}/streams`)
      .then((response) => response.ok ? response.json() : null)
      .then(setStreamInfo)
      .catch(() => setStreamInfo(null))
  }, [media.mediaId])

  const changeAudioStream = (value: string) => {
    setAudioStream(value)
    if (!value) {
      pendingPosition.current = videoRef.current?.currentTime ?? 0
      setPlaybackUrl(media.url)
      return
    }
    if (!media.mediaId || !capabilities?.transcoding) return
    pendingPosition.current = videoRef.current?.currentTime ?? 0
    setPlaybackUrl(`/api/media/${encodeURIComponent(media.mediaId)}/transcode?format=mp4&audioStream=${encodeURIComponent(value)}`)
  }

  const changeSubtitleStream = (value: string) => {
    setSubtitleStream(value)
    if (!value) {
      pendingPosition.current = videoRef.current?.currentTime ?? 0
      setPlaybackUrl(audioStream
        ? `/api/media/${encodeURIComponent(media.mediaId!)}/transcode?format=mp4&audioStream=${encodeURIComponent(audioStream)}`
        : media.url)
      return
    }
    if (!media.mediaId || !capabilities?.transcoding) return
    pendingPosition.current = videoRef.current?.currentTime ?? 0
    setPlaybackUrl(`/api/media/${encodeURIComponent(media.mediaId)}/transcode?format=mp4&audioStream=${encodeURIComponent(audioStream || '0')}&subtitleStream=${encodeURIComponent(value)}`)
  }

  const restorePosition = () => {
    if (pendingPosition.current > 0 && videoRef.current) {
      videoRef.current.currentTime = pendingPosition.current
      pendingPosition.current = 0
    }
  }

  const seek = (seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime += seconds
  }

  const changeRate = (value: number) => {
    setRate(value)
    if (videoRef.current) videoRef.current.playbackRate = value
  }

  const changeVolume = (value: number) => {
    setVolume(value)
    if (videoRef.current) videoRef.current.volume = value
  }

  const toggleFullscreen = () => {
    void videoRef.current?.requestFullscreen()
  }

  const searchOnlineSubtitles = async () => {
    if (!media.mediaId) return
    setOnlineSubtitlesLoading(true)
    setOnlineSubtitlesMessage('')
    try {
      const response = await fetch(`/api/media/${encodeURIComponent(media.mediaId)}/subtitles/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: media.title }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Não foi possível buscar legendas online.')
      setOnlineSubtitlesResults(Array.isArray(body?.results) ? body.results : [])
      if (body?.message) setOnlineSubtitlesMessage(body.message)
      else if (Array.isArray(body?.results) && body.results.length === 0) setOnlineSubtitlesMessage('Nenhuma legenda encontrada no OpenSubtitles.')
    } catch (error) {
      setOnlineSubtitlesMessage(error instanceof Error ? error.message : 'Erro ao consultar OpenSubtitles.')
    } finally {
      setOnlineSubtitlesLoading(false)
    }
  }

  const confirmDownloadSubtitle = async (candidate: { fileId: number; language: string; release: string; hearingImpaired: boolean }) => {
    if (!media.mediaId) return
    setDownloadingSubtitleId(candidate.fileId)
    setOnlineSubtitlesMessage('')
    try {
      const response = await fetch(`/api/media/${encodeURIComponent(media.mediaId)}/subtitles/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: candidate.fileId,
          language: candidate.language,
          label: `${candidate.language.toUpperCase()} (${candidate.release.slice(0, 28)})`,
          hearingImpaired: candidate.hearingImpaired,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || 'Não foi possível baixar a legenda.')
      if (Array.isArray(body?.tracks)) setSubtitleTracks(body.tracks)
      setOnlineSubtitlesMessage('Legenda baixada e registrada com sucesso.')
    } catch (error) {
      setOnlineSubtitlesMessage(error instanceof Error ? error.message : 'Erro ao baixar legenda.')
    } finally {
      setDownloadingSubtitleId(null)
    }
  }

  return (
    <div className="player-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="player-modal" role="dialog" aria-modal="true" aria-label={`Reproduzindo ${media.title}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="player-heading">
          <div><span>ASSISTINDO AGORA</span><strong>{media.title}</strong></div>
          <button className="player-close controller-focus" type="button" autoFocus aria-label="Fechar player" onClick={onClose}>×</button>
        </div>
        <video ref={videoRef} className="video-player" src={playbackUrl} controls autoPlay playsInline onLoadedMetadata={restorePosition} onTimeUpdate={saveProgress} onEnded={saveProgress}>
          {subtitleUrl && <track kind="subtitles" srcLang="pt-BR" label="Português" src={subtitleUrl} default />}
          {media.mediaId && streamInfo?.available && capabilities?.ffmpeg && streamInfo.subtitles.map((track) => (
            <track
              key={`embedded-${track.index}`}
              kind="subtitles"
              srcLang={track.language || 'und'}
              label={`Embutida · ${track.title || track.language || `Faixa ${track.index + 1}`}`}
              src={`/api/media/${encodeURIComponent(media.mediaId!)}/subtitles/embedded/${track.index}`}
            />
          ))}
        </video>
        <div className="player-controls">
          <button type="button" onClick={() => seek(-10)}>↶ 10s</button>
          <button type="button" onClick={() => seek(10)}>10s ↷</button>
          <label>Velocidade<select value={rate} onChange={(event) => changeRate(Number(event.target.value))}>
            {[0.75, 1, 1.25, 1.5, 2].map((value) => <option value={value} key={value}>{value}x</option>)}
          </select></label>
          <label>Volume<input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} /></label>
          {subtitleTracks.length > 0 && <label>Legenda<select value={subtitleUrl} onChange={(event) => setSubtitleUrl(event.target.value)}>
            <option value="">Sem legenda</option>
            {subtitleTracks.map((track) => <option value={track.url} key={track.url}>{track.label}</option>)}
          </select></label>}
          {streamInfo?.available && capabilities?.transcoding && streamInfo.audio.length > 0 && <label>Áudio<select value={audioStream} onChange={(event) => changeAudioStream(event.target.value)}>
            <option value="">Original</option>
            {streamInfo.audio.map((track) => <option value={track.index} key={track.index}>{track.title || track.language || `Faixa ${track.index + 1}`}</option>)}
          </select></label>}
          {streamInfo?.available && capabilities?.transcoding && streamInfo.subtitles.length > 0 && <label>Legenda embutida<select value={subtitleStream} onChange={(event) => changeSubtitleStream(event.target.value)}>
            <option value="">Original</option>
            {streamInfo.subtitles.map((track) => <option value={track.index} key={track.index}>{track.title || track.language || `Faixa ${track.index + 1}`}</option>)}
          </select></label>}
          {media.mediaId && <button type="button" onClick={() => { const next = !onlineSubtitlesOpen; setOnlineSubtitlesOpen(next); if (next && onlineSubtitlesResults.length === 0) void searchOnlineSubtitles() }}>Legendas online</button>}
          <button type="button" onClick={toggleFullscreen}>Tela cheia</button>
        </div>
        {onlineSubtitlesOpen && (
          <div className="subtitle-search-box">
            <div className="subtitle-search-header">
              <strong>OpenSubtitles (com confirmação)</strong>
              <button type="button" disabled={onlineSubtitlesLoading} onClick={() => void searchOnlineSubtitles()}>
                {onlineSubtitlesLoading ? 'Buscando…' : 'Buscar novamente'}
              </button>
            </div>
            {onlineSubtitlesMessage && <small>{onlineSubtitlesMessage}</small>}
            {onlineSubtitlesResults.length > 0 && (
              <div className="subtitle-search-list">
                {onlineSubtitlesResults.map((item) => (
                  <div className="subtitle-search-item" key={item.fileId}>
                    <span>{item.language.toUpperCase()} · {item.release} ({item.downloads} downloads){item.hearingImpaired ? ' · CC' : ''}</span>
                    <button type="button" disabled={downloadingSubtitleId === item.fileId} onClick={() => void confirmDownloadSubtitle(item)}>
                      {downloadingSubtitleId === item.fileId ? 'Baixando…' : 'Baixar legenda'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {streamInfo?.available && <small>
          Faixas internas detectadas: {streamInfo.audio.length} áudio(s) e {streamInfo.subtitles.length} legenda(s).
          A seleção usa transcodificação MP4 quando FFmpeg está disponível.
        </small>}
        {streamInfo && !streamInfo.available && <small>Faixas internas indisponíveis: FFprobe não está disponível. O player continua usando a reprodução original e as legendas externas.</small>}
        <small>{capabilities?.ffmpeg || capabilities?.vlc
          ? 'FFmpeg/VLC disponível; MKV/AVI usam transcodificação somente quando uma faixa for selecionada.'
          : 'Player web ativo. FFmpeg não disponível: transcoding sob demanda indisponível; a reprodução atual permanece inalterada.'}</small>
      </section>
    </div>
  )
}

function useGamepadNavigation() {
  const previousButtons = useRef<boolean[]>([])
  const previousAxes = useRef<ReadonlyArray<number>>([])

  useEffect(() => {
    if (!navigator.getGamepads) return

    const getFocusable = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
      const scope = dialog ?? document
      return Array.from(scope.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return !element.matches(':disabled')
          && element.getAttribute('aria-hidden') !== 'true'
          && !element.closest('[aria-hidden="true"]')
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
      })
    }

    const moveFocus = (direction: 'up' | 'down' | 'left' | 'right', focusable: HTMLElement[]) => {
      const current = document.activeElement as HTMLElement | null
      const currentRect = current?.getBoundingClientRect()
      if (!current || !currentRect || !focusable.includes(current)) {
        focusable[0]?.focus()
        return
      }

      const currentX = currentRect.left + currentRect.width / 2
      const currentY = currentRect.top + currentRect.height / 2
      const candidates = focusable
        .filter((element) => element !== current)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          const y = rect.top + rect.height / 2
          const primary = direction === 'left' ? currentX - x
            : direction === 'right' ? x - currentX
              : direction === 'up' ? currentY - y
                : y - currentY
          const secondary = direction === 'left' || direction === 'right' ? Math.abs(y - currentY) : Math.abs(x - currentX)
          return { element, score: primary + secondary * 1.5 }
        })
        .filter(({ score }) => score > 4)
        .sort((a, b) => a.score - b.score)

      candidates[0]?.element.focus()
    }

    const timer = window.setInterval(() => {
      const gamepad = Array.from(navigator.getGamepads()).find(Boolean)
      if (!gamepad) {
        previousButtons.current = []
        previousAxes.current = []
        return
      }

      const buttons = gamepad.buttons.map((button) => button.pressed)
      const previous = previousButtons.current
      const pressed = (index: number) => buttons[index] && !previous[index]
      const focusable = getFocusable()
      if (focusable.length === 0) return

      if (pressed(0)) {
        const active = document.activeElement as HTMLElement | null
        if (active && focusable.includes(active)) active.click()
        else focusable[0]?.focus()
      }

      if (pressed(1) || pressed(9)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      }

      const horizontalAxis = gamepad.axes[0] ?? 0
      const wasHorizontal = previousAxes.current[0] ?? 0
      const verticalAxis = gamepad.axes[1] ?? 0
      const wasVertical = previousAxes.current[1] ?? 0

      if (horizontalAxis > 0.6 && wasHorizontal <= 0.6) {
        moveFocus('right', focusable)
      }

      if (horizontalAxis < -0.6 && wasHorizontal >= -0.6) {
        moveFocus('left', focusable)
      }

      if (verticalAxis > 0.6 && wasVertical <= 0.6) {
        moveFocus('down', focusable)
      }

      if (verticalAxis < -0.6 && wasVertical >= -0.6) {
        moveFocus('up', focusable)
      }

      previousButtons.current = buttons
      previousAxes.current = gamepad.axes
    }, 100)

    return () => window.clearInterval(timer)
  }, [])
}

export default App
