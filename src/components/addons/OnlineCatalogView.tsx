import { Film, Globe, Puzzle, Search, Tv } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { Button } from '../ui/Button'
import { AddonStreamModal, type AddonMetaSummary } from './AddonStreamModal'

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
  localCatalog: LibraryItem[]
  onPlayStream: (media: PlayableMedia) => void
  onPlayLocal: (item: LibraryItem) => void
  onOpenAddonsManager: () => void
}

/** Dedicated Online Archive view for browsing enabled Stremio addon catalogs and searching online streams. */
export function OnlineCatalogView({
  localCatalog,
  onPlayStream,
  onPlayLocal,
  onOpenAddonsManager,
}: OnlineCatalogViewProps) {
  const [addons, setAddons] = useState<InstalledAddon[]>([])
  const [selectedAddonId, setSelectedAddonId] = useState('')
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('')
  const [items, setItems] = useState<AddonMetaSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeItem, setActiveItem] = useState<AddonMetaSummary | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [pageSkip, setPageSkip] = useState(0)

  useEffect(() => {
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: InstalledAddon[]) => {
        const enabled = (Array.isArray(rows) ? rows : []).filter((a) => a.enabled)
        setAddons(enabled)
        const withCatalog = enabled.find((a) => a.catalogs?.length > 0)
        if (withCatalog) {
          setSelectedAddonId(withCatalog.id)
          setSelectedCatalogKey(`${withCatalog.catalogs[0].type}::${withCatalog.catalogs[0].id}`)
        }
      })
      .catch(() => setAddons([]))
  }, [])

  const catalogAddons = addons.filter((a) => a.catalogs?.length > 0)
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
        <Button type="button" variant="secondary" size="sm" onClick={onOpenAddonsManager}>
          <Puzzle className="h-4 w-4" />
          Gerenciar / Adicionar Addons
        </Button>
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
                if (addon.catalogs[0]) {
                  setSelectedCatalogKey(`${addon.catalogs[0].type}::${addon.catalogs[0].id}`)
                }
              }}
            >
              {addon.name}
            </Button>
          ))}
          {activeAddon && activeAddon.catalogs.length > 1 && (
            <select
              value={selectedCatalogKey}
              onChange={(e) => {
                setSelectedCatalogKey(e.target.value)
                setPageSkip(0)
              }}
              aria-label="Selecionar catálogo online"
              className="h-8 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 text-xs text-[var(--sc-text-primary)]"
            >
              {activeAddon.catalogs.map((cat) => (
                <option key={`${cat.type}::${cat.id}`} value={`${cat.type}::${cat.id}`}>
                  {cat.name || cat.id} ({cat.type === 'series' ? 'Séries' : 'Filmes'})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {statusMessage ? (
        <p className="text-xs text-[var(--sc-text-secondary)]">{statusMessage}</p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--sc-radius-xl)] border border-dashed border-[var(--sc-border-subtle)] p-10 text-center text-sm text-[var(--sc-text-secondary)]">
          <p className="m-0 max-w-md">
            {addons.length === 0
              ? 'Nenhum addon ativo ainda. Adicione um addon (como Cinemeta, Public Domain ou Brazuca Torrents) na aba Addons.'
              : 'Digite o nome de um filme ou série acima para buscar streams e legendas nos seus addons online.'}
          </p>
          {addons.length === 0 && (
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
              onClick={() => setActiveItem(item)}
              className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)] cursor-pointer"
            >
              <div className="aspect-[2/3] w-full bg-black/40">
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.name}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--sc-text-muted)]">
                    {item.type === 'series' ? <Tv className="h-8 w-8" /> : <Film className="h-8 w-8" />}
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

      <AddonStreamModal
        item={activeItem}
        localCatalog={localCatalog}
        onClose={() => setActiveItem(null)}
        onPlayStream={onPlayStream}
        onPlayLocal={onPlayLocal}
      />
    </section>
  )
}
