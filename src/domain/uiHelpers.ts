import type { LibraryItem, Season } from './catalog'

const GENRE_TRANSLATIONS: Record<string, string> = {
  action: 'Ação',
  adventure: 'Aventura',
  animation: 'Animação',
  anime: 'Anime',
  children: 'Infantil',
  comedy: 'Comédia',
  crime: 'Crime',
  documentary: 'Documentário',
  drama: 'Drama',
  family: 'Família',
  fantasy: 'Fantasia',
  horror: 'Terror',
  mystery: 'Mistério',
  romance: 'Romance',
  'science-fiction': 'Ficção Científica',
  'sci-fi': 'Ficção Científica',
  supernatural: 'Sobrenatural',
  thriller: 'Suspense',
  western: 'Faroeste',
}

export function translateGenre(genre: string): string {
  const key = genre.trim().toLowerCase()
  return GENRE_TRANSLATIONS[key] ?? genre
}

export type AvatarOption = {
  key: string
  label: string
  gradient: string
  badge: string
  imageUrl: string
}

export type AvatarGroup = {
  series: string
  options: AvatarOption[]
}

export const PROFILE_AVATAR_GROUPS: AvatarGroup[] = [
  {
    series: 'Os Clássicos',
    options: [
      { key: 'savino', label: 'Savino', gradient: 'linear-gradient(145deg, #e85a82, #8b4ed1)', badge: 'S', imageUrl: '/avatars/classicos/savino.svg' },
      { key: 'ruby', label: 'Cinema', gradient: 'linear-gradient(145deg, #ef4444, #991b1b)', badge: '▶', imageUrl: '/avatars/classicos/ruby.svg' },
      { key: 'amber', label: 'Pipoca', gradient: 'linear-gradient(145deg, #f59e0b, #b45309)', badge: '★', imageUrl: '/avatars/classicos/amber.svg' },
      { key: 'cyan', label: 'Noturno', gradient: 'linear-gradient(145deg, #06b6d4, #1e3a8a)', badge: '☾', imageUrl: '/avatars/classicos/cyan.svg' },
    ],
  },
  {
    series: 'South Park',
    options: [
      { key: 'cartman', label: 'Cartman', gradient: 'linear-gradient(145deg, #38bdf8 0 35%, #dc2626 36% 70%, #facc15 71%)', badge: 'C', imageUrl: '/avatars/south-park/cartman.svg' },
      { key: 'south-park', label: 'Stan', gradient: 'linear-gradient(145deg, #2563eb 0 38%, #dc2626 39% 65%, #78350f 66%)', badge: 'S', imageUrl: '/avatars/south-park/south-park.svg' },
      { key: 'kyle', label: 'Kyle', gradient: 'linear-gradient(145deg, #22c55e 0 40%, #ea580c 41% 100%)', badge: 'K', imageUrl: '/avatars/south-park/kyle.svg' },
      { key: 'kenny', label: 'Kenny', gradient: 'linear-gradient(145deg, #f97316, #9a3412)', badge: 'M', imageUrl: '/avatars/south-park/kenny.svg' },
    ],
  },
  {
    series: 'Ben 10',
    options: [
      { key: 'ben-10', label: 'Omnitrix', gradient: 'linear-gradient(145deg, #a3e635 0 38%, #18181b 39% 100%)', badge: '10', imageUrl: '/avatars/ben-10/ben-10.svg' },
      { key: 'chama', label: 'Chama', gradient: 'linear-gradient(145deg, #fde047, #dc2626)', badge: '🔥', imageUrl: '/avatars/ben-10/chama.svg' },
      { key: 'xlr8', label: 'XLR8', gradient: 'linear-gradient(145deg, #0ea5e9, #0f172a)', badge: '⚡', imageUrl: '/avatars/ben-10/xlr8.svg' },
      { key: 'diamante', label: 'Diamante', gradient: 'linear-gradient(145deg, #2dd4bf, #0f766e)', badge: '◆', imageUrl: '/avatars/ben-10/diamante.svg' },
    ],
  },
  {
    series: 'Gravity Falls',
    options: [
      { key: 'dipper', label: 'Dipper', gradient: 'linear-gradient(145deg, #3b82f6 0 42%, #e2e8f0 43% 100%)', badge: '🌲', imageUrl: '/avatars/gravity-falls/dipper.svg' },
      { key: 'mabel', label: 'Mabel', gradient: 'linear-gradient(145deg, #ec4899, #8b5cf6)', badge: '★', imageUrl: '/avatars/gravity-falls/mabel.svg' },
      { key: 'bill', label: 'Bill', gradient: 'linear-gradient(145deg, #facc15, #ca8a04)', badge: '▲', imageUrl: '/avatars/gravity-falls/bill.svg' },
      { key: 'soos', label: 'Soos', gradient: 'linear-gradient(145deg, #84cc16, #3f6212)', badge: '?', imageUrl: '/avatars/gravity-falls/soos.svg' },
    ],
  },
  {
    series: 'DC & Heróis',
    options: [
      { key: 'batman', label: 'Batman', gradient: 'linear-gradient(145deg, #09090b, #facc15)', badge: 'B', imageUrl: '/avatars/dc/batman.svg' },
      { key: 'superman', label: 'Superman', gradient: 'linear-gradient(145deg, #1d4ed8, #dc2626)', badge: 'S', imageUrl: '/avatars/dc/superman.svg' },
      { key: 'flash', label: 'Flash', gradient: 'linear-gradient(145deg, #991b1b, #facc15)', badge: '⚡', imageUrl: '/avatars/dc/flash.svg' },
      { key: 'hellboy', label: 'Hellboy', gradient: 'linear-gradient(145deg, #dc2626, #450a0a)', badge: 'H', imageUrl: '/avatars/dc/hellboy.svg' },
    ],
  },
  {
    series: 'Marvel',
    options: [
      { key: 'spiderman', label: 'Homem-Aranha', gradient: 'linear-gradient(145deg, #dc2626, #111827)', badge: '🕷', imageUrl: '/avatars/marvel/spiderman.svg' },
      { key: 'deadpool', label: 'Deadpool', gradient: 'linear-gradient(145deg, #b91c1c, #09090b)', badge: 'D', imageUrl: '/avatars/marvel/deadpool.svg' },
      { key: 'ironman', label: 'Homem de Ferro', gradient: 'linear-gradient(145deg, #991b1b, #facc15)', badge: 'I', imageUrl: '/avatars/marvel/ironman.svg' },
      { key: 'strange', label: 'Doutor Estranho', gradient: 'linear-gradient(145deg, #311042, #f59e0b)', badge: '✦', imageUrl: '/avatars/marvel/strange.svg' },
    ],
  },
  {
    series: 'Terror & Suspense',
    options: [
      { key: 'ghostface', label: 'Pânico', gradient: 'linear-gradient(145deg, #09090b, #475569)', badge: '👻', imageUrl: '/avatars/terror/ghostface.svg' },
      { key: 'corra', label: 'Corra!', gradient: 'linear-gradient(145deg, #18181b, #dc2626)', badge: '◉', imageUrl: '/avatars/terror/corra.svg' },
      { key: 'jason', label: 'Sexta-Feira 13', gradient: 'linear-gradient(145deg, #1c1917, #e7e5e4)', badge: 'J', imageUrl: '/avatars/terror/jason.svg' },
      { key: 'it', label: 'It: A Coisa', gradient: 'linear-gradient(145deg, #0f172a, #dc2626)', badge: '🎈', imageUrl: '/avatars/terror/it.svg' },
    ],
  },
  {
    series: 'Animação & Nostalgia',
    options: [
      { key: 'shrek', label: 'Shrek', gradient: 'linear-gradient(145deg, #84cc16, #3f6212)', badge: 'S', imageUrl: '/avatars/animacao/shrek.svg' },
      { key: 'simpsons', label: 'Os Simpsons', gradient: 'linear-gradient(145deg, #1d4ed8, #f472b6)', badge: '🍩', imageUrl: '/avatars/animacao/simpsons.svg' },
      { key: 'scooby', label: 'Scooby-Doo', gradient: 'linear-gradient(145deg, #06b6d4, #facc15)', badge: '🐾', imageUrl: '/avatars/animacao/scooby.svg' },
      { key: 'stitch', label: 'Stitch', gradient: 'linear-gradient(145deg, #0ea5e9, #0c4a6e)', badge: '★', imageUrl: '/avatars/animacao/stitch.svg' },
    ],
  },
]

