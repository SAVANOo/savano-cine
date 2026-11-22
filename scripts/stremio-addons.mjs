/**
 * Stremio-compatible Addon protocol client and SQLite persistence.
 * Supports manifest.json installation, catalog browsing, meta lookup,
 * and stream/subtitle resolution over HTTP/HTTPS without modifying local files.
 */

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9._:-]+$/
const ADDON_RESPONSE_CACHE = new Map()
const ADDON_CACHE_TTL_MS = 5 * 60_000
const ADDON_HEALTH = new Map()
const CIRCUIT_COOLDOWN_MS = 60_000

function recordAddonOutcome(addonId, ok, elapsedMs) {
  const prev = ADDON_HEALTH.get(addonId) || { okCount: 0, failCount: 0, consecutiveFails: 0, avgMs: 0, cooldownUntil: 0 }
  const total = prev.okCount + prev.failCount
  const avgMs = total === 0 ? Math.round(elapsedMs) : Math.round((prev.avgMs * total + elapsedMs) / (total + 1))
  const consecutiveFails = ok ? 0 : prev.consecutiveFails + 1
  const cooldownUntil = !ok && consecutiveFails >= 2 ? Date.now() + CIRCUIT_COOLDOWN_MS : ok ? 0 : prev.cooldownUntil
  ADDON_HEALTH.set(addonId, {
    okCount: prev.okCount + (ok ? 1 : 0),
    failCount: prev.failCount + (ok ? 0 : 1),
    consecutiveFails,
    avgMs,
    cooldownUntil,
  })
}

function isAddonInCooldown(addonId) {
  const entry = ADDON_HEALTH.get(addonId)
  return Boolean(entry && entry.cooldownUntil > Date.now())
}

function getAddonHealthSummary(addonId) {
  const entry = ADDON_HEALTH.get(addonId)
  if (!entry) return { status: 'unknown', avgMs: 0, failCount: 0 }
  const status =
    entry.cooldownUntil > Date.now() || entry.consecutiveFails >= 2
      ? 'degraded'
      : entry.avgMs > 2500
        ? 'slow'
        : 'healthy'
  return { status, avgMs: entry.avgMs, failCount: entry.failCount }
}

function getCachedAddonResponse(key) {
  const entry = ADDON_RESPONSE_CACHE.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > ADDON_CACHE_TTL_MS) {
    ADDON_RESPONSE_CACHE.delete(key)
    return null
  }
  return entry.value
}

function setCachedAddonResponse(key, value) {
  if (ADDON_RESPONSE_CACHE.size > 150) {
    const oldestKey = ADDON_RESPONSE_CACHE.keys().next().value
    if (oldestKey) ADDON_RESPONSE_CACHE.delete(oldestKey)
  }
  ADDON_RESPONSE_CACHE.set(key, { at: Date.now(), value })
}

export function ensureStremioAddonsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stremio_addons (
      id TEXT PRIMARY KEY,
      manifest_url TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      description TEXT NOT NULL DEFAULT '',
      logo TEXT,
      types_json TEXT NOT NULL DEFAULT '[]',
      resources_json TEXT NOT NULL DEFAULT '[]',
      catalogs_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '0.0.0.0' || h.endsWith('.local')) return true
  if (/^10\.|^192\.168\.|^169\.254\./.test(h)) return true
  const m172 = h.match(/^172\.(\d+)\./)
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true
  return /^(fc|fd|fe80)/i.test(h)
}

