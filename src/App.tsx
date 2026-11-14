import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { library as mockLibrary, mediaSources as mockSources } from './data/mockCatalog'
import { profiles as mockProfiles } from './data/mockCatalog'
import type { Episode, LibraryItem, MediaKind, MediaSource, Profile } from './domain/catalog'
import { messages } from './config/messages'
import './App.css'

type LibraryFilter = 'Tudo' | MediaKind | string

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
  const [playerCapabilities, setPlayerCapabilities] = useState<{ ffmpeg: boolean; ffprobe: boolean; vlc: boolean } | null>(null)
  const [reviewItems, setReviewItems] = useState<Array<{ id: string; title: string; kind: string; reason?: string; relativePath: string; sourceName: string; sourcePath: string }>>([])
  const [reviewOpen, setReviewOpen] = useState(false)

  useEffect(() => {
    fetch('/api/player/capabilities')
      .then((response) => response.ok ? response.json() : null)
      .then(setPlayerCapabilities)
      .catch(() => undefined)
  }, [])

  const refreshReview = useCallback(() => {
    fetch('/api/review')
      .then((response) => response.ok ? response.json() : [])
      .then(setReviewItems)
      .catch(() => setReviewItems([]))
  }, [])

  useEffect(() => {
    refreshReview()
  }, [refreshReview])

  useEffect(() => {
    Promise.all([
      fetch(`/api/library?profileId=${encodeURIComponent(activeProfileId)}`).then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/sources').then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/profiles').then((response) => response.ok ? response.json() : Promise.reject(response)),
    ]).then(([remoteLibrary, remoteSources, remoteProfiles]) => {
      setCatalog(remoteLibrary)
      setSources(remoteSources)
      setProfiles(remoteProfiles)
    }).catch(() => {
      console.warn('API local indisponível; usando o catálogo de demonstração.')
    })
  }, [activeProfileId])

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

      if (event.key === '/' && event.target instanceof HTMLElement && event.target.tagName !== 'INPUT') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search-box input')?.focus()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [selectedMedia, selectedShow])

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

  const openShow = (show: LibraryItem) => {
    setSelectedShow(show)
    setSelectedSeason(show.seasons?.[0]?.number ?? 1)
    window.history.pushState({}, '', `/${show.kind === 'Série' ? 'series' : 'filmes'}/${encodeURIComponent(show.id)}`)
  }

  const closeShow = () => {
    setSelectedShow(null)
    window.history.pushState({}, '', '/inicio')
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
        <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} reviewCount={reviewItems.length} onReview={() => setReviewOpen(true)} />
        <main className="content">
          <button className="back-button" type="button" onClick={closeShow}>
            ← Voltar para biblioteca
          </button>
          <ShowHeader show={selectedShow} profileId={activeProfileId} onPlay={setSelectedMedia} />
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
        {selectedMedia && <VideoPlayer media={selectedMedia} profileId={activeProfileId} capabilities={playerCapabilities} onClose={() => setSelectedMedia(null)} />}
        {reviewOpen && <ReviewPanel items={reviewItems} onRefresh={refreshReview} onClose={() => setReviewOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} reviewCount={reviewItems.length} onReview={() => setReviewOpen(true)} />
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
            <h2>South Park</h2>
            <p>Temporada 1 · Episódio 6 · 13:24 de 22:00</p>
            <button className="primary-button" type="button" onClick={() => {
              const southPark = catalog.find((item) => item.title.toLocaleLowerCase() === 'south park' && item.kind === 'Série')
              if (southPark) openShow(southPark)
            }}>
              <span>▶</span> Continuar
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span>South</span>
            <strong>Park</strong>
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
      {selectedMedia && <VideoPlayer media={selectedMedia} profileId={activeProfileId} capabilities={playerCapabilities} onClose={() => setSelectedMedia(null)} />}
      {reviewOpen && <ReviewPanel items={reviewItems} onRefresh={refreshReview} onClose={() => setReviewOpen(false)} />}
    </div>
  )
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
}: {
  sources: typeof mockSources
  profiles: Profile[]
  activeProfileId: string
  onProfileChange: (id: string) => void
  onProfilesChange: (profiles: Profile[]) => void
  reviewCount: number
  onReview: () => void
}) {
  const offlineSources = sources.filter((source) => source.status === 'offline').length
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]
  const [editingProfile, setEditingProfile] = useState<Profile | null | undefined>(undefined)

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
              <div><strong>{source.name}</strong><small>{source.path} · {source.itemCount} itens</small></div>
            </div>
          ))}
        </div>
        {offlineSources > 0 && <small className="offline-count">{offlineSources} fonte aguardando conexão</small>}
        <button className="settings-button" type="button" onClick={onReview}>⚑ Revisão {reviewCount > 0 ? `(${reviewCount})` : ''}</button>
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

