import { Film, Globe, Puzzle, Search, Tv } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { Button } from '../ui/Button'
import { SavanoLoader } from '../ui/SavanoLoader'
import type { AddonMetaSummary } from '../../domain/addonTypes'
import { AddonDetailView } from './AddonDetailView'
import { DownloadsPanel } from './DownloadsPanel'

type AddonCatalogRef = {
  type: string
  id: string
  name?: string
}

type InstalledAddon = {
  id: string
  name: string
  enabled: boolean
  catalogs: AddonCatalogRef[]
}

type OnlineCatalogViewProps = {
  profileId?: string
  isAdmin?: boolean
  localCatalog: LibraryItem[]
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal: (item: LibraryItem) => void
  onOpenItem?: (item: AddonMetaSummary) => void
  onOpenAddonsManager: () => void
}

type OnlineProgressEntry = {
  mediaKey: string
  title: string
  poster?: string | null
  positionSec: number
  durationSec: number
  updatedAt: string
}

/** Dedicated Online Archive view for browsing enabled Stremio addon catalogs and searching online streams. */
export function OnlineCatalogView({
  profileId = 'profile-savio',
  isAdmin = false,
  localCatalog,
  onPlayStream,
  onPlayLocal,
  onOpenItem,
  onOpenAddonsManager,
}: OnlineCatalogViewProps) {
  const [addons, setAddons] = useState<InstalledAddon[]>([])
  const [categoryTab, setCategoryTab] = useState<'all' | 'movie' | 'series' | 'anime' | 'tv'>('movie')
  const [selectedAddonId, setSelectedAddonId] = useState('')
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('')
  const [items, setItems] = useState<AddonMetaSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeItem, setActiveItem] = useState<AddonMetaSummary | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [pageSkip, setPageSkip] = useState(0)
  const [onlineProgress, setOnlineProgress] = useState<OnlineProgressEntry[]>([])
  const [brokenPosters, setBrokenPosters] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    fetch(`/api/addons/progress?profileId=${encodeURIComponent(profileId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) setOnlineProgress(rows.slice(0, 6))
      })
      .catch(() => undefined)
  }, [profileId])

  useEffect(() => {
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: InstalledAddon[]) => {
        const enabled = (Array.isArray(rows) ? rows : []).filter((a) => a.enabled)
        setAddons(enabled)
        const withMovieCatalog =
          enabled.find((a) => a.catalogs?.some((c) => c.type === 'movie')) ??
          enabled.find((a) => a.catalogs?.some((c) => c.type === 'series')) ??
          enabled.find((a) => a.catalogs?.length > 0)
        if (withMovieCatalog) {
          const preferredCat =
            withMovieCatalog.catalogs.find((c) => c.type === 'movie') ??
            withMovieCatalog.catalogs.find((c) => c.type === 'series') ??
            withMovieCatalog.catalogs[0]
          setSelectedAddonId(withMovieCatalog.id)
          if (preferredCat) {
            const catType = preferredCat.type
            if (catType === 'movie' || catType === 'series' || catType === 'anime' || catType === 'tv') {
              setCategoryTab(catType)
            } else {
              setCategoryTab('all')
            }
            setSelectedCatalogKey(`${preferredCat.type}::${preferredCat.id}`)
          }
        }
      })
      .catch(() => setAddons([]))
  }, [])

  const catalogAddons = addons.filter((a) =>
    a.catalogs?.some((c) => (categoryTab === 'all' ? c.type !== 'tv' : c.type === categoryTab)),
  )
  const activeAddon = catalogAddons.find((a) => a.id === selectedAddonId) ?? catalogAddons[0] ?? null

  useEffect(() => {
    if (!activeAddon || !selectedCatalogKey) return
    const [type, catalogId] = selectedCatalogKey.split('::')
    if (!type || !catalogId) return
    let active = true
    const params = new URLSearchParams({ type, catalogId })
    if (searchQuery.trim()) params.set('search', searchQuery.trim())
    if (pageSkip > 0) params.set('skip', String(pageSkip))
    fetch(`/api/addons/${encodeURIComponent(activeAddon.id)}/catalog?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return
        setItems(Array.isArray(data?.metas) ? data.metas : [])
      })
      .catch(() => {
        if (active) setItems([])
      })
    return () => {
      active = false
    }
  }, [activeAddon, pageSkip, searchQuery, selectedCatalogKey])

  async function runOnlineSearch(event: FormEvent) {
    event.preventDefault()
    const trimmed = searchQuery.trim()
    if (!trimmed) return
    setLoading(true)
    setStatusMessage('')
    try {
      const res = await fetch(`/api/addons/search?q=${encodeURIComponent(trimmed)}`)
      const data = await res.json().catch(() => null)
      const metas = Array.isArray(data?.metas) ? data.metas : []
      setItems(metas)
      if (metas.length === 0) {
        setStatusMessage('Nenhum resultado encontrado nos addons online para esta busca.')
      }
    } catch {
      setStatusMessage('Falha ao consultar os addons online.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-xl font-bold text-[var(--sc-text-primary)]">
            <Globe className="h-5 w-5 text-[var(--sc-accent)]" />
            Acervo Online
          </h1>
          <p className="mt-1 mb-0 text-xs text-[var(--sc-text-secondary)]">
            Explore catálogos e streams dos seus addons Stremio conectados ({addons.length} ativo(s))
          </p>
        </div>
        {isAdmin && (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenAddonsManager}>
            <Puzzle className="h-4 w-4" />
            Gerenciar / Adicionar Addons
          </Button>
        )}
      </div>

      <form onSubmit={runOnlineSearch} className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--sc-text-muted)]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar filme ou série no acervo online..."
            className="h-10 w-full rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] pr-3 pl-10 text-sm text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] outline-none focus:border-[var(--sc-accent)]"
          />
        </div>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar Online'}
        </Button>
      </form>

      <DownloadsPanel />

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: 'movie', label: 'Filmes' },
            { key: 'series', label: 'Séries & Novelas' },
            { key: 'anime', label: 'Animes' },
            { key: 'tv', label: 'TV / Ao Vivo' },
            { key: 'all', label: 'Todos' },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={categoryTab === tab.key ? 'primary' : 'ghost'}
            onClick={() => {
              setCategoryTab(tab.key)
              setPageSkip(0)
              const matchingAddons = addons.filter((a) =>
                a.catalogs?.some((c) => tab.key === 'all' || c.type === tab.key),
              )
              const nextAddon =
                matchingAddons.find((a) => a.id === selectedAddonId) ?? matchingAddons[0]
              if (nextAddon) {
                setSelectedAddonId(nextAddon.id)
                const nextCat =
                  nextAddon.catalogs.find((c) => (tab.key === 'all' ? c.type !== 'tv' : c.type === tab.key)) ??
                  nextAddon.catalogs[0]
                if (nextCat) {
                  setSelectedCatalogKey(`${nextCat.type}::${nextCat.id}`)
                }
              }
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {catalogAddons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {catalogAddons.map((addon) => (
            <Button
              key={addon.id}
              type="button"
              size="sm"
              variant={activeAddon?.id === addon.id ? 'light' : 'secondary'}
              onClick={() => {
                setSelectedAddonId(addon.id)
                setPageSkip(0)
                const matchingCat =
                  addon.catalogs.find((c) => (categoryTab === 'all' ? c.type !== 'tv' : c.type === categoryTab)) ??
                  addon.catalogs[0]
                if (matchingCat) {
                  setSelectedCatalogKey(`${matchingCat.type}::${matchingCat.id}`)
                }
              }}
            >
              {addon.name}
            </Button>
          ))}
          {(() => {
            const visibleCatalogs = activeAddon
              ? activeAddon.catalogs.filter((c) => (categoryTab === 'all' ? c.type !== 'tv' : c.type === categoryTab))
              : []
            if (visibleCatalogs.length <= 1) return null
            return (
              <select
                value={selectedCatalogKey}
                onChange={(e) => {
                  setSelectedCatalogKey(e.target.value)
                  setPageSkip(0)
                }}
                aria-label="Selecionar catálogo online"
                className="h-8 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 text-xs text-[var(--sc-text-primary)]"
              >
                {visibleCatalogs.map((cat) => (
                  <option key={`${cat.type}::${cat.id}`} value={`${cat.type}::${cat.id}`}>
                    {cat.name || cat.id} ({cat.type === 'tv' ? 'TV / Ao Vivo' : cat.type === 'series' ? 'Séries' : 'Filmes'})
                  </option>
                ))}
              </select>
            )
          })()}
        </div>
      )}

      {statusMessage ? (
        <p className="text-xs text-[var(--sc-text-secondary)]">{statusMessage}</p>
      ) : null}

      {onlineProgress.length > 0 && (
        <div className="space-y-2.5">
          <p className="m-0 text-xs font-bold uppercase tracking-wider text-[var(--sc-text-secondary)]">
            Continuar assistindo (Online)
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {onlineProgress.map((entry) => {
              const pct = entry.durationSec > 0 ? Math.min(100, Math.round((entry.positionSec / entry.durationSec) * 100)) : 0
              return (
                <button
                  key={entry.mediaKey}
                  type="button"
                  onClick={() =>
                    onPlayStream({
                      mediaId: '',
                      title: entry.title || 'Stream Online',
                      url: entry.mediaKey,
                      poster: entry.poster || undefined,
                      startPosition: entry.positionSec,
                    })
                  }
                  className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)] cursor-pointer"
                >
                  <div className="relative aspect-[2/3] w-full bg-black/45">
                    {entry.poster ? (
                      <img src={entry.poster} alt={entry.title} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[var(--sc-text-muted)]">
                        <Film className="h-8 w-8" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
                      <div className="h-full bg-[var(--sc-accent)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold text-[var(--sc-text-primary)]">{entry.title}</p>
                    <p className="text-[10px] text-[var(--sc-text-muted)]">{pct}% assistido</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <SavanoLoader label="Buscando no acervo online..." />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--sc-radius-xl)] border border-dashed border-[var(--sc-border-subtle)] p-10 text-center text-sm text-[var(--sc-text-secondary)]">
          <p className="m-0 max-w-md">
            {addons.length === 0
              ? 'Nenhum addon ativo ainda. Adicione um addon (como Cinemeta, Public Domain ou Brazuca Torrents) na aba Addons.'
              : 'Digite o nome de um filme ou série acima para buscar streams e legendas nos seus addons online.'}
          </p>
          {addons.length === 0 && isAdmin && (
            <Button type="button" variant="primary" size="sm" onClick={onOpenAddonsManager}>
              <Puzzle className="h-4 w-4" />
              Adicionar primeiro addon
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {items.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              onClick={() => {
                if (onOpenItem) onOpenItem(item)
                else setActiveItem(item)
              }}
              className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)] cursor-pointer"
            >
              <div className="aspect-[2/3] w-full bg-gradient-to-br from-neutral-900 via-neutral-950 to-black">
                {item.poster && !brokenPosters.has(item.poster) ? (
                  <img
                    src={item.poster}
                    alt={item.name}
                    loading="lazy"
                    onError={() =>
                      setBrokenPosters((prev) => new Set(prev).add(item.poster!))
                    }
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-3 text-center text-[var(--sc-text-muted)]">
                    {item.type === 'series' ? <Tv className="mb-2 h-7 w-7 opacity-60" /> : <Film className="mb-2 h-7 w-7 opacity-60" />}
                    <span className="line-clamp-3 text-xs font-bold text-white/85">{item.name}</span>
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold text-[var(--sc-text-primary)]">{item.name}</p>
                <p className="truncate text-[11px] text-[var(--sc-text-muted)]">
                  {item.releaseInfo || (item.type === 'series' ? 'Série' : 'Filme')}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {catalogAddons.length > 0 && items.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pageSkip === 0}
            onClick={() => setPageSkip((prev) => Math.max(0, prev - 20))}
          >
            Página anterior
          </Button>
          <span className="text-xs text-[var(--sc-text-muted)]">
            Página {Math.floor(pageSkip / 20) + 1}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={items.length < 20}
            onClick={() => setPageSkip((prev) => prev + 20)}
          >
            Próxima página
          </Button>
        </div>
      )}

      {activeItem && (
        <AddonDetailView
          item={activeItem}
          localCatalog={localCatalog}
          profileId={profileId}
          onBack={() => setActiveItem(null)}
          onPlayStream={onPlayStream}
          onPlayLocal={onPlayLocal}
        />
      )}
    </section>
  )
}
