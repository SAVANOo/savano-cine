import { HeartHandshake, MessageSquareHeart, Send, Sparkles, Star, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { LibraryItem, Profile } from '../../domain/catalog'
import { getAvatarStyle } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { SavanoLoader } from '../ui/SavanoLoader'

type SocialReview = {
  id: string
  profileId: string
  authorName: string
  authorAvatarKey: string
  contentKey: string
  contentType: 'movie' | 'series'
  title: string
  poster: string | null
  rating: number
  comment: string
  recommendedToProfileId: string | null
  recommendedToName: string | null
  updatedAt: string
}

type SocialFeedPayload = {
  reviews: SocialReview[]
  recommendedForMe: SocialReview[]
  stats: {
    watchedCount: number
    reviewCount: number
    avgRating: number
  }
}

type SocialFeedViewProps = {
  activeProfile: Profile
  profiles: Profile[]
  localCatalog: LibraryItem[]
  onOpenLocalItem: (item: LibraryItem) => void
  onSearchTitle: (title: string) => void
}

/** Social Space: community reviews, ratings, profile stats and recommendations between household profiles. */
export function SocialFeedView({
  activeProfile,
  profiles,
  localCatalog,
  onOpenLocalItem,
  onSearchTitle,
}: SocialFeedViewProps) {
  const [data, setData] = useState<SocialFeedPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [titleInput, setTitleInput] = useState('')
  const [selectedLocalId, setSelectedLocalId] = useState('')
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [recommendedTo, setRecommendedTo] = useState('')
  const [posting, setPosting] = useState(false)
  const [feedback, setFeedback] = useState('')

  const loadFeed = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/social/feed?profileId=${encodeURIComponent(activeProfile.id)}`)
      if (res.ok) {
        const payload = (await res.json()) as SocialFeedPayload
        setData(payload)
      }
    } finally {
      setLoading(false)
    }
  }, [activeProfile.id])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const chosenLocal = localCatalog.find((item) => item.id === selectedLocalId)
    const finalTitle = (chosenLocal?.title || titleInput).trim()
    if (!finalTitle) return
    setPosting(true)
    setFeedback('')
    try {
      const res = await fetch('/api/social/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: activeProfile.id,
          contentKey: chosenLocal?.id || `title:${finalTitle.toLowerCase()}`,
          contentType: chosenLocal?.kind === 'Série' ? 'series' : 'movie',
          title: finalTitle,
          poster: chosenLocal?.artwork.posterUrl || chosenLocal?.artwork.bannerUrl || null,
          rating,
          comment: comment.trim(),
          recommendedToProfileId: recommendedTo || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setFeedback(err?.error || 'Erro ao publicar avaliação.')
        return
      }
      setTitleInput('')
      setSelectedLocalId('')
      setComment('')
      setRecommendedTo('')
      setFeedback('Avaliação publicada no Espaço Social!')
      await loadFeed()
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(reviewId: string) {
    await fetch(`/api/social/reviews/${encodeURIComponent(reviewId)}`, { method: 'DELETE' })
    await loadFeed()
  }

  function openReviewTarget(review: SocialReview) {
    const matched = localCatalog.find(
      (item) => item.id === review.contentKey || item.title.toLowerCase() === review.title.toLowerCase(),
    )
    if (matched) {
      onOpenLocalItem(matched)
    } else {
      onSearchTitle(review.title)
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-2xl font-black tracking-tight text-[var(--sc-text-primary)]">
            <Users className="h-6 w-6 text-[var(--sc-accent)]" />
            Espaço Social &amp; Avaliações
          </h1>
          <p className="mt-1 mb-0 text-xs text-[var(--sc-text-secondary)]">
            Veja o que outras pessoas da casa estão assistindo, avaliando e indicando para você.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4">
            <p className="m-0 text-xs font-semibold text-[var(--sc-text-muted)]">Assistidos ({activeProfile.name})</p>
            <p className="mt-1 mb-0 text-2xl font-black text-[var(--sc-text-primary)]">{data.stats.watchedCount}</p>
          </div>
          <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4">
            <p className="m-0 text-xs font-semibold text-[var(--sc-text-muted)]">Suas Avaliações</p>
            <p className="mt-1 mb-0 text-2xl font-black text-[var(--sc-text-primary)]">{data.stats.reviewCount}</p>
          </div>
          <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4">
            <p className="m-0 text-xs font-semibold text-[var(--sc-text-muted)]">Sua Nota Média</p>
            <p className="mt-1 mb-0 flex items-center gap-1.5 text-2xl font-black text-[var(--sc-accent)]">
              <Star className="h-5 w-5 fill-current" />
              {data.stats.avgRating > 0 ? data.stats.avgRating : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Recommended for Active Profile */}
      {data && data.recommendedForMe.length > 0 && (
        <div className="space-y-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-accent)]/40 bg-[var(--sc-accent-soft)] p-5">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
            <HeartHandshake className="h-5 w-5 text-[var(--sc-accent)]" />
            Indicados para {activeProfile.name} ({data.recommendedForMe.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {data.recommendedForMe.map((rec) => (
              <div
                key={`rec-${rec.id}`}
                className="flex items-start justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-3.5"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--sc-text-primary)]">{rec.title}</span>
                    <Badge tone="gold">{rec.rating}★</Badge>
                  </div>
                  <p className="m-0 text-xs text-[var(--sc-text-secondary)]">
                    Indicado por <strong>{rec.authorName}</strong>
                    {rec.comment ? `: "${rec.comment}"` : ''}
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => openReviewTarget(rec)}>
                  Ver título
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Review & Recommendation Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5"
      >
        <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
          <MessageSquareHeart className="h-5 w-5 text-[var(--sc-accent)]" />
          Compartilhar Avaliação ou Indicação
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={selectedLocalId}
            onChange={(e) => {
              setSelectedLocalId(e.target.value)
              const found = localCatalog.find((i) => i.id === e.target.value)
              if (found) setTitleInput(found.title)
            }}
            className="h-10 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs text-[var(--sc-text-primary)]"
          >
            <option value="">Escolher do Acervo Local (ou digite ao lado)...</option>
            {localCatalog.slice(0, 120).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} ({item.kind})
              </option>
            ))}
          </select>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => {
              setTitleInput(e.target.value)
              if (selectedLocalId) setSelectedLocalId('')
            }}
            placeholder="Nome do filme ou série (ex.: Duna, Gravity Falls...)"
            required
            className="h-10 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[var(--sc-text-secondary)]">Nota:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                className="p-0.5 cursor-pointer"
                aria-label={`${star} estrela(s)`}
              >
                <Star
                  className={`h-5 w-5 ${
                    star <= rating ? 'fill-[var(--sc-accent)] text-[var(--sc-accent)]' : 'text-[var(--sc-text-muted)]'
                  }`}
                />
              </button>
            ))}
          </div>

          <select
            value={recommendedTo}
            onChange={(e) => setRecommendedTo(e.target.value)}
            className="h-9 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs text-[var(--sc-text-primary)]"
          >
            <option value="">Indicar para alguém? (opcional)</option>
            {profiles
              .filter((p) => p.id !== activeProfile.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  Indicar para {p.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="O que você achou? Vale a pena assistir?"
            maxLength={500}
            className="min-w-[240px] flex-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-2 text-xs text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]"
          />
          <Button type="submit" disabled={posting}>
            <Send className="h-3.5 w-3.5" />
            {posting ? 'Publicando...' : 'Publicar'}
          </Button>
        </div>
        {feedback && <p className="m-0 text-xs font-medium text-[var(--sc-accent)]">{feedback}</p>}
      </form>

      {/* Community Feed */}
      <div className="space-y-3">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold text-[var(--sc-text-primary)]">
          <Sparkles className="h-4 w-4 text-[var(--sc-accent)]" />
          Avaliações Recentes da Comunidade ({data?.reviews.length ?? 0})
        </h2>
        {loading ? (
          <SavanoLoader label="Carregando avaliações da comunidade..." />
        ) : !data || data.reviews.length === 0 ? (
          <p className="rounded-[var(--sc-radius-lg)] border border-dashed border-[var(--sc-border-subtle)] p-8 text-center text-xs text-[var(--sc-text-muted)]">
            Nenhuma avaliação postada ainda. Seja o primeiro a avaliar ou indicar um título!
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.reviews.map((rev) => {
              const avatar = getAvatarStyle(rev.authorAvatarKey)
              const canDelete = rev.profileId === activeProfile.id && !rev.id.startsWith('legacy-')
              return (
                <article
                  key={rev.id}
                  className="flex gap-3.5 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4"
                >
                  {rev.poster ? (
                    <img
                      src={rev.poster}
                      alt={rev.title}
                      className="h-24 w-16 shrink-0 rounded-[var(--sc-radius-sm)] object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-[var(--sc-radius-sm)] bg-[var(--sc-bg-surface)] p-1 text-center text-[10px] font-bold text-[var(--sc-text-muted)]">
                      {rev.title}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-white"
                          style={{ background: avatar.background }}
                        >
                          {avatar.imageUrl ? (
                            <img src={avatar.imageUrl} alt={rev.authorName} className="h-full w-full object-cover" />
                          ) : (
                            avatar.badge
                          )}
                        </span>
                        <span className="text-xs font-bold text-[var(--sc-text-primary)]">{rev.authorName}</span>
                        <span className="text-[11px] text-[var(--sc-text-muted)]">
                          {new Date(rev.updatedAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(rev.id)}
                          title="Excluir avaliação"
                          className="text-[var(--sc-text-muted)] hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openReviewTarget(rev)}
                        className="border-0 bg-transparent p-0 text-left text-sm font-bold text-[var(--sc-text-primary)] hover:text-[var(--sc-accent)] cursor-pointer"
                      >
                        {rev.title}
                      </button>
                      <Badge tone="gold">{'★'.repeat(rev.rating)}</Badge>
                      {rev.recommendedToName && (
                        <Badge tone="accent">Indicado para {rev.recommendedToName}</Badge>
                      )}
                    </div>
                    {rev.comment && (
                      <p className="m-0 text-xs leading-relaxed text-[var(--sc-text-secondary)]">“{rev.comment}”</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
