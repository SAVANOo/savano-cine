import { useEffect, useState } from 'react'

export type OnlineMetaDiscoveryItem = {
  id: string
  type: string
  name: string
  poster: string | null
  releaseInfo: string | null
  description?: string
  addonName: string
}

type InstalledCatalogAddon = {
  id: string
  name: string
  enabled: boolean
  catalogs: Array<{ type: string; id: string; extra?: Array<{ name?: string }> }>
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchesSearchQuery(title: string, query: string): boolean {
  const normTitle = normalizeSearchText(title)
  const normQuery = normalizeSearchText(query)
  if (!normQuery) return true
  if (normTitle.includes(normQuery)) return true
  const tokens = normQuery.split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return normTitle.includes(normQuery)
  const matched = tokens.filter((t) => normTitle.includes(t))
  return matched.length >= Math.ceil(tokens.length * 0.6)
}

/**
 * Loads trending online items for the hybrid Home carousel and performs
 * debounced cross-addon catalog search when the user types in the search bar.
 */
export function useOnlineCatalogDiscovery(query: string, enabled = true) {
  const [addonSearchResults, setAddonSearchResults] = useState<OnlineMetaDiscoveryItem[]>([])
  const [addonSearching, setAddonSearching] = useState(false)
  const [homeTrendingOnline, setHomeTrendingOnline] = useState<OnlineMetaDiscoveryItem[]>([])

  useEffect(() => {
    const trimmed = query.trim()
    if (!enabled || trimmed.length < 2) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      if (active) setAddonSearching(true)
      fetch('/api/addons')
        .then((res) => (res.ok ? res.json() : []))
        .then(async (addons: InstalledCatalogAddon[]) => {
          const enabledAddons = (addons || []).filter((a) => a.enabled)
          if (enabledAddons.length === 0) {
            if (active) {
              setAddonSearchResults([])
              setAddonSearching(false)
            }
            return
          }
          const catalogAddons = enabledAddons.filter((a) => a.catalogs?.some((c) => c.type !== 'tv'))
          const lookups = catalogAddons.slice(0, 5).flatMap((addon) => {
            const nonTv = addon.catalogs.filter((c) => c.type !== 'tv')
            const searchable = nonTv.filter((c) => c.extra?.some((e) => e.name === 'search'))
            const chosen = (searchable.length > 0 ? searchable : nonTv).slice(0, 2)
            return chosen.map((cat) =>
              fetch(
                `/api/addons/${encodeURIComponent(addon.id)}/catalog?type=${encodeURIComponent(cat.type)}&catalogId=${encodeURIComponent(cat.id)}&search=${encodeURIComponent(trimmed)}`,
              )
                .then((r) => (r.ok ? r.json() : null))
                .then((data) =>
                  (data?.metas || [])
                    .filter((meta: { name?: string }) => matchesSearchQuery(String(meta?.name || ''), trimmed))
                    .slice(0, 8)
                    .map((meta: Omit<OnlineMetaDiscoveryItem, 'addonName'>) => ({
                      ...meta,
                      addonName: addon.name,
                    })),
                )
                .catch(() => []),
            )
          })
          const fallbackPromise = fetch(`/api/addons/search?q=${encodeURIComponent(trimmed)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((fallbackData) =>
              (fallbackData?.metas || []).slice(0, 24).map(
                (meta: Omit<OnlineMetaDiscoveryItem, 'addonName'> & { addonName?: string }) => ({
                  ...meta,
                  addonName: meta.addonName || 'Cinemeta',
                }),
              ),
            )
            .catch(() => [])

          const [chunks, fallbackMetas] = await Promise.all([Promise.all(lookups), fallbackPromise])
          if (!active) return
          const seen = new Set<string>()
          const normQuery = normalizeSearchText(trimmed)
          const merged = [...fallbackMetas, ...chunks.flat()]
            .filter((item) => {
              const key = `${item.type}:${item.id}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            .sort((a, b) => {
              const aNorm = normalizeSearchText(a.name || '')
              const bNorm = normalizeSearchText(b.name || '')
              const aExact = aNorm === normQuery ? 2 : aNorm.includes(normQuery) ? 1 : 0
              const bExact = bNorm === normQuery ? 2 : bNorm.includes(normQuery) ? 1 : 0
              return bExact - aExact
            })
          if (active) {
            setAddonSearchResults(merged.slice(0, 24))
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
  }, [enabled, query])

  useEffect(() => {
    if (!enabled) return
    let active = true
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : []))
      .then(async (addons: InstalledCatalogAddon[]) => {
        const catalogAddons = (addons || []).filter((a) => a.enabled && a.catalogs?.length > 0)
        if (catalogAddons.length === 0) return
        const orderedAddons = [...catalogAddons].sort((a, b) => {
          const aHasVideo = a.catalogs.some((c) => c.type === 'movie' || c.type === 'series') ? 0 : 1
          const bHasVideo = b.catalogs.some((c) => c.type === 'movie' || c.type === 'series') ? 0 : 1
          return aHasVideo - bHasVideo
        })
        const lookups = orderedAddons.slice(0, 5).flatMap((addon) => {
          const picks = [
            addon.catalogs.find((c) => c.type === 'movie'),
            addon.catalogs.find((c) => c.type === 'series'),
          ].filter((c): c is { type: string; id: string } => Boolean(c))
          if (picks.length === 0) return []
          return picks.map((cat) =>
            fetch(
              `/api/addons/${encodeURIComponent(addon.id)}/catalog?type=${encodeURIComponent(cat.type)}&catalogId=${encodeURIComponent(cat.id)}`,
            )
              .then((r) => (r.ok ? r.json() : null))
              .then((data) =>
                (data?.metas || []).slice(0, 6).map((meta: Omit<OnlineMetaDiscoveryItem, 'addonName'>) => ({
                  ...meta,
                  addonName: addon.name,
                })),
              )
              .catch(() => []),
          )
        })
        const chunks = await Promise.all(lookups)
        if (!active) return
        const interleaved: OnlineMetaDiscoveryItem[] = []
        const maxLen = Math.max(0, ...chunks.map((c) => c.length))
        for (let i = 0; i < maxLen; i += 1) {
          for (const chunk of chunks) {
            if (chunk[i]) interleaved.push(chunk[i])
          }
        }
        const seen = new Set<string>()
        const merged = interleaved.filter((item) => {
          if (!item.poster) return false
          const key = `${item.type}:${item.id}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        setHomeTrendingOnline(merged.slice(0, 24))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [enabled])

  return { addonSearchResults, addonSearching, homeTrendingOnline }
}
