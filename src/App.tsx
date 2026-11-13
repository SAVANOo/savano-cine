import { useMemo, useState } from 'react'
import './App.css'

type MediaKind = 'Filme' | 'Série'

type LibraryItem = {
  id: string
  title: string
  kind: MediaKind
  meta: string
  detail: string
  posterClass: string
  progress?: number
}

const library: LibraryItem[] = [
  {
    id: 'south-park',
    title: 'South Park',
    kind: 'Série',
    meta: '15 temporadas',
    detail: '216 episódios encontrados',
    posterClass: 'poster-south-park',
    progress: 42,
  },
  {
    id: 'marighella',
    title: 'Marighella',
    kind: 'Filme',
    meta: '2019 · 1080p',
    detail: 'MKV · 3,8 GB',
    posterClass: 'poster-marighella',
  },
  {
    id: 'a-fuga-do-planeta-terra',
    title: 'A Fuga do Planeta Terra',
    kind: 'Filme',
    meta: '2013 · 720p',
    detail: 'MP4 · 724 MB',
    posterClass: 'poster-fuga',
  },
]

function App() {
  const [activeFilter, setActiveFilter] = useState<'Tudo' | MediaKind>('Tudo')
  const [query, setQuery] = useState('')

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return library.filter((item) => {
      const matchesFilter = activeFilter === 'Tudo' || item.kind === activeFilter
      const matchesQuery =
        !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)

      return matchesFilter && matchesQuery
    })
  }, [activeFilter, query])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>Cine Local</span>
        </div>

        <nav className="main-nav" aria-label="Navegação principal">
          <a className="nav-item active" href="#inicio">
            <span>⌂</span> Início
          </a>
          <a className="nav-item" href="#filmes">
            <span>▶</span> Filmes
          </a>
          <a className="nav-item" href="#series">
            <span>▦</span> Séries
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="source-status">
            <span className="status-dot" />
            <div>
              <strong>Biblioteca local</strong>
              <small>1 pasta conectada</small>
            </div>
          </div>
          <button className="settings-button" type="button">
            ⚙ Configurações
          </button>
        </div>
      </aside>

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

        <section className="hero-card">
          <div className="hero-copy">
            <span className="hero-label">CONTINUE ASSISTINDO</span>
            <h2>South Park</h2>
            <p>Temporada 1 · Episódio 6</p>
            <button className="primary-button" type="button">
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
              <article className="media-card" key={item.id}>
                <div className={`poster ${item.posterClass}`}>
                  <span className="poster-kind">{item.kind}</span>
                  {item.id === 'south-park' && <strong>South<br />Park</strong>}
                  {item.id === 'marighella' && <strong>MARIGHELLA</strong>}
                  {item.id === 'a-fuga-do-planeta-terra' && <strong>A FUGA<br />DO PLANETA<br />TERRA</strong>}
                  {item.progress && (
                    <span className="progress-track">
                      <span style={{ width: `${item.progress}%` }} />
                    </span>
                  )}
                </div>
                <div className="card-copy">
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.meta}</p>
                  </div>
                  <span className="more-button">···</span>
                </div>
                <small className="card-detail">{item.detail}</small>
              </article>
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

export default App
