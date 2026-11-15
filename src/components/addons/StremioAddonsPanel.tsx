import { Film, Globe, Plus, Power, Puzzle, Search, Trash2, Tv } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { StremioAddonDescriptor } from '../../domain/sourceAdapter'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { AddonStreamModal, type AddonMetaSummary } from './AddonStreamModal'

type StremioAddonsPanelProps = {
  onPlayStream: (media: PlayableMedia) => void
}

/** Stremio-compatible Addon manager, catalog explorer, and instant stream modal launcher. */
export function StremioAddonsPanel({ onPlayStream }: StremioAddonsPanelProps) {
  const [addons, setAddons] = useState<StremioAddonDescriptor[]>([])
  const [manifestUrl, setManifestUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [selectedAddonId, setSelectedAddonId] = useState('')
  const [selectedCatalogKey, setSelectedCatalogKey] = useState('')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogItems, setCatalogItems] = useState<AddonMetaSummary[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [activeItem, setActiveItem] = useState<AddonMetaSummary | null>(null)
  const [streamSearchQuery, setStreamSearchQuery] = useState('')
  const [streamSearchResults, setStreamSearchResults] = useState<AddonMetaSummary[]>([])
  const [searchingStreamTitles, setSearchingStreamTitles] = useState(false)

  const loadAddons = useCallback(async () => {
    try {
      const response = await fetch('/api/addons')
      if (!response.ok) return
      const data: StremioAddonDescriptor[] = await response.json()
      setAddons(data)
      if (!selectedAddonId && data.length > 0) {
        const firstWithCatalog = data.find((a) => a.catalogs.length > 0) || data[0]
        setSelectedAddonId(firstWithCatalog.id)
        if (firstWithCatalog.catalogs.length > 0) {
          setSelectedCatalogKey(`${firstWithCatalog.catalogs[0].type}::${firstWithCatalog.catalogs[0].id}`)
        }
      }
    } catch {
      // ignore initial load failure
    }
  }, [selectedAddonId])

  useEffect(() => {
    let active = true
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StremioAddonDescriptor[] | null) => {
        if (!active || !data) return
        setAddons(data)
        if (data.length > 0) {
          const firstWithCatalog = data.find((a) => a.catalogs.length > 0) || data[0]
          setSelectedAddonId(firstWithCatalog.id)
          if (firstWithCatalog.catalogs.length > 0) {
            setSelectedCatalogKey(`${firstWithCatalog.catalogs[0].type}::${firstWithCatalog.catalogs[0].id}`)
          }
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const selectedAddon = addons.find((a) => a.id === selectedAddonId) || null

  const loadCatalog = useCallback(async (addonId: string, catalogKey: string, query: string) => {
    if (!addonId || !catalogKey) return
    const [type, catalogId] = catalogKey.split('::')
    if (!type || !catalogId) return
    setLoadingCatalog(true)
    setFeedback('')
    try {
      const params = new URLSearchParams({ type, catalogId })
      if (query.trim()) params.set('search', query.trim())
      const response = await fetch(`/api/addons/${encodeURIComponent(addonId)}/catalog?${params.toString()}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setFeedback(payload?.error || 'Não foi possível carregar o catálogo do addon.')
        setCatalogItems([])
        return
      }
      setCatalogItems(Array.isArray(payload?.metas) ? payload.metas : [])
    } catch {
      setFeedback('Erro ao consultar o catálogo do addon.')
      setCatalogItems([])
    } finally {
      setLoadingCatalog(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedAddonId || !selectedCatalogKey) return
    const [type, catalogId] = selectedCatalogKey.split('::')
    if (!type || !catalogId) return
    let active = true
    const params = new URLSearchParams({ type, catalogId })
    fetch(`/api/addons/${encodeURIComponent(selectedAddonId)}/catalog?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setFeedback(payload?.error || 'Não foi possível carregar o catálogo do addon.')
          setCatalogItems([])
          return
        }
        setCatalogItems(Array.isArray(payload?.metas) ? payload.metas : [])
      })
      .catch(() => {
        if (active) setCatalogItems([])
      })
    return () => {
      active = false
    }
  }, [selectedAddonId, selectedCatalogKey])

  async function handleInstall(event: FormEvent) {
    event.preventDefault()
    if (!manifestUrl.trim()) return
    setInstalling(true)
    setFeedback('')
    try {
      const response = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: manifestUrl.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setFeedback(payload?.error || 'Não foi possível instalar o addon.')
        return
      }
      setManifestUrl('')
      setFeedback(`Addon "${payload.name}" instalado com sucesso.`)
      await loadAddons()
      setSelectedAddonId(payload.id)
      if (payload.catalogs?.length > 0) {
        setSelectedCatalogKey(`${payload.catalogs[0].type}::${payload.catalogs[0].id}`)
      }
    } catch {
      setFeedback('Falha de rede ao instalar o addon.')
    } finally {
      setInstalling(false)
    }
  }

  async function toggleAddon(addon: StremioAddonDescriptor) {
    try {
      const response = await fetch(`/api/addons/${encodeURIComponent(addon.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !addon.enabled }),
      })
      if (response.ok) await loadAddons()
    } catch {
      // ignore
    }
  }

  async function removeAddon(addonId: string) {
    try {
      const response = await fetch(`/api/addons/${encodeURIComponent(addonId)}`, { method: 'DELETE' })
      if (!response.ok) return
      if (selectedAddonId === addonId) {
        setSelectedAddonId('')
        setSelectedCatalogKey('')
        setCatalogItems([])
        setActiveItem(null)
      }
      await loadAddons()
    } catch {
      // ignore
    }
  }

  async function runFallbackSearch(event: FormEvent) {
    event.preventDefault()
    if (!streamSearchQuery.trim()) return
    setSearchingStreamTitles(true)
    setFeedback('')
    try {
      const response = await fetch(`/api/addons/search?q=${encodeURIComponent(streamSearchQuery.trim())}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setFeedback(payload?.error || 'Não foi possível buscar títulos.')
        setStreamSearchResults([])
        return
      }
      setStreamSearchResults(Array.isArray(payload?.metas) ? payload.metas : [])
    } catch {
      setFeedback('Erro ao buscar títulos para consulta nos addons.')
      setStreamSearchResults([])
    } finally {
      setSearchingStreamTitles(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Puzzle className="h-5 w-5 text-[var(--sc-accent)]" />
              Conector de Addons (Protocolo Stremio)
            </h2>
            <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
              Cole a URL <code className="text-white/90">manifest.json</code> (ou link <code className="text-white/90">stremio://</code>) de qualquer addon compatível com Stremio para explorar catálogos, metadados, legendas e streams.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManifestUrl('https://v3-cinemeta.strem.io/manifest.json')}
            >
              <Globe className="h-3.5 w-3.5" />
              Cinemeta (Catálogo)
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManifestUrl('https://opensubtitles-v3.strem.io/manifest.json')}
            >
              <Globe className="h-3.5 w-3.5" />
              OpenSubtitles v3 (Legendas)
            </Button>
          </div>
        </div>

        <form onSubmit={handleInstall} className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            value={manifestUrl}
            onChange={(e) => setManifestUrl(e.target.value)}
            placeholder="https://exemplo.com/manifest.json ou stremio://..."
            className="min-w-[260px] flex-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3.5 py-2 text-sm text-white outline-none focus:border-white/40"
            required
          />
          <Button type="submit" disabled={installing}>
            <Plus className="h-4 w-4" />
            {installing ? 'Instalando...' : 'Instalar addon'}
          </Button>
        </form>

        {feedback ? (
          <p className="mt-3 text-sm text-amber-300">{feedback}</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {addons.length === 0 ? (
          <div className="col-span-full rounded-[var(--sc-radius-lg)] border border-dashed border-[var(--sc-border-subtle)] p-8 text-center text-sm text-[var(--sc-text-secondary)]">
            Nenhum addon Stremio instalado ainda. Cole um <code className="text-white/80">manifest.json</code> acima para começar.
          </div>
        ) : (
          addons.map((addon) => (
            <div
              key={addon.id}
              className={`flex flex-col justify-between rounded-[var(--sc-radius-lg)] border p-4 transition ${
                selectedAddonId === addon.id
                  ? 'border-[var(--sc-accent)] bg-[var(--sc-bg-elevated)]'
                  : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)]'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {addon.logo ? (
                      <img src={addon.logo} alt={addon.name} className="h-10 w-10 rounded-md bg-black/40 object-contain p-1" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-white">
                        <Puzzle className="h-5 w-5" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-white">{addon.name}</h3>
                      <p className="text-xs text-[var(--sc-text-muted)]">v{addon.version} · {addon.id}</p>
                    </div>
                  </div>
                  <Badge tone={addon.enabled ? 'accent' : 'neutral'}>
                    {addon.enabled ? 'Ativo' : 'Pausado'}
                  </Badge>
                </div>
                {addon.description ? (
                  <p className="mt-2.5 line-clamp-2 text-xs text-[var(--sc-text-secondary)]">{addon.description}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {addon.resources.map((res) => (
                    <Badge key={res} tone="neutral">{res}</Badge>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--sc-border-subtle)] pt-3">
                {addon.catalogs.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedAddonId === addon.id ? 'primary' : 'secondary'}
                    onClick={() => {
                      setSelectedAddonId(addon.id)
                      setSelectedCatalogKey(`${addon.catalogs[0].type}::${addon.catalogs[0].id}`)
                      setActiveItem(null)
                    }}
                  >
                    Explorar ({addon.catalogs.length})
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="ghost" onClick={() => void toggleAddon(addon)} title="Ativar/Pausar">
                  <Power className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => void removeAddon(addon.id)} title="Remover addon">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedAddon && selectedAddon.catalogs.length > 0 ? (
        <div className="space-y-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold text-white">Catálogo · {selectedAddon.name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCatalogKey}
                onChange={(e) => setSelectedCatalogKey(e.target.value)}
                aria-label="Selecionar catálogo do addon"
                className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-sm text-white"
              >
                {selectedAddon.catalogs.map((cat) => (
                  <option key={`${cat.type}::${cat.id}`} value={`${cat.type}::${cat.id}`}>
                    {cat.name} ({cat.type})
                  </option>
                ))}
              </select>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void loadCatalog(selectedAddon.id, selectedCatalogKey, catalogSearch)
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="search"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Buscar no catálogo..."
                  className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-sm text-white outline-none focus:border-white/40"
                />
                <Button type="submit" size="sm" variant="secondary">
                  <Search className="h-3.5 w-3.5" />
                  Buscar
                </Button>
              </form>
            </div>
          </div>

          {loadingCatalog ? (
            <p className="text-sm text-[var(--sc-text-secondary)]">Carregando itens do catálogo...</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
              {catalogItems.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => setActiveItem({ ...item, addonId: selectedAddon.id, addonName: selectedAddon.name })}
                  className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-white/30 cursor-pointer"
                >
                  <div className="aspect-[2/3] w-full bg-black/50">
                    {item.poster ? (
                      <img src={item.poster} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[var(--sc-text-muted)]">
                        {item.type === 'series' ? <Tv className="h-8 w-8" /> : <Film className="h-8 w-8" />}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold text-white">{item.name}</p>
                    <p className="text-[11px] text-[var(--sc-text-muted)]">{item.releaseInfo || item.type}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : addons.length > 0 ? (
        <div className="space-y-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
          <div>
            <h3 className="text-base font-bold text-white">Buscar título ou ID IMDb para consultar streams</h3>
            <p className="mt-1 text-xs text-[var(--sc-text-secondary)]">
              Addons apenas de <code className="text-white/90">stream</code> não trazem catálogo próprio. Pesquise um filme, série ou ID IMDb (ex.: <code className="text-white/90">Matrix</code> ou <code className="text-white/90">tt0133093</code>) e clique no card para abrir os streams direto.
            </p>
          </div>
          <form onSubmit={runFallbackSearch} className="flex flex-wrap gap-2">
            <input
              type="search"
              value={streamSearchQuery}
              onChange={(e) => setStreamSearchQuery(e.target.value)}
              placeholder="Digite o nome do filme/série ou tt..."
              className="min-w-[240px] flex-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3.5 py-2 text-sm text-white outline-none focus:border-white/40"
            />
            <Button type="submit" disabled={searchingStreamTitles}>
              <Search className="h-4 w-4" />
              {searchingStreamTitles ? 'Buscando...' : 'Buscar título'}
            </Button>
          </form>

          {streamSearchResults.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
              {streamSearchResults.map((item) => (
                <button
                  key={`fb-${item.type}-${item.id}`}
                  type="button"
                  onClick={() => setActiveItem(item)}
                  className="group overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-white/30 cursor-pointer"
                >
                  <div className="aspect-[2/3] w-full bg-black/50">
                    {item.poster ? (
                      <img src={item.poster} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[var(--sc-text-muted)]">
                        {item.type === 'series' ? <Tv className="h-8 w-8" /> : <Film className="h-8 w-8" />}
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-semibold text-white">{item.name}</p>
                    <p className="text-[11px] text-[var(--sc-text-muted)]">{item.releaseInfo || item.type}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <AddonStreamModal
        item={activeItem}
        onClose={() => setActiveItem(null)}
        onPlayStream={onPlayStream}
      />
    </div>
  )
}
