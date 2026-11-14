import { useState } from 'react'
import type { ReviewItem } from '../../domain/catalog'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

export type CatalogRefreshStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed'
  startedAt?: string | null
  finishedAt?: string | null
  sourceIds: string[]
  results: Array<{ sourceId: string; status: string; message: string }>
  error?: string | null
}

export type ArtworkCandidate = {
  id: string
  provider: string
  providerId: string
  title: string
  year?: number
  overview?: string
  posterUrl?: string
  backdropUrl?: string
  language?: string
}

export type ArtworkCandidateGroup = {
  targetType: 'movie' | 'show'
  targetId: string
  title: string
  year?: number
  candidates: ArtworkCandidate[]
}

export type CatalogHistory = {
  archived: Array<{
    id: string
    title: string
    kind: string
    deletedAt: string
    relativePath: string
    sourceName: string
  }>
  titleChanges: Array<{
    id: string
    mediaItemId: string
    oldTitle: string
    newTitle: string
    reason: string
    createdAt: string
    currentTitle: string
    deletedAt?: string
    relativePath: string
    sourceName: string
  }>
}

export function ReviewModal({
  open,
  items,
  error,
  onRefresh,
  onClose,
}: {
  open: boolean
  items: ReviewItem[]
  error: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  async function runAction(id: string, action: 'approve-movie' | 'set-other' | 'ignore') {
    setBusyId(id)
    setActionError('')
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao atualizar item.')
      }
      onRefresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao atualizar revisão.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="REVISÃO DO CATÁLOGO"
      title="Itens pendentes de classificação"
      subtitle="Nenhuma ação altera seus arquivos físicos no disco."
      maxWidthClass="max-w-3xl"
    >
      <div className="flex flex-col gap-3">
        {(error || actionError) && (
          <p className="m-0 rounded-[var(--sc-radius-md)] border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-200">
            {actionError || error}
          </p>
        )}

        {items.length === 0 ? (
          <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-8 text-center text-sm text-[var(--sc-text-muted)]">
            Nenhum item pendente de revisão.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-white">{item.title}</strong>
                <p className="mt-1 mb-0 truncate text-xs text-[var(--sc-text-muted)]">
                  {item.sourceName} · {item.relativePath}
                </p>
                {item.reason && (
                  <p className="mt-1 mb-0 text-[11px] text-[var(--sc-text-secondary)]">
                    Motivo: {item.reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busyId === item.id}
                  onClick={() => void runAction(item.id, 'approve-movie')}
                >
                  É filme
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === item.id}
                  onClick={() => void runAction(item.id, 'set-other')}
                >
                  Especial
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === item.id}
                  onClick={() => void runAction(item.id, 'ignore')}
                >
                  Ignorar
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

export function ArtworkReviewModal({
  open,
  groups,
  error,
  onRefresh,
  onClose,
}: {
  open: boolean
  groups: ArtworkCandidateGroup[]
  error: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  async function decide(candidateId: string, decision: 'confirm' | 'reject') {
    setBusyId(candidateId)
    setActionError('')
    try {
      const response = await fetch(
        `/api/artwork/candidates/${encodeURIComponent(candidateId)}/${decision}`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Não foi possível aplicar a decisão.')
      }
      onRefresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao atualizar candidato.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="METADADOS E ARTE"
      title="Revisão de correspondências"
      subtitle="Confirme o candidato correto antes de salvar arte e sinopse no catálogo."
      maxWidthClass="max-w-4xl"
    >
      <div className="flex flex-col gap-4">
        {(error || actionError) && (
          <p className="m-0 rounded-[var(--sc-radius-md)] border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-200">
            {actionError || error}
          </p>
        )}

        {groups.length === 0 ? (
          <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-8 text-center text-sm text-[var(--sc-text-muted)]">
            Nenhuma correspondência ambígua aguardando confirmação. Execute{' '}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">npm run artwork</code>{' '}
            para coletar novos metadados.
          </div>
        ) : (
          groups.map((group) => (
            <div
              key={`${group.targetType}:${group.targetId}`}
              className="flex flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm text-white">
                  {group.title} {group.year ? `(${group.year})` : ''}
                </strong>
                <span className="text-xs text-[var(--sc-text-muted)]">
                  {group.candidates.length} candidato(s)
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {group.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="flex gap-3 rounded-[var(--sc-radius-md)] border border-white/10 bg-black/30 p-3"
                  >
                    {candidate.posterUrl && (
                      <img
                        src={candidate.posterUrl}
                        alt={candidate.title}
                        className="h-24 w-16 shrink-0 rounded object-cover"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                      <div>
                        <strong className="block truncate text-xs text-white">
                          {candidate.title} {candidate.year ? `(${candidate.year})` : ''}
                        </strong>
                        <p className="mt-1 mb-0 line-clamp-2 text-[11px] text-[var(--sc-text-muted)]">
                          {candidate.overview || `Fonte: ${candidate.provider}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === candidate.id}
                          onClick={() => void decide(candidate.id, 'confirm')}
                        >
                          Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === candidate.id}
                          onClick={() => void decide(candidate.id, 'reject')}
                        >
                          Descartar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

export function HistoryModal({
  open,
  history,
  onRefresh,
  onClose,
}: {
  open: boolean
  history: CatalogHistory
  onRefresh: () => void
  onClose: () => void
}) {
  const [savingId, setSavingId] = useState('')

  async function restore(url: string) {
    setSavingId(url)
    try {
      const response = await fetch(url, { method: 'POST' })
      if (!response.ok) throw new Error('Falha ao restaurar')
      onRefresh()
    } finally {
      setSavingId('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="CATÁLOGO"
      title="Histórico e restauração"
      subtitle="As ações alteram somente o catálogo; nenhum arquivo físico é movido ou apagado."
      maxWidthClass="max-w-3xl"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-bold text-white">Itens arquivados</h3>
          {history.archived.length === 0 ? (
            <p className="m-0 text-xs text-[var(--sc-text-muted)]">Nenhum item arquivado.</p>
          ) : (
            history.archived.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-white">{item.title}</strong>
                  <p className="mt-0.5 mb-0 truncate text-xs text-[var(--sc-text-muted)]">
                    {item.sourceName} · {item.relativePath}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(savingId)}
                  onClick={() => void restore(`/api/catalog/${encodeURIComponent(item.id)}/restore`)}
                >
                  Restaurar
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-bold text-white">Alterações de título</h3>
          {history.titleChanges.length === 0 ? (
            <p className="m-0 text-xs text-[var(--sc-text-muted)]">
              Nenhuma alteração de título registrada.
            </p>
          ) : (
            history.titleChanges.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-white">
                    {entry.oldTitle} → {entry.newTitle}
                  </strong>
                  <p className="mt-0.5 mb-0 truncate text-[11px] text-[var(--sc-text-muted)]">
                    {entry.reason} · {entry.sourceName}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(savingId)}
                  onClick={() =>
                    void restore(`/api/catalog/title-history/${encodeURIComponent(entry.id)}/restore`)
                  }
                >
                  Reverter
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
