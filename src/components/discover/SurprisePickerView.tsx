import { Flame, Ghost, Heart, Info, Laugh, Play, RefreshCw, Rocket, Shuffle, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LibraryItem } from '../../domain/catalog'
import type { OnlineMetaDiscoveryItem } from '../../hooks/useOnlineCatalogDiscovery'
import type { AddonMetaSummary } from '../addons/AddonStreamModal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SavanoLoader } from '../ui/SavanoLoader'

type MoodOption = {
  id: string
  label: string
  subtitle: string
  keywords: string[]
  genres: string[]
  icon: typeof Flame
  accentClass: string
}

const MOODS: MoodOption[] = [
  {
    id: 'any',
    label: 'Surpreenda-me',
    subtitle: 'Qualquer estilo ou época',
    keywords: [],
    genres: [],
    icon: Sparkles,
    accentClass: 'from-rose-500/25 to-amber-500/15 border-rose-500/40',
  },
  {
    id: 'action',
    label: 'Adrenalina & Ação',
    subtitle: 'Aventura, ritmo forte e tensão',
    keywords: ['ação', 'acao', 'luta', 'guerra', 'heroi', 'herói', 'aventura', 'tiro', 'rápido'],
    genres: ['Action', 'Adventure', 'Thriller', 'War'],
    icon: Flame,
    accentClass: 'from-orange-500/25 to-red-500/15 border-orange-500/40',
  },
  {
    id: 'comedy',
    label: 'Para Dar Risada',
    subtitle: 'Comédias leves e animações',
    keywords: ['risada', 'engraçado', 'comedia', 'comédia', 'leve', 'família', 'familia', 'animação', 'animacao'],
    genres: ['Comedy', 'Animation', 'Family'],
    icon: Laugh,
    accentClass: 'from-amber-400/25 to-yellow-500/15 border-amber-400/40',
  },
  {
    id: 'drama',
    label: 'Romance & Emoção',
    subtitle: 'Histórias marcantes para ver a dois',
    keywords: ['romance', 'amor', 'casal', 'emocionante', 'drama', 'a dois', 'historia', 'história'],
    genres: ['Drama', 'Romance', 'Music'],
    icon: Heart,
    accentClass: 'from-pink-500/25 to-purple-500/15 border-pink-500/40',
  },
  {
    id: 'scifi',
    label: 'Viagem & Mistério',
    subtitle: 'Ficção científica, fantasia e enigmas',
    keywords: ['espacial', 'espaço', 'futuro', 'sci-fi', 'ficção', 'ficcao', 'mistério', 'misterio', 'fantasia', 'magia'],
    genres: ['Science Fiction', 'Sci-Fi', 'Fantasy', 'Mystery'],
    icon: Rocket,
    accentClass: 'from-cyan-500/25 to-blue-500/15 border-cyan-500/40',
  },
  {
    id: 'horror',
    label: 'Arrepios & Suspense',
    subtitle: 'Terror, crime e suspense psicológico',
    keywords: ['terror', 'medo', 'suspense', 'sombrio', 'crime', 'psicológico', 'psicologico', 'assombração'],
    genres: ['Horror', 'Crime', 'Thriller', 'Mystery'],
    icon: Ghost,
    accentClass: 'from-violet-500/25 to-slate-700/30 border-violet-500/40',
  },
]

type PickCandidate =
  | { source: 'local'; key: string; item: LibraryItem }
  | { source: 'online'; key: string; item: OnlineMetaDiscoveryItem }

