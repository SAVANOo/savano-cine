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
}

export type AvatarGroup = {
  series: string
  options: AvatarOption[]
}

export const PROFILE_AVATAR_GROUPS: AvatarGroup[] = [
  {
    series: 'Os Clássicos',
    options: [
      { key: 'savino', label: 'Savino', gradient: 'linear-gradient(145deg, #e85a82, #8b4ed1)', badge: 'S' },
      { key: 'ruby', label: 'Cinema', gradient: 'linear-gradient(145deg, #ef4444, #991b1b)', badge: '▶' },
      { key: 'amber', label: 'Pipoca', gradient: 'linear-gradient(145deg, #f59e0b, #b45309)', badge: '★' },
      { key: 'cyan', label: 'Noturno', gradient: 'linear-gradient(145deg, #06b6d4, #1e3a8a)', badge: '☾' },
    ],
  },
  {
    series: 'South Park',
    options: [
      { key: 'cartman', label: 'Cartman', gradient: 'linear-gradient(145deg, #38bdf8 0 35%, #dc2626 36% 70%, #facc15 71%)', badge: 'C' },
      { key: 'south-park', label: 'Stan', gradient: 'linear-gradient(145deg, #2563eb 0 38%, #dc2626 39% 65%, #78350f 66%)', badge: 'S' },
      { key: 'kyle', label: 'Kyle', gradient: 'linear-gradient(145deg, #22c55e 0 40%, #ea580c 41% 100%)', badge: 'K' },
      { key: 'kenny', label: 'Kenny', gradient: 'linear-gradient(145deg, #f97316, #9a3412)', badge: 'M' },
    ],
  },
  {
    series: 'Ben 10',
    options: [
      { key: 'ben-10', label: 'Omnitrix', gradient: 'linear-gradient(145deg, #a3e635 0 38%, #18181b 39% 100%)', badge: '10' },
      { key: 'chama', label: 'Chama', gradient: 'linear-gradient(145deg, #fde047, #dc2626)', badge: '🔥' },
      { key: 'xlr8', label: 'XLR8', gradient: 'linear-gradient(145deg, #0ea5e9, #0f172a)', badge: '⚡' },
      { key: 'diamante', label: 'Diamante', gradient: 'linear-gradient(145deg, #2dd4bf, #0f766e)', badge: '◆' },
    ],
  },
  {
    series: 'Gravity Falls',
    options: [
      { key: 'dipper', label: 'Dipper', gradient: 'linear-gradient(145deg, #3b82f6 0 42%, #e2e8f0 43% 100%)', badge: '🌲' },
      { key: 'mabel', label: 'Mabel', gradient: 'linear-gradient(145deg, #ec4899, #8b5cf6)', badge: '★' },
      { key: 'bill', label: 'Bill', gradient: 'linear-gradient(145deg, #facc15, #ca8a04)', badge: '▲' },
      { key: 'soos', label: 'Soos', gradient: 'linear-gradient(145deg, #84cc16, #3f6212)', badge: '?' },
    ],
  },
]

export function getAvatarStyle(avatarKey: string): { background: string; badge: string } {
  for (const group of PROFILE_AVATAR_GROUPS) {
    const found = group.options.find((opt) => opt.key === avatarKey)
    if (found) return { background: found.gradient, badge: found.badge }
  }
  return { background: 'linear-gradient(145deg, #e85a82, #8b4ed1)', badge: avatarKey.slice(0, 1).toUpperCase() || 'S' }
}
