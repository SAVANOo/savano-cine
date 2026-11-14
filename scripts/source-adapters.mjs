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
    return Array.isArray(items) ? items : []
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