type SurprisePickerViewProps = {
  localCatalog: LibraryItem[]
  onlineTrending: OnlineMetaDiscoveryItem[]
  onPlayLocal: (item: LibraryItem) => void
  onOpenLocalDetails: (item: LibraryItem) => void
  onOpenOnlineItem: (item: AddonMetaSummary) => void
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Interactive "Surprise Me" discovery page where users pick a mood or describe what to watch. */
export function SurprisePickerView({
  localCatalog,
  onlineTrending,
  onPlayLocal,
  onOpenLocalDetails,
  onOpenOnlineItem,
}: SurprisePickerViewProps) {
  const [selectedMoodId, setSelectedMoodId] = useState<string>('any')
  const [promptText, setPromptText] = useState('')
  const [sourceScope, setSourceScope] = useState<'both' | 'local' | 'online'>('both')
  const [kindFilter, setKindFilter] = useState<'all' | 'movie' | 'series'>('all')
  const [unwatchedOnly, setUnwatchedOnly] = useState(true)
  const [rolling, setRolling] = useState(false)
  const [currentPick, setCurrentPick] = useState<PickCandidate | null>(null)
  const [history, setHistory] = useState<PickCandidate[]>([])

  const selectedMood = MOODS.find((m) => m.id === selectedMoodId) ?? MOODS[0]

  const candidates = useMemo<PickCandidate[]>(() => {
    const queryWords = normalize(promptText)
      .split(/\s+/)
      .filter((w) => w.length >= 2)

    const inferredMoods = MOODS.filter((m) =>
      m.keywords.some((kw) => queryWords.some((qw) => normalize(kw).includes(qw) || qw.includes(normalize(kw)))),
    )
    const targetGenres = new Set(
      [...selectedMood.genres, ...inferredMoods.flatMap((m) => m.genres)].map((g) => g.toLowerCase()),
    )

    const pool: Array<{ candidate: PickCandidate; score: number }> = []

    if (sourceScope !== 'online') {
      for (const item of localCatalog) {
        if (item.sourceStatus === 'offline') continue
        if (kindFilter === 'movie' && item.kind !== 'Filme') continue
        if (kindFilter === 'series' && item.kind !== 'Série') continue
        if (unwatchedOnly && (item.progress ?? 0) >= 90) continue

        const itemGenres = (item.genres ?? []).map((g) => g.toLowerCase())
        const textBlob = normalize(`${item.title} ${item.overview || ''} ${(item.genres ?? []).join(' ')}`)
        let score = 1
        if (targetGenres.size > 0) {
          const matchesGenre = itemGenres.some((g) => targetGenres.has(g))
          if (matchesGenre) score += 6
        }
        for (const word of queryWords) {
          if (textBlob.includes(word)) score += 4
        }
        if (item.artwork.posterUrl || item.artwork.bannerUrl) score += 2
        if (targetGenres.size === 0 || score > 3 || queryWords.length === 0) {
          pool.push({ candidate: { source: 'local', key: `local:${item.id}`, item }, score })
        }
      }
    }

    if (sourceScope !== 'local') {
      for (const item of onlineTrending) {
        if (kindFilter === 'movie' && item.type !== 'movie') continue
        if (kindFilter === 'series' && item.type === 'movie') continue
        const textBlob = normalize(`${item.name} ${item.description || ''} ${item.addonName}`)
        let score = 2
        for (const word of queryWords) {
          if (textBlob.includes(word)) score += 4
        }
        if (item.poster) score += 2
        pool.push({ candidate: { source: 'online', key: `online:${item.type}:${item.id}`, item }, score })
      }
    }

    const best = pool.filter((entry) => entry.score >= 5)
    return (best.length >= 3 ? best : pool).map((entry) => entry.candidate)
  }, [kindFilter, localCatalog, onlineTrending, promptText, selectedMood, sourceScope, unwatchedOnly])

  function rollSuggestion() {
    if (candidates.length === 0) {
      setCurrentPick(null)
      return
    }
    setRolling(true)
    window.setTimeout(() => {
      const filtered =
        candidates.length > 1 && currentPick
          ? candidates.filter((c) => c.key !== currentPick.key)
          : candidates
      const chosen = filtered[Math.floor(Math.random() * filtered.length)] ?? candidates[0]
      setCurrentPick(chosen)
      setHistory((prev) => [chosen, ...prev.filter((p) => p.key !== chosen.key)].slice(0, 6))
      setRolling(false)
    }, 350)
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-2xl font-black tracking-tight text-[var(--sc-text-primary)]">
            <Sparkles className="h-6 w-6 text-[var(--sc-accent)]" />
            Me Surpreenda
          </h1>
          <p className="mt-1 mb-0 text-xs text-[var(--sc-text-secondary)]">
            Escolha um clima ou descreva o que quer assistir para sortear uma recomendação visual do acervo local ou online.
          </p>
        </div>
        <span className="rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--sc-text-secondary)]">
          {candidates.length} opção(ões) no sorteio
        </span>
      </div>

      {/* Mood Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {MOODS.map((mood) => {
          const Icon = mood.icon
          const active = selectedMoodId === mood.id
          return (
            <button
              key={mood.id}
              type="button"
              onClick={() => setSelectedMoodId(mood.id)}
              className={`flex flex-col items-start gap-2 rounded-[var(--sc-radius-lg)] border bg-gradient-to-br p-3.5 text-left transition cursor-pointer ${
                active
                  ? `${mood.accentClass} ring-2 ring-[var(--sc-accent)] shadow-lg`
                  : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] hover:border-white/30'
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? 'text-[var(--sc-accent)]' : 'text-[var(--sc-text-secondary)]'}`} />
              <div>
                <p className="m-0 text-xs font-bold text-[var(--sc-text-primary)]">{mood.label}</p>
                <p className="mt-0.5 mb-0 text-[11px] leading-snug text-[var(--sc-text-muted)]">{mood.subtitle}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Prompt + Quick Filters + Roll Button */}
      <div className="flex flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Ou descreva o que quer assistir (ex.: viagem espacial, filme leve a dois, animação...)"
            className="h-10 flex-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3.5 text-sm text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] outline-none focus:border-[var(--sc-accent)]"
          />
          <Button type="button" variant="primary" size="lg" onClick={rollSuggestion} disabled={rolling}>
            <Shuffle className="h-4 w-4" />
            {currentPick ? 'Sortear outro' : 'Sortear sugestão'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Origem do sorteio"
            value={sourceScope}
            onChange={(e) => setSourceScope(e.target.value as 'both' | 'local' | 'online')}
            className="h-8 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 text-xs text-[var(--sc-text-primary)]"
          >
            <option value="both">Acervo Local + Online</option>
            <option value="local">Somente Acervo Local</option>
            <option value="online">Somente Online (Addons)</option>
          </select>

          <select
            aria-label="Formato do sorteio"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | 'movie' | 'series')}
            className="h-8 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 text-xs text-[var(--sc-text-primary)]"
          >
            <option value="all">Filmes e Séries</option>
            <option value="movie">Somente Filmes</option>
            <option value="series">Somente Séries</option>
          </select>

          <label className="inline-flex items-center gap-1.5 px-2 text-xs text-[var(--sc-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={unwatchedOnly}
              onChange={(e) => setUnwatchedOnly(e.target.checked)}
              className="accent-[var(--sc-accent)]"
            />
            Priorizar não assistidos
          </label>
        </div>
      </div>

      {/* Picked Suggestion Showcase */}
      {rolling ? (
        <div className="rounded-[var(--sc-radius-xl)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-10">
          <SavanoLoader label="Escolhendo algo especial para você..." />
        </div>
      ) : currentPick ? (
        <section
          data-dark-surface="true"
          className="relative overflow-hidden rounded-[var(--sc-radius-xl)] border border-white/15 bg-neutral-950 shadow-2xl"
        >
          {(() => {
            const isLocal = currentPick.source === 'local'
            const title = isLocal ? currentPick.item.title : currentPick.item.name
            const poster = isLocal ? currentPick.item.artwork.posterUrl : currentPick.item.poster
            const backdrop = isLocal
              ? currentPick.item.artwork.bannerUrl || currentPick.item.artwork.posterUrl
              : currentPick.item.poster
            const overview = isLocal ? currentPick.item.overview : currentPick.item.description
            const year = isLocal ? currentPick.item.year : currentPick.item.releaseInfo
            const genres = isLocal ? currentPick.item.genres?.slice(0, 3) : []
            return (
              <>
                {backdrop ? (
                  <img
                    src={backdrop}
                    alt={title}
                    className="absolute inset-0 h-full w-full object-cover opacity-35 blur-[2px]"
                  />
                ) : null}
                <div className="relative z-10 flex flex-col gap-6 bg-gradient-to-r from-black/95 via-black/80 to-black/45 p-6 sm:flex-row sm:items-center sm:p-8">
                  {poster ? (
                    <img
                      src={poster}
                      alt={title}
                      className="mx-auto h-64 w-44 shrink-0 rounded-[var(--sc-radius-lg)] border border-white/20 object-cover shadow-2xl sm:mx-0"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">
                        {isLocal ? currentPick.item.kind : `Online · ${currentPick.item.addonName}`}
                      </Badge>
                      {year ? <Badge tone="neutral">{year}</Badge> : null}
                      {genres?.map((g) => (
                        <Badge key={g} tone="neutral">
                          {g}
                        </Badge>
                      ))}
                    </div>
                    <h2 className="m-0 text-2xl font-black tracking-tight text-white sm:text-4xl">
                      {title}
                    </h2>
                    <p className="m-0 max-w-2xl text-sm leading-relaxed text-white/85">
                      {overview || 'Título selecionado para o clima escolhido. Clique abaixo para assistir ou ver mais detalhes.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      {isLocal ? (
                        <>
                          <Button type="button" variant="light" size="lg" onClick={() => onPlayLocal(currentPick.item)}>
                            <Play className="h-4 w-4 fill-current" />
                            Assistir agora
                          </Button>
                          <Button type="button" variant="secondary" size="lg" onClick={() => onOpenLocalDetails(currentPick.item)}>
                            <Info className="h-4 w-4" />
                            Ver detalhes
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="light"
                          size="lg"
                          onClick={() =>
                            onOpenOnlineItem({
                              id: currentPick.item.id,
                              type: currentPick.item.type,
                              name: currentPick.item.name,
                              poster: currentPick.item.poster,
                              description: currentPick.item.description || '',
                              releaseInfo: currentPick.item.releaseInfo,
                            })
                          }
                        >
                          <Play className="h-4 w-4 fill-current" />
                          Abrir e Assistir Online
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="lg" onClick={rollSuggestion}>
                        <RefreshCw className="h-4 w-4" />
                        Sortear outro
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )
          })()}
        </section>
      ) : (
        <div className="rounded-[var(--sc-radius-xl)] border border-dashed border-[var(--sc-border-subtle)] p-10 text-center text-sm text-[var(--sc-text-secondary)]">
          Escolha um clima acima e clique em <strong>Sortear sugestão</strong> para receber uma recomendação personalizada.
        </div>
      )}

      {/* Recent Rolls History */}
      {history.length > 1 && (
        <div className="space-y-2.5">
          <h3 className="m-0 text-xs font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
            Últimos sorteados nesta sessão
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {history.map((entry) => {
              const title = entry.source === 'local' ? entry.item.title : entry.item.name
              const poster = entry.source === 'local' ? entry.item.artwork.posterUrl : entry.item.poster
              return (
                <button
                  key={`hist-${entry.key}`}
                  type="button"
                  onClick={() => setCurrentPick(entry)}
                  className="w-28 shrink-0 overflow-hidden rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] text-left transition hover:border-[var(--sc-accent)] cursor-pointer"
                >
                  <div className="aspect-[2/3] w-full bg-black/50">
                    {poster ? (
                      <img src={poster} alt={title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <p className="m-0 truncate p-2 text-[11px] font-semibold text-[var(--sc-text-primary)]">
                    {title}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
