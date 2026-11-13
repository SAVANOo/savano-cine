export type MediaKind = 'Filme' | 'Série'

export type Artwork = {
  posterUrl?: string
  localPath?: string
  providerId?: string
  source: 'local' | 'tmdb' | 'generated' | 'none'
  verified: boolean
}

export type SubtitleTrack = {
  language: string
  label: string
  available: boolean
  localPath?: string
  provider?: 'embedded' | 'opensubtitles' | 'manual' | 'none'
}

export type Episode = {
  id: string
  season: number
  number: number
  title: string
  filename: string
  duration: string
  progress?: number
  position?: string
  subtitles: SubtitleTrack[]
}

export type Season = {
  number: number
  episodes: Episode[]
}

export type LibraryItem = {
  id: string
  title: string
  kind: MediaKind
  meta: string
  detail: string
  posterClass: string
  artwork: Artwork
  progress?: number
  seasons?: Season[]
}

export type MediaSource = {
  id: string
  name: string
  path: string
  status: 'online' | 'offline'
  removable: boolean
  itemCount: number
  volumeLabel?: string
}
