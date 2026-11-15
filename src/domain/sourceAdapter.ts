export type SourceAdapterKind = 'local' | 'self_hosted' | 'stremio_addon' | 'licensed_provider'

export type StremioAddonCatalog = {
  type: string
  id: string
  name: string
}

export type StremioAddonDescriptor = {
  id: string
  manifestUrl: string
  baseUrl: string
  name: string
  version: string
  description: string
  logo?: string | null
  types: string[]
  resources: string[]
  catalogs: StremioAddonCatalog[]
  enabled: boolean
}

export type SourceItemDescriptor = {
  externalId: string
  title: string
  kind: 'movie' | 'episode' | 'collection' | 'other'
  relativePath: string
  year?: number
  extension: string
  fileSize?: number
  durationSeconds?: number
}

export type SourceStreamDescriptor = {
  url: string
  mimeType: string
  supportsRange: boolean
}

export type SourceAdapterCapabilities = {
  supportsOfflineDetection: boolean
  supportsSubtitleDiscovery: boolean
  supportsArtworkDiscovery: boolean
  modifiesPhysicalFiles: false
}

export interface SourceAdapter {
  readonly id: string
  readonly kind: SourceAdapterKind
  readonly label: string
  readonly capabilities: SourceAdapterCapabilities
  checkAvailability(rootPath: string): Promise<'online' | 'offline' | 'unknown'>
  listItems(rootPath: string): Promise<SourceItemDescriptor[]>
  resolveStream(rootPath: string, relativePath: string): Promise<SourceStreamDescriptor>
}
