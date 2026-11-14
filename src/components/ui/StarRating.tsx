import { Star } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Rating } from '../../domain/catalog'
import { Button } from './Button'

type StarRatingProps = {
  mediaId: string
  profileId: string
  initialRating?: Rating
  onSaved: () => void
}

/** 5-star interactive rating control mapped to the backend 0..10 scale. */
export function StarRating({ mediaId, profileId, initialRating, onSaved }: StarRatingProps) {
  const [stars, setStars] = useState(() => (initialRating?.score ? Math.max(1, Math.min(5, Math.round(initialRating.score / 2))) : 0))
  const [hovered, setHovered] = useState(0)
  const [review, setReview] = useState(initialRating?.review ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const activeStars = hovered || stars

  async function saveRating(event: FormEvent) {
    event.preventDefault()
    if (!stars) return
    setSaving(true)
    setStatus('')
    try {
      const response = await fetch('/api/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, mediaId, score: stars * 2, review }),
      })
      if (!response.ok) throw new Error('Falha ao salvar avaliação')
      setStatus('Avaliação salva')
      onSaved()
    } catch {
      setStatus('Erro ao salvar avaliação')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={saveRating}
      className="flex flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-secondary)]">
          Sua avaliação
        </span>
        <span className="text-xs font-semibold text-[var(--sc-gold)]">
          {stars > 0 ? `${stars}/5 estrelas` : 'Sem nota'}
        </span>
      </div>

      <div className="flex items-center gap-1.5" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = value <= activeStars
          return (
            <button
              key={value}
              type="button"
              aria-label={`Avaliar com ${value} estrela${value > 1 ? 's' : ''}`}
              onMouseEnter={() => setHovered(value)}
              onClick={() => setStars(value)}
              className="rounded-md p-1 transition-transform hover:scale-110 cursor-pointer"
            >
              <Star
                className={`h-6 w-6 transition-colors ${
                  filled ? 'fill-[var(--sc-gold)] text-[var(--sc-gold)]' : 'text-white/25'
                }`}
              />
            </button>
          )
        })}
      </div>

      <div className="flex gap-2">
        <input
          value={review}
          onChange={(event) => setReview(event.target.value)}
          placeholder="Comentário rápido (opcional)"
          className="h-9 min-w-0 flex-1 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-black/40 px-3 text-xs text-white placeholder:text-[var(--sc-text-muted)] focus:border-[var(--sc-accent)] focus:outline-none"
        />
        <Button type="submit" variant="primary" size="sm" disabled={saving || !stars}>
          {saving ? '...' : 'Salvar'}
        </Button>
      </div>
      {status && <p className="m-0 text-[11px] text-[var(--sc-text-secondary)]">{status}</p>}
    </form>
  )
}
