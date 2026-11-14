import { existsSync } from 'node:fs'
import path from 'node:path'
import { findMountedSource, getRootRelativePath, getVolumeInfoForPath } from './volume-info.mjs'

export class LocalSourceAdapter {
  constructor() {
    this.id = 'local-fs'
    this.kind = 'local'
    this.label = 'Acervo local / HD externo'
    this.capabilities = {
      supportsOfflineDetection: true,
      supportsSubtitleDiscovery: true,
      supportsArtworkDiscovery: true,
      modifiesPhysicalFiles: false,
    }
  }

  async checkAvailability(source) {
    if (!source?.root_path) return 'unknown'
    const withRelative = {
      ...source,
      root_relative_path: source.root_relative_path || getRootRelativePath(source.root_path),
    }
    const mounted = findMountedSource(withRelative)
    if (mounted) return 'online'
    return existsSync(source.root_path) ? 'online' : 'offline'
  }

  describeNewSource(rootPath, name) {
    const resolved = path.resolve(rootPath)
    const volume = getVolumeInfoForPath(resolved)
    return {
      rootPath: resolved,
      rootRelativePath: getRootRelativePath(resolved),
      name: name?.trim() || volume.label || path.basename(resolved) || resolved,
      volumeId: volume.volumeId,
      volumeLabel: volume.label,
      removable: volume.removable ? 1 : 0,
      status: existsSync(resolved) ? 'online' : 'offline',
    }
  }
}

export class SelfHostedSourceAdapter {
  constructor() {
    this.id = 'self-hosted-http'
    this.kind = 'self_hosted'
    this.label = 'Servidor próprio autorizado (HTTP/HTTPS)'
    this.capabilities = {
      supportsOfflineDetection: true,
      supportsSubtitleDiscovery: false,
      supportsArtworkDiscovery: true,
      modifiesPhysicalFiles: false,
    }
  }

  isSupportedUrl(rootPath) {
    try {
      const parsed = new URL(rootPath)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  async checkAvailability(source) {
    if (!this.isSupportedUrl(source?.root_path)) return 'offline'
    try {
      const base = source.root_path.replace(/\/+$/, '')
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })
      return response.ok ? 'online' : 'offline'
    } catch {
      return 'offline'
    }
  }

  async listItems(rootPath) {
    if (!this.isSupportedUrl(rootPath)) return []
    const base = rootPath.replace(/\/+$/, '')
    const response = await fetch(`${base}/api/library`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []
    const items = await response.json()
    if (!Array.isArray(items)) return []
    return items
      .filter((item) => item && typeof item.title === 'string')
      .map((item) => ({
        externalId: String(item.mediaId || item.id || item.title),
        title: item.title,
        kind: item.kind === 'Série' ? 'collection' : 'movie',
        relativePath: String(item.mediaUrl || `/api/media/${encodeURIComponent(String(item.mediaId || item.id || ''))}`).replace(/^\/+/, ''),
        year: Number.isInteger(item.year) ? item.year : undefined,
        extension: 'mp4',
        overview: typeof item.overview === 'string' ? item.overview : undefined,
      }))
  }

  async syncToDatabase(database, sourceId, rootPath) {
    const items = await this.listItems(rootPath)
    const upsert = database.prepare(`
      INSERT INTO media_items (
        id, source_id, relative_path, title, kind, classification_status,
        classification_reason, year, overview, extension, exists_on_disk
      )
      VALUES (?, ?, ?, ?, 'movie', 'approved', 'self-hosted-adapter', ?, ?, 'mp4', 1)
      ON CONFLICT(source_id, relative_path) DO UPDATE SET
        title = excluded.title,
        year = COALESCE(excluded.year, media_items.year),
        overview = COALESCE(excluded.overview, media_items.overview),
        exists_on_disk = 1,
        updated_at = CURRENT_TIMESTAMP
    `)
    let synced = 0
    for (const item of items) {
      if (item.kind !== 'movie' || !item.relativePath) continue
      const itemId = `remote-${sourceId}-${item.externalId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
      upsert.run(itemId, sourceId, item.relativePath, item.title, item.year || null, item.overview || null)
      synced += 1
    }
    return synced
  }

  resolveStream(rootPath, relativePath) {
    if (!this.isSupportedUrl(rootPath)) return null
    const base = rootPath.replace(/\/+$/, '')
    const clean = String(relativePath || '').replace(/^\/+/, '')
    return {
      url: `${base}/${clean}`,
      mimeType: 'video/mp4',
      supportsRange: true,
    }
  }
}

const localAdapter = new LocalSourceAdapter()
const selfHostedAdapter = new SelfHostedSourceAdapter()

export function getAdapterForSource(sourceOrPath) {
  const target = typeof sourceOrPath === 'string' ? sourceOrPath : sourceOrPath?.root_path
  if (selfHostedAdapter.isSupportedUrl(target || '')) {
    return selfHostedAdapter
  }
  return localAdapter
}
