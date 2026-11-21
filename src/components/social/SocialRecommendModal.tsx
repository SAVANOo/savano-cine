import { Send, Star } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Profile } from '../../domain/catalog'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

type SocialRecommendModalProps = {
  open: boolean
  onClose: () => void
  profileId: string
  profiles: Profile[]
  contentKey: string
  contentType: 'movie' | 'series'
  title: string
  poster?: string | null
}

/** Shared modal to post a rating, comment, or recommendation to another profile directly from any title detail page. */
export function SocialRecommendModal({
  open,
  onClose,
  profileId,
  profiles,
  contentKey,
  contentType,
  title,
  poster,
}: SocialRecommendModalProps) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [recommendedTo, setRecommendedTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus('')
    try {
      const res = await fetch('/api/social/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          contentKey,
          contentType,
          title,
          poster: poster || null,
          rating,
          comment: comment.trim(),
          recommendedToProfileId: recommendedTo || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setStatus(err?.error || 'Falha ao salvar avaliação.')
        return
      }
      setStatus('Publicado no Espaço Social!')
      window.setTimeout(() => {
        setStatus('')
        setComment('')
        onClose()
      }, 650)
    } catch {
      setStatus('Erro de rede ao publicar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Avaliar / Indicar · ${title}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--sc-text-secondary)]">Sua nota:</span>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-label={`${star} estrela(s)`}
              className="p-0.5 cursor-pointer"
            >
              <Star
                className={`h-5 w-5 ${
                  star <= rating ? 'fill-[var(--sc-accent)] text-[var(--sc-accent)]' : 'text-[var(--sc-text-muted)]'
                }`}
              />
            </button>
          ))}
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-semibold text-[var(--sc-text-secondary)]">Indicar para outro perfil (opcional)</span>
          <select
            value={recommendedTo}
            onChange={(e) => setRecommendedTo(e.target.value)}
            className="h-9 w-full rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs text-[var(--sc-text-primary)]"
          >
            <option value="">Apenas publicar no feed da Comunidade</option>
            {profiles
              .filter((p) => p.id !== profileId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  Indicar para {p.name}
                </option>
              ))}
          </select>
        </label>

        <label className="block space-y-1 text-xs">
          <span className="font-semibold text-[var(--sc-text-secondary)]">Comentário</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="O que achou deste título?"
            className="w-full rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-2.5 text-xs text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)]"
          />
        </label>

        {status && <p className="m-0 text-xs font-semibold text-[var(--sc-accent)]">{status}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            <Send className="h-3.5 w-3.5" />
            {saving ? 'Salvando...' : 'Publicar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
