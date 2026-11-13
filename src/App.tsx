import { useEffect, useMemo, useState } from 'react'
import { library as mockLibrary, mediaSources as mockSources } from './data/mockCatalog'
import type { Episode, LibraryItem, MediaKind, MediaSource } from './domain/catalog'
import './App.css'

type LibraryFilter = 'Tudo' | MediaKind

function App() {
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>('Tudo')
  const [query, setQuery] = useState('')
  const [selectedShow, setSelectedShow] = useState<LibraryItem | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [catalog, setCatalog] = useState<LibraryItem[]>(mockLibrary)
  const [sources, setSources] = useState(mockSources)

  useEffect(() => {
    Promise.all([
      fetch('/api/library').then((response) => response.ok ? response.json() : Promise.reject(response)),
      fetch('/api/sources').then((response) => response.ok ? response.json() : Promise.reject(response)),
    ]).then(([remoteLibrary, remoteSources]) => {
      setCatalog(remoteLibrary)
      setSources(remoteSources)
    }).catch(() => {
      console.warn('API local indisponível; usando o catálogo de demonstração.')
    })
  }, [])

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
        <Sidebar sources={sources} />
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
      <Sidebar sources={sources} />
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

function Sidebar({ sources }: { sources: typeof mockSources }) {
  const offlineSources = sources.filter((source) => source.status === 'offline').length

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">S</span>
        <span>Savano Cine</span>
      </div>
      <nav className="main-nav" aria-label="Navegação principal">
        <a className="nav-item active" href="#inicio"><span>⌂</span> Início</a>
        <a className="nav-item" href="#filmes"><span>▶</span> Filmes</a>
        <a className="nav-item" href="#series"><span>▦</span> Séries</a>
      </nav>
      <div className="sidebar-bottom">
        <div className="source-status">
          <span className={offlineSources ? 'status-dot warning' : 'status-dot'} />
          <div><strong>{sources.length} fontes cadastradas</strong><small>{sources.length - offlineSources} conectada(s)</small></div>
        </div>
        {offlineSources > 0 && <small className="offline-count">{offlineSources} fonte aguardando conexão</small>}
        <button className="settings-button" type="button">⚙ Configurações</button>
      </div>
    </aside>
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
      <button className={`poster ${item.posterClass}`} type="button" onClick={() => item.kind === 'Série' && onOpen(item)}>
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
      <button className="episode-play" type="button">{watched ? 'Continuar' : 'Assistir'}</button>
    </article>
  )
}

export default App
