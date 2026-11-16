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
  catalogs: Array<{ type: string; id: string }>
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
          const catalogAddons = enabledAddons.filter((a) => a.catalogs?.length > 0)
          const lookups = catalogAddons.slice(0, 5).flatMap((addon) =>
            addon.catalogs.slice(0, 2).map((cat) =>
              fetch(
                `/api/addons/${encodeURIComponent(addon.id)}/catalog?type=${encodeURIComponent(cat.type)}&catalogId=${encodeURIComponent(cat.id)}&search=${encodeURIComponent(trimmed)}`,
              )
                .then((r) => (r.ok ? r.json() : null))
                .then((data) =>
                  (data?.metas || []).slice(0, 6).map((meta: Omit<OnlineMetaDiscoveryItem, 'addonName'>) => ({
                    ...meta,
                    addonName: addon.name,
                  })),
                )
                .catch(() => []),
            ),
          )
          const chunks = await Promise.all(lookups)
          if (!active) return
          const seen = new Set<string>()
          let merged = chunks.flat().filter((item) => {
            const key = `${item.type}:${item.id}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          if (merged.length === 0) {
            const fallbackRes = await fetch(`/api/addons/search?q=${encodeURIComponent(trimmed)}`).catch(() => null)
            const fallbackData = fallbackRes && fallbackRes.ok ? await fallbackRes.json().catch(() => null) : null
            if (!active) return
            merged = (fallbackData?.metas || []).slice(0, 24).map(
              (meta: Omit<OnlineMetaDiscoveryItem, 'addonName'>) => ({
                ...meta,
                addonName: enabledAddons[0]?.name || 'Addons',
              }),
            )
          }
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
          const targets = picks.length > 0 ? picks : addon.catalogs.slice(0, 1)
          return targets.map((cat) =>
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
