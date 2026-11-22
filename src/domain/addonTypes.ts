export type AddonMetaSummary = {
  id: string
  type: string
  name: string
  poster: string | null
  background?: string | null
  description: string
  releaseInfo: string | null
  runtime?: string | null
  genres?: string[]
  addonId?: string
  addonName?: string
  videos?: Array<{
    id: string
    title: string
    season: number | null
    episode: number | null
    thumbnail: string | null
    overview: string
  }>
}