export function normalizeManifestUrl(rawUrl) {
  let trimmed = String(rawUrl || '').trim()
  if (/^stremio:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^stremio:\/\//i, 'https://')
  }
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('URL do manifest inválida.')
  }
  const directAddonParam = parsed.searchParams.get('addon')
  if (directAddonParam) {
    return normalizeManifestUrl(decodeURIComponent(directAddonParam))
  }
  if (parsed.hash && parsed.hash.includes('addon=')) {
    const hashQuery = parsed.hash.split('?')[1] || ''
    const hashParams = new URLSearchParams(hashQuery)
    const hashAddon = hashParams.get('addon')
    if (hashAddon) {
      return normalizeManifestUrl(decodeURIComponent(hashAddon))
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas URLs HTTP ou HTTPS são permitidas para addons Stremio.')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Endereços locais ou privados não são permitidos para addons Stremio.')
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '')
  const manifestPath = cleanPath.endsWith('/manifest.json') ? cleanPath : `${cleanPath}/manifest.json`
  parsed.pathname = manifestPath
  parsed.search = ''
  parsed.hash = ''
  const manifestUrl = parsed.toString()
  const baseUrl = manifestUrl.replace(/\/manifest\.json$/, '')
  return { manifestUrl, baseUrl }
}

function normalizeResources(resources) {
  if (!Array.isArray(resources)) return []
  return resources
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
}

function normalizeCatalogs(catalogs) {
  if (!Array.isArray(catalogs)) return []
  return catalogs
    .filter((entry) => entry && typeof entry.type === 'string' && typeof entry.id === 'string')
    .map((entry) => ({
      type: entry.type,
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `${entry.type} (${entry.id})`,
    }))
}