export function getAvatarStyle(avatarKey: string): { background: string; badge: string; imageUrl?: string } {
  for (const group of PROFILE_AVATAR_GROUPS) {
    const found = group.options.find((opt) => opt.key === avatarKey)
    if (found) return { background: found.gradient, badge: found.badge, imageUrl: found.imageUrl }
  }
  return { background: 'linear-gradient(145deg, #e85a82, #8b4ed1)', badge: avatarKey.slice(0, 1).toUpperCase() || 'S' }
}

export type PlayableMedia = {
  title: string
  url: string
  subtitleUrl?: string
  mediaId?: string
  needsTranscode?: boolean
  overview?: string
  year?: number
  startPosition?: number
  nextEpisode?: PlayableMedia
  showTitle?: string
  showSeasons?: Season[]
}

/** Find the sequential next playable episode in a series after `currentMediaId`. */
export function findNextEpisode(item: LibraryItem, currentMediaId?: string): PlayableMedia | undefined {
  if (!currentMediaId || !item.seasons?.length) return undefined
  const flat: Array<{ season: number; ep: NonNullable<LibraryItem['seasons']>[number]['episodes'][number] }> = []
  for (const season of item.seasons) {
    for (const ep of season.episodes) {
      if (ep.mediaUrl) flat.push({ season: season.number, ep })
    }
  }
  const idx = flat.findIndex((entry) => entry.ep.mediaId === currentMediaId)
  if (idx < 0 || idx + 1 >= flat.length) return undefined
  const next = flat[idx + 1]
  return {
    title: `${item.title} — T${next.season}:E${next.ep.number} ${next.ep.title}`,
    url: next.ep.mediaUrl!,
    subtitleUrl: next.ep.subtitleUrl,
    mediaId: next.ep.mediaId,
    needsTranscode: next.ep.needsTranscode,
    overview: item.overview,
    year: item.year,
    startPosition: 0,
    showTitle: item.title,
    showSeasons: item.seasons,
    nextEpisode: findNextEpisode(item, next.ep.mediaId),
  }
}

