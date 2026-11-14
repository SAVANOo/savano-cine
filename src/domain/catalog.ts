export type MediaKind = 'Filme' | 'Série'

export type Artwork = {
  posterUrl?: string
  bannerUrl?: string
  localPath?: string
  providerId?: string
  source: 'local' | 'tmdb' | 'tvmaze' | 'generated' | 'none'
  verified: boolean
}

export type Rating = {
  score: number
  review?: string
}

export type Profile = {
  id: string
  name: string
  avatarKey: 'cartman' | 'south-park' | 'ben-10' | 'savino'
  isKids?: boolean
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
  mediaUrl?: string
  subtitleUrl?: string
  mediaId?: string
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
  year?: number
  overview?: string
  genres?: string[]
  posterClass: string
  artwork: Artwork
  tags?: string[]
  rating?: Rating
  progress?: number
  seasons?: Season[]
  mediaUrl?: string
  subtitleUrl?: string
  mediaId?: string
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