function serializeAddonRow(row) {
  if (!row) return null
  return {
    id: row.id,
    manifestUrl: row.manifest_url,
    baseUrl: row.base_url,
    name: row.name,
    version: row.version || '1.0.0',
    description: row.description || '',
    logo: row.logo || null,
    types: JSON.parse(row.types_json || '[]'),
    resources: JSON.parse(row.resources_json || '[]'),
    catalogs: JSON.parse(row.catalogs_json || '[]'),
    enabled: Boolean(row.enabled),
    health: getAddonHealthSummary(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listStremioAddons(database) {
  ensureStremioAddonsTable(database)
  const rows = database.prepare('SELECT * FROM stremio_addons ORDER BY created_at DESC, name ASC').all()
  return rows.map(serializeAddonRow)
}

export async function installStremioAddon(database, rawUrl) {
  ensureStremioAddonsTable(database)
  const { manifestUrl, baseUrl } = normalizeManifestUrl(rawUrl)
  let response
  try {
    response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'SavanoCine/1.1' },
      signal: AbortSignal.timeout(9000),
    })
  } catch (err) {
    const code = err?.cause?.code || err?.name || 'NETWORK_ERROR'
    throw new Error(`Não foi possível alcançar o servidor do addon (${code}). Verifique se o endereço está online.`)
  }
  if (!response.ok) {
    throw new Error(`Servidor do addon respondeu HTTP ${response.status} em ${manifestUrl}.`)
  }
  const rawText = await response.text()
  if (rawText.trimStart().startsWith('<')) {
    throw new Error('O link retornou uma página HTML em vez de um manifest.json válido do Stremio.')
  }
  let manifest = null
  try {
    manifest = JSON.parse(rawText)
  } catch {
    manifest = null
  }
  if (!manifest || typeof manifest.id !== 'string' || typeof manifest.name !== 'string') {
    throw new Error('Manifest Stremio inválido: campos id e name são obrigatórios.')
  }

  const addonId = manifest.id.trim()
  const types = Array.isArray(manifest.types) ? manifest.types.filter((t) => typeof t === 'string') : []
  const resources = normalizeResources(manifest.resources)
  const catalogs = normalizeCatalogs(manifest.catalogs)

  database.prepare(`
    INSERT INTO stremio_addons (
      id, manifest_url, base_url, name, version, description, logo,
      types_json, resources_json, catalogs_json, enabled, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      manifest_url = excluded.manifest_url,
      base_url = excluded.base_url,
      name = excluded.name,
      version = excluded.version,
      description = excluded.description,
      logo = excluded.logo,
      types_json = excluded.types_json,
      resources_json = excluded.resources_json,
      catalogs_json = excluded.catalogs_json,
      enabled = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    addonId,
    manifestUrl,
    baseUrl,
    manifest.name.trim(),
    String(manifest.version || '1.0.0'),
    String(manifest.description || ''),
    typeof manifest.logo === 'string' ? manifest.logo : null,
    JSON.stringify(types),
    JSON.stringify(resources),
    JSON.stringify(catalogs),
  )

  return serializeAddonRow(database.prepare('SELECT * FROM stremio_addons WHERE id = ?').get(addonId))
}

export function setStremioAddonEnabled(database, id, enabled) {
  ensureStremioAddonsTable(database)
  const result = database.prepare(`
    UPDATE stremio_addons
    SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(enabled ? 1 : 0, id)
  if (result.changes === 0) return null
  return serializeAddonRow(database.prepare('SELECT * FROM stremio_addons WHERE id = ?').get(id))
}

export function deleteStremioAddon(database, id) {
  ensureStremioAddonsTable(database)
  const result = database.prepare('DELETE FROM stremio_addons WHERE id = ?').run(id)
  return result.changes > 0
}

function assertSafeSegment(value, label) {
  if (!value || !SAFE_SEGMENT_RE.test(value)) {
    throw new Error(`${label} inválido.`)
  }
}

export async function fetchAddonCatalog(database, addonId, { type, catalogId, search, skip }) {
  ensureStremioAddonsTable(database)
  const addon = serializeAddonRow(database.prepare('SELECT * FROM stremio_addons WHERE id = ?').get(addonId))
  if (!addon) return null
  assertSafeSegment(type, 'Tipo de catálogo')
  assertSafeSegment(catalogId, 'ID do catálogo')

  const extraParts = []
  if (search?.trim()) extraParts.push(`search=${encodeURIComponent(search.trim())}`)
  if (Number.isInteger(skip) && skip > 0) extraParts.push(`skip=${skip}`)
  const extra = extraParts.length > 0 ? `/${extraParts.join('&')}` : ''
  const targetUrl = `${addon.baseUrl}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${extra}.json`
  const cached = getCachedAddonResponse(`cat:${targetUrl}`)
  if (cached) return cached
  const response = await fetch(targetUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    throw new Error(`Catálogo do addon respondeu HTTP ${response.status}.`)
  }
  const payload = await response.json()
  const rawMetas = Array.isArray(payload?.metas) ? payload.metas : []
  const promoMetaRe = /\b(?:livepix|apoie o canal|doa[cç][aã]o)\b/i
  const looseEpisodeRe = /\b(?:S\d{1,2}\s*E\d{1,2}|T\d{1,2}\s*E[P]?\d{1,2}|EP\.?\s*\d{1,3})\b/i
  const metas = rawMetas.filter((meta) => {
    const name = String(meta?.name || meta?.title || '')
    if (promoMetaRe.test(name)) return false
    if (type === 'series' && !meta?.poster) return false
    if (type === 'series' && looseEpisodeRe.test(name)) return false
    return true
  })
  const result = {
    addonId: addon.id,
    addonName: addon.name,
    type,
    catalogId,
    metas: metas.slice(0, 60).map((meta) => ({
      id: String(meta.id || ''),
      type: String(meta.type || type),
      name: String(meta.name || meta.title || 'Sem título'),
      poster: typeof meta.poster === 'string' ? meta.poster : null,
      background: typeof meta.background === 'string' ? meta.background : null,
      description: typeof meta.description === 'string' ? meta.description : '',
      releaseInfo: meta.releaseInfo ? String(meta.releaseInfo) : null,
      genres: Array.isArray(meta.genres) ? meta.genres.filter((g) => typeof g === 'string') : [],
    })),
  }
  setCachedAddonResponse(`cat:${targetUrl}`, result)
  return result
}

const ptBrMetaCache = new Map()

async function translateTextChunk(text) {
  const clean = String(text || '').trim()
  if (!clean) return ''
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=${encodeURIComponent(clean)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
  if (!res.ok) return clean
  const data = await res.json().catch(() => null)
  if (!Array.isArray(data?.[0])) return clean
  return data[0].map((part) => (Array.isArray(part) ? String(part[0] || '') : '')).join('') || clean
}

async function localizeMetaToPtBr(metaObj) {
  if (!metaObj || !metaObj.id) return metaObj
  const cacheKey = `${metaObj.type}:${metaObj.id}`
  if (ptBrMetaCache.has(cacheKey)) return ptBrMetaCache.get(cacheKey)

  try {
    const videos = Array.isArray(metaObj.videos) ? metaObj.videos : []
    const epSample = videos.slice(0, 40)
    const SEP = '\n[[[SC_SEP]]]\n'
    const parts = [
      metaObj.description || '',
      ...epSample.map((v) => v.title || ''),
      ...epSample.map((v) => v.overview || ''),
    ]
    const joined = parts.join(SEP)
    let translatedParts = parts
    if (joined.trim().length > 0 && joined.length <= 12000) {
      const translated = await translateTextChunk(joined)
      const split = translated.split(/\s*\[\[\[SC_SEP\]\]\]\s*/)
      if (split.length === parts.length) {
        translatedParts = split
      }
    } else if (metaObj.description) {
      translatedParts[0] = await translateTextChunk(metaObj.description)
    }

    const localized = {
      ...metaObj,
      description: translatedParts[0] || metaObj.description,
      videos: videos.map((v, idx) => {
        if (idx >= epSample.length) return v
        return {
          ...v,
          title: translatedParts[1 + idx]?.trim() || v.title,
          overview: translatedParts[1 + epSample.length + idx]?.trim() || v.overview,
        }
      }),
    }
    ptBrMetaCache.set(cacheKey, localized)
    if (ptBrMetaCache.size > 200) {
      const firstKey = ptBrMetaCache.keys().next().value
      if (firstKey) ptBrMetaCache.delete(firstKey)
    }
    return localized
  } catch {
    return metaObj
  }
}

function normalizeMetaPayload(meta, type, metaId) {
  return {
    id: String(meta.id || metaId),
    type: String(meta.type || type),
    name: String(meta.name || 'Sem título'),
    poster: typeof meta.poster === 'string' ? meta.poster : null,
    background: typeof meta.background === 'string' ? meta.background : null,
    description: typeof meta.description === 'string' ? meta.description : '',
    releaseInfo: meta.releaseInfo ? String(meta.releaseInfo) : null,
    runtime: meta.runtime ? String(meta.runtime) : null,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    videos: Array.isArray(meta.videos)
      ? meta.videos.map((v) => ({
          id: String(v.id || ''),
          title: String(v.title || v.name || `Episódio ${v.episode ?? ''}`),
          season: typeof v.season === 'number' ? v.season : null,
          episode: typeof v.episode === 'number' ? v.episode : null,
          thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : null,
          overview: typeof v.overview === 'string' ? v.overview : '',
        }))
      : [],
  }
}

export async function fetchAddonMeta(database, addonId, { type, metaId }) {
  ensureStremioAddonsTable(database)
  const addon = serializeAddonRow(database.prepare('SELECT * FROM stremio_addons WHERE id = ?').get(addonId))
  if (!addon) return null
  assertSafeSegment(type, 'Tipo')
  assertSafeSegment(metaId, 'ID de mídia')

  const targetUrl = `${addon.baseUrl}/meta/${encodeURIComponent(type)}/${encodeURIComponent(metaId)}.json`
  const response = await fetch(targetUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    throw new Error(`Metadados do addon responderam HTTP ${response.status}.`)
  }
  const payload = await response.json().catch(() => ({}))
  const meta = payload?.meta
  if (!meta) return null
  return await localizeMetaToPtBr(normalizeMetaPayload(meta, type, metaId))
}

function isSafeHttpUrl(candidate) {
  try {
    const parsed = new URL(String(candidate || ''))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function parseStreamHealth(titleText) {
  const text = String(titleText || '')
  const seedMatch = text.match(/(?:👤|👥|seeds?:?|seeders?:?)\s*(\d+)/i)
  const sizeMatch = text.match(/(\d+(?:[.,]\d+)?\s*(?:GB|MB|GiB|MiB))/i)
  return {
    seeders: seedMatch ? Number(seedMatch[1]) : null,
    sizeLabel: sizeMatch ? sizeMatch[1] : null,
  }
}

export async function queryAddonStreams(database, { type, id, addonId }) {
  ensureStremioAddonsTable(database)
  assertSafeSegment(type, 'Tipo')
  assertSafeSegment(id, 'ID de mídia')

  const allAddons = listStremioAddons(database).filter((addon) => addon.enabled)
  const targets = allAddons.filter((addon) => {
    if (addonId && addon.id !== addonId) return false
    return addon.resources.includes('stream')
  })

  const settled = await Promise.allSettled(
    targets
      .filter((addon) => addonId || !isAddonInCooldown(addon.id))
      .map(async (addon) => {
        const started = Date.now()
        const url = `${addon.baseUrl}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(4500),
          })
          if (!response.ok) {
            recordAddonOutcome(addon.id, false, Date.now() - started)
            return []
          }
          recordAddonOutcome(addon.id, true, Date.now() - started)
          const payload = await response.json().catch(() => ({}))
      const streams = Array.isArray(payload?.streams) ? payload.streams : []
      return streams.map((stream) => {
        const titleStr = String(stream.title || stream.description || stream.name || 'Stream')
        const health = parseStreamHealth(`${stream.name || ''} ${titleStr}`)
        const rawProxyHeaders = stream.behaviorHints?.proxyHeaders?.request
        const proxyHeaders =
          rawProxyHeaders && typeof rawProxyHeaders === 'object'
            ? Object.fromEntries(
                Object.entries(rawProxyHeaders).filter(
                  ([k, v]) => /^(referer|user-agent|origin|accept)$/i.test(k) && typeof v === 'string',
                ),
              )
            : null
        return {
          addonId: addon.id,
          addonName: addon.name,
          name: String(stream.name || addon.name),
          title: titleStr,
          url: isSafeHttpUrl(stream.url) ? stream.url : null,
          isDirectHttp: isSafeHttpUrl(stream.url),
          externalUrl: isSafeHttpUrl(stream.externalUrl) ? stream.externalUrl : null,
          proxyHeaders: proxyHeaders && Object.keys(proxyHeaders).length > 0 ? proxyHeaders : null,
          notWebReady: Boolean(stream.behaviorHints?.notWebReady),
          ytId:
            typeof stream.ytId === 'string' && /^[a-zA-Z0-9_-]{6,20}$/.test(stream.ytId)
              ? stream.ytId
              : null,
          infoHash: typeof stream.infoHash === 'string' ? stream.infoHash : null,
          fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null,
          seeders: health.seeders,
          sizeLabel: health.sizeLabel,
        }
      })
        } catch {
          recordAddonOutcome(addon.id, false, Date.now() - started)
          return []
        }
    }),
  )

  return settled
    .filter((entry) => entry.status === 'fulfilled')
    .flatMap((entry) => entry.value)
    .sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1))
}

function subtitleLanguageRank(lang) {
  const l = String(lang || '').toLowerCase()
  if (l === 'pob' || l === 'pt-br' || l === 'ptbr' || l.includes('brazil')) return 0
  if (l === 'por' || l === 'pt' || l.startsWith('portug')) return 1
  if (l === 'eng' || l === 'en') return 2
  if (l === 'spa' || l === 'es') return 3
  return 4
}

export async function queryAddonSubtitles(database, { type, id }) {
  ensureStremioAddonsTable(database)
  assertSafeSegment(type, 'Tipo')
  assertSafeSegment(id, 'ID de mídia')

  const targets = listStremioAddons(database).filter(
    (addon) => addon.enabled && addon.resources.includes('subtitles'),
  )

  const settled = await Promise.allSettled(
    targets
      .filter((addon) => !isAddonInCooldown(addon.id))
      .map(async (addon) => {
        const started = Date.now()
        const url = `${addon.baseUrl}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(4500),
          })
          if (!response.ok) {
            recordAddonOutcome(addon.id, false, Date.now() - started)
            return []
          }
          recordAddonOutcome(addon.id, true, Date.now() - started)
          const payload = await response.json().catch(() => ({}))
          const subs = Array.isArray(payload?.subtitles) ? payload.subtitles : []
          return subs
            .filter((sub) => isSafeHttpUrl(sub?.url))
            .map((sub) => ({
              addonId: addon.id,
              addonName: addon.name,
              id: String(sub.id || sub.url),
              lang: String(sub.lang || 'und'),
              url: sub.url,
            }))
        } catch {
          recordAddonOutcome(addon.id, false, Date.now() - started)
          return []
        }
      }),
  )

  return settled
    .filter((entry) => entry.status === 'fulfilled')
    .flatMap((entry) => entry.value)
    .sort((a, b) => subtitleLanguageRank(a.lang) - subtitleLanguageRank(b.lang))
}

export async function searchAddonFallback(query) {
  const q = String(query || '').trim()
  if (!q) return []

  if (/^tt\d{5,10}$/i.test(q)) {
    const id = q.toLowerCase()
    const results = await Promise.allSettled(
      ['movie', 'series'].map(async (type) => {
        const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(id)}.json`, {
          signal: AbortSignal.timeout(6000),
        })
        if (!res.ok) return null
        const data = await res.json().catch(() => null)
        const meta = data?.meta
        if (!meta) return null
        return {
          id: String(meta.id || id),
          type: String(meta.type || type),
          name: String(meta.name || id),
          poster: typeof meta.poster === 'string' ? meta.poster : null,
          background: typeof meta.background === 'string' ? meta.background : null,
          description: typeof meta.description === 'string' ? meta.description : '',
          releaseInfo: meta.releaseInfo ? String(meta.releaseInfo) : null,
          genres: Array.isArray(meta.genres) ? meta.genres : [],
        }
      }),
    )
    return results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value)
  }

  const results = await Promise.allSettled(
    ['movie', 'series'].map(async (type) => {
      const url = `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(q)}.json`
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) })
      if (!res.ok) return []
      const data = await res.json().catch(() => ({}))
      const metas = Array.isArray(data?.metas) ? data.metas : []
      return metas.slice(0, 12).map((meta) => ({
        id: String(meta.id || ''),
        type: String(meta.type || type),
        name: String(meta.name || 'Sem título'),
        poster: typeof meta.poster === 'string' ? meta.poster : null,
        background: typeof meta.background === 'string' ? meta.background : null,
        description: typeof meta.description === 'string' ? meta.description : '',
        releaseInfo: meta.releaseInfo ? String(meta.releaseInfo) : null,
        genres: Array.isArray(meta.genres) ? meta.genres.filter((g) => typeof g === 'string') : [],
      }))
    }),
  )

  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .slice(0, 24)
}

export async function fetchFallbackMeta(type, metaId) {
  assertSafeSegment(type, 'Tipo')
  assertSafeSegment(metaId, 'ID de mídia')
  const url = `https://v3-cinemeta.strem.io/meta/${encodeURIComponent(type)}/${encodeURIComponent(metaId)}.json`
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => ({}))
  const meta = payload?.meta
  if (!meta) return null
  return await localizeMetaToPtBr(normalizeMetaPayload(meta, type, metaId))
}
