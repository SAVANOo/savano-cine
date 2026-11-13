import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { library as mockLibrary, mediaSources as mockSources } from './data/mockCatalog'
import { profiles as mockProfiles } from './data/mockCatalog'
import type { Episode, LibraryItem, MediaKind, MediaSource, Profile } from './domain/catalog'
import { messages } from './config/messages'
import './App.css'

type LibraryFilter = 'Tudo' | MediaKind

function App() {
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>('Tudo')
  const [query, setQuery] = useState('')
  const [selectedShow, setSelectedShow] = useState<LibraryItem | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [catalog, setCatalog] = useState<LibraryItem[]>(mockLibrary)
  const [sources, setSources] = useState(mockSources)
  const [profiles, setProfiles] = useState<Profile[]>(mockProfiles)
  const [activeProfileId, setActiveProfileId] = useState('profile-savio')

  useEffect(() => {
    Promise.all([
      fetch('/api/library').then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/sources').then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/profiles').then((response) => response.ok ? response.json() : Promise.reject(response)),
    ]).then(([remoteLibrary, remoteSources, remoteProfiles]) => {
      setCatalog(remoteLibrary)
      setSources(remoteSources)
      setProfiles(remoteProfiles)
    }).catch(() => {
      console.warn('API local indisponível; usando o catálogo de demonstração.')
    })
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
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
  }, [selectedShow])

  useGamepadNavigation()

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return catalog.filter((item) => {
      const matchesFilter = activeFilter === 'Tudo' || item.kind === activeFilter
      const matchesQuery =
        !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)

      return matchesFilter && matchesQuery
    })
  }, [activeFilter, catalog, query])

  const selectedEpisodes =
    selectedShow?.seasons?.find((season) => season.number === selectedSeason)?.episodes ?? []

  if (selectedShow) {
    return (
      <div className="app-shell">
        <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} />
        <main className="content">
          <button className="back-button" type="button" onClick={() => setSelectedShow(null)}>
            ← Voltar para biblioteca
          </button>
          <ShowHeader show={selectedShow} />
          <section className="episodes-section">
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
                      {season.number.toString().padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="episode-list">
              {selectedEpisodes.map((episode) => (
                <EpisodeRow episode={episode} key={episode.id} />
              ))}
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar sources={sources} profiles={profiles} activeProfileId={activeProfileId} onProfileChange={setActiveProfileId} onProfilesChange={setProfiles} />
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
            <button className="primary-button" type="button" onClick={() => setSelectedShow(catalog.find((item) => item.kind === 'Série') ?? mockLibrary[0])}>
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
              {(['Tudo', 'Filme', 'Série'] as const).map((filter) => (
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
              <MediaCard item={item} key={item.id} onOpen={setSelectedShow} />
            ))}
          </div>
          {visibleItems.length === 0 && (
            <div className="empty-state">Nenhum item encontrado na biblioteca.</div>
          )}
        </section>
      </main>
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
}: {
  sources: typeof mockSources
  profiles: Profile[]
  activeProfileId: string
  onProfileChange: (id: string) => void
  onProfilesChange: (profiles: Profile[]) => void
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
        <button className="settings-button" type="button">⚙ Configurações</button>
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

function ShowHeader({ show }: { show: LibraryItem }) {
  return (
    <section className="show-header">
      <div className={`show-poster poster ${show.posterClass}`}>
        {show.artwork.posterUrl && <img className="poster-image" src={show.artwork.posterUrl} alt="" />}
        <strong>South<br />Park</strong>
      </div>
      <div className="show-copy">
        <p className="eyebrow">SÉRIE</p>
        <h1>{show.title}</h1>
        <p className="show-description">Sua coleção local, organizada por temporada e episódio.</p>
        <div className="show-stats">
          <span>{show.meta}</span>
          <span>{show.detail}</span>
          <span>Legenda: PT-BR disponível</span>
        </div>
      </div>
    </section>
  )
}

function MediaCard({ item, onOpen }: { item: LibraryItem; onOpen: (item: LibraryItem) => void }) {
  return (
    <article className="media-card">
      <button className={`poster ${item.posterClass} controller-focus`} type="button" onClick={() => item.kind === 'Série' && onOpen(item)}>
        {item.artwork.posterUrl && <img className="poster-image" src={item.artwork.posterUrl} alt="" />}
        <span className="poster-kind">{item.kind}</span>
        {item.id === 'south-park' && <strong>South<br />Park</strong>}
        {item.id === 'marighella' && <strong>MARIGHELLA</strong>}
        {item.id === 'a-fuga-do-planeta-terra' && <strong>A FUGA<br />DO PLANETA<br />TERRA</strong>}
        {item.progress && <span className="progress-track"><span style={{ width: `${item.progress}%` }} /></span>}
      </button>
      <div className="card-copy">
        <div><h3>{item.title}</h3><p>{item.meta}</p></div>
        <span className="more-button">···</span>
      </div>
      <small className="card-detail">{item.detail}</small>
    </article>
  )
}

function EpisodeRow({ episode }: { episode: Episode }) {
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
      <button className="episode-play controller-focus" type="button">{watched ? 'Continuar' : 'Assistir'}</button>
    </article>
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