function ReviewPanel({
  items,
  onRefresh,
  onClose,
}: {
  items: Array<{ id: string; title: string; kind: string; reason?: string; relativePath: string; sourceName: string; sourcePath: string }>
  onRefresh: () => void
  onClose: () => void
}) {
  const [savingId, setSavingId] = useState('')
  const [drafts, setDrafts] = useState(() => Object.fromEntries(items.map((item) => [item.id, item.title])))

  const update = async (item: typeof items[number], action: 'approve' | 'correct' | 'ignore') => {
    setSavingId(item.id)
    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, title: drafts[item.id], kind: 'movie' }),
      })
      if (!response.ok) throw new Error('Não foi possível atualizar o item.')
      onRefresh()
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="review-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="review-panel" role="dialog" aria-modal="true" aria-label="Itens para revisão" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Itens para revisar</h2></div><button type="button" onClick={onClose}>×</button></div>
        {items.length === 0 && <p className="empty-state">Nenhum item aguardando revisão.</p>}
        <div className="review-list">
          {items.map((item) => (
            <article className="review-item" key={item.id}>
              <div><strong>{item.title}</strong><small>{item.sourceName} · {item.relativePath}</small><small>{item.reason || 'Classificação manual necessária.'}</small></div>
              <input value={drafts[item.id] ?? item.title} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`Título de ${item.title}`} />
              <div className="review-actions">
                <button type="button" disabled={savingId === item.id} onClick={() => void update(item, 'correct')}>Corrigir como filme</button>
                <button type="button" disabled={savingId === item.id} onClick={() => void update(item, 'approve')}>Aprovar</button>
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

function ShowHeader({ show, profileId, onPlay }: { show: LibraryItem; profileId: string; onPlay: (media: { title: string; url: string; subtitleUrl?: string; mediaId?: string }) => void }) {
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
        <RatingControl profileId={profileId} mediaId={show.kind === 'Filme' ? show.mediaId : undefined} showId={show.kind === 'Série' ? show.id : undefined} />
        {show.kind === 'Filme' && show.mediaUrl && <button className="primary-button detail-play" type="button" onClick={() => onPlay({ title: show.title, url: show.mediaUrl!, subtitleUrl: show.subtitleUrl, mediaId: show.mediaId })}>▶ Assistir</button>}
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

function VideoPlayer({ media, profileId, capabilities, onClose }: { media: { title: string; url: string; subtitleUrl?: string; mediaId?: string }; profileId: string; capabilities: { ffmpeg: boolean; ffprobe: boolean; vlc: boolean } | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastSavedPosition = useRef(0)
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ label: string; url: string }>>([])
  const [subtitleUrl, setSubtitleUrl] = useState('')
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(1)

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

  return (
    <div className="player-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="player-modal" role="dialog" aria-modal="true" aria-label={`Reproduzindo ${media.title}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="player-heading">
          <div><span>ASSISTINDO AGORA</span><strong>{media.title}</strong></div>
          <button className="player-close" type="button" aria-label="Fechar player" onClick={onClose}>×</button>
        </div>
        <video ref={videoRef} className="video-player" src={media.url} controls autoPlay playsInline onTimeUpdate={saveProgress} onEnded={saveProgress}>
          {subtitleUrl && <track kind="subtitles" srcLang="pt-BR" label="Português" src={subtitleUrl} default />}
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
          <button type="button" onClick={toggleFullscreen}>Tela cheia</button>
        </div>
        <small>{capabilities?.ffmpeg || capabilities?.vlc
          ? 'FFmpeg/VLC disponível: suporte avançado de áudio será ativado na próxima etapa.'
          : 'Player web ativo. Para múltiplos áudios e formatos incompatíveis, configure FFmpeg ou VLC no ambiente local.'}</small>
      </section>
    </div>
  )
}

function useGamepadNavigation() {
  const previousButtons = useRef<boolean[]>([])
  const previousAxes = useRef<ReadonlyArray<number>>([])

  useEffect(() => {
    if (!navigator.getGamepads) return

    const timer = window.setInterval(() => {
      const gamepad = Array.from(navigator.getGamepads()).find(Boolean)
      if (!gamepad) return

      const buttons = gamepad.buttons.map((button) => button.pressed)
      const previous = previousButtons.current
      const pressed = (index: number) => buttons[index] && !previous[index]
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('.controller-focus'))
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)

      if (pressed(0)) {
        const active = document.activeElement as HTMLElement | null
        active?.click()
      }

      if (pressed(1)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      }

      const horizontalAxis = gamepad.axes[0] ?? 0
      const wasHorizontal = previousAxes.current[0] ?? 0

      if (horizontalAxis > 0.6 && wasHorizontal <= 0.6) {
        focusable[Math.min(currentIndex + 1, focusable.length - 1)]?.focus()
      }

      if (horizontalAxis < -0.6 && wasHorizontal >= -0.6) {
        focusable[Math.max(currentIndex - 1, 0)]?.focus()
      }

      previousButtons.current = buttons
      previousAxes.current = gamepad.axes
    }, 100)

    return () => window.clearInterval(timer)
  }, [])
}

export default App