/** Resolve the best playable stream for a movie or series (preferring active resume target). */
export function resolvePlayableMedia(item: LibraryItem, restart = false): PlayableMedia | null {
  if (item.resume?.mediaUrl) {
    const suffix = item.resume.season && item.resume.episode
      ? ` — T${item.resume.season}:E${item.resume.episode}`
      : ''
    return {
      title: `${item.title}${suffix}`,
      url: item.resume.mediaUrl,
      subtitleUrl: item.resume.subtitleUrl ?? item.subtitleUrl,
      mediaId: item.resume.mediaId ?? item.mediaId,
      needsTranscode: item.resume.needsTranscode ?? item.needsTranscode,
      overview: item.overview,
      year: item.year,
      startPosition: restart ? 0 : item.resume.position,
      showTitle: item.kind === 'Série' ? item.title : undefined,
      showSeasons: item.kind === 'Série' ? item.seasons : undefined,
      nextEpisode: findNextEpisode(item, item.resume.mediaId),
    }
  }

  if (item.kind === 'Filme' && item.mediaUrl) {
    return {
      title: item.title,
      url: item.mediaUrl,
      subtitleUrl: item.subtitleUrl,
      mediaId: item.mediaId,
      needsTranscode: item.needsTranscode,
      overview: item.overview,
      year: item.year,
      startPosition: restart ? 0 : undefined,
    }
  }

  for (const season of item.seasons ?? []) {
    const first = season.episodes.find((ep) => Boolean(ep.mediaUrl))
    if (first?.mediaUrl) {
      return {
        title: `${item.title} — T${season.number}:E${first.number} ${first.title}`,
        url: first.mediaUrl,
        subtitleUrl: first.subtitleUrl,
        mediaId: first.mediaId,
        needsTranscode: first.needsTranscode,
        overview: item.overview,
        year: item.year,
        startPosition: restart ? 0 : undefined,
        showTitle: item.title,
        showSeasons: item.seasons,
        nextEpisode: findNextEpisode(item, first.mediaId),
      }
    }
  }

  return null
}

/** Rank related titles by shared genres and matching kind for "Você também pode gostar". */
export function getRelatedItems(target: LibraryItem, library: LibraryItem[], limit = 12): LibraryItem[] {
  const targetGenres = new Set((target.genres ?? []).map((g) => g.toLowerCase()))
  return library
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => {
      let score = candidate.kind === target.kind ? 1 : 0
      for (const g of candidate.genres ?? []) {
        if (targetGenres.has(g.toLowerCase())) score += 3
      }
      if (candidate.artwork.verified) score += 0.5
      return { candidate, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

