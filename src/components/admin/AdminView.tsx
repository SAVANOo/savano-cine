import { ArrowLeft, AlertTriangle, Copy, Flag, History, Image, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReviewItem } from '../../domain/catalog'
import type { ArtworkCandidateGroup, CatalogHistory } from '../modals/CatalogModals'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type AdminTab = 'review' | 'artwork' | 'history' | 'logs'

type ErrorLogEntry = {
  timestamp?: string
  method?: string
  url?: string
  message?: string
}

type CatalogGaps = {
  totalMovies: number
  reviewCount: number
  missingPoster: Array<{ id: string; title: string; year?: number | null; relativePath: string }>
  missingOverview: Array<{ id: string; title: string; year?: number | null }>
  missingGenres: Array<{ id: string; title: string }>
  suspiciousTitles: Array<{ id: string; title: string; relativePath: string }>
  generatedPrompt: string
}

type AdminViewProps = {
  initialTab?: AdminTab
  reviewItems: ReviewItem[]
  reviewError: string
  artworkGroups: ArtworkCandidateGroup[]
  artworkError: string
  history: CatalogHistory
  onBack: () => void
  onRefreshAll: () => void
}

/** Dedicated Admin Console replacing cramped modals for catalog review, artwork, history, and error logs. */
export function AdminView({
  initialTab = 'review',
  reviewItems,
  reviewError,
  artworkGroups,
  artworkError,
  history,
  onBack,
  onRefreshAll,
}: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>(initialTab)
  const [busyId, setBusyId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [fetchingArtwork, setFetchingArtwork] = useState(false)
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])
  const [gaps, setGaps] = useState<CatalogGaps | null>(null)

  useEffect(() => {
    if (tab === 'artwork') {
      fetch('/api/catalog/gaps')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.totalMovies === 'number') setGaps(data)
        })
        .catch(() => undefined)
    }
    if (tab !== 'logs') return
    fetch('/api/logs/errors')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => setErrorLogs(Array.isArray(rows) ? rows : []))
      .catch(() => setErrorLogs([]))
  }, [tab])

  async function runReviewAction(id: string, action: 'approve-movie' | 'set-other' | 'ignore') {
    setBusyId(id)
    setFeedback('')
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao atualizar item.')
      }
      onRefreshAll()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao atualizar revisão.')
    } finally {
      setBusyId('')
    }
  }

  async function decideArtwork(candidateId: string, decision: 'approve' | 'reject') {
    setBusyId(candidateId)
    setFeedback('')
    try {
      const response = await fetch(
        `/api/artwork/candidates/${encodeURIComponent(candidateId)}/${decision}`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao processar candidato.')
      }
      onRefreshAll()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao atualizar arte.')
    } finally {
      setBusyId('')
    }
  }

  async function triggerMissingArtworkFetch() {
    setFetchingArtwork(true)
    setFeedback('')
    try {
      const res = await fetch('/api/artwork/fetch', { method: 'POST' })
      const body = await res.json().catch(() => null)
      setFeedback(body?.message || 'Busca de capas faltantes iniciada.')
      window.setTimeout(onRefreshAll, 4000)
    } catch {
      setFeedback('Não foi possível iniciar a busca de capas.')
    } finally {
      setFetchingArtwork(false)
    }
  }

  async function restoreHistory(url: string) {
    setBusyId(url)
    try {
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) throw new Error('Falha ao restaurar')
      onRefreshAll()
    } catch {
      setFeedback('Erro ao restaurar registro.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Voltar ao catálogo
          </Button>
          <div>
            <p className="m-0 text-[11px] font-bold uppercase tracking-widest text-[var(--sc-accent)]">
              ADMINISTRAÇÃO
            </p>
            <h1 className="m-0 text-2xl font-extrabold text-white">Painel do Catálogo</h1>
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={onRefreshAll}>
          <RefreshCw className="h-4 w-4" />
          Recarregar dados
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--sc-border-subtle)] pb-3">
        {[
          { key: 'review' as const, label: `Revisão (${reviewItems.length})`, icon: Flag },
          { key: 'artwork' as const, label: `Arte & Metadados (${artworkGroups.length})`, icon: Image },
          {
            key: 'history' as const,
            label: `Histórico (${history.archived.length + history.titleChanges.length})`,
            icon: History,
          },
          { key: 'logs' as const, label: 'Logs de Erro', icon: AlertTriangle },
        ].map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={tab === key ? 'light' : 'secondary'}
            size="sm"
            onClick={() => setTab(key)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-[var(--sc-radius-md)] border border-white/15 bg-[var(--sc-bg-surface)] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}

      {tab === 'review' && (
        <div className="flex flex-col gap-3">
          {reviewError && <p className="text-xs text-red-400">{reviewError}</p>}
          {reviewItems.length === 0 ? (
            <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-10 text-center text-sm text-[var(--sc-text-muted)]">
              Nenhum item pendente de revisão.
            </div>
          ) : (
            reviewItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm text-white">{item.title}</strong>
                    <Badge tone="neutral">{item.kind}</Badge>
                  </div>
                  <p className="mt-1 mb-0 truncate text-xs text-[var(--sc-text-secondary)]">
                    {item.sourceName} · {item.relativePath}
                  </p>
                  {item.reason && (
                    <p className="mt-1 mb-0 text-[11px] text-[var(--sc-text-muted)]">
                      Motivo: {item.reason}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busyId === item.id}
                    onClick={() => void runReviewAction(item.id, 'approve-movie')}
                  >
                    É filme
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === item.id}
                    onClick={() => void runReviewAction(item.id, 'set-other')}
                  >
                    Especial/Outro
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === item.id}
                    onClick={() => void runReviewAction(item.id, 'ignore')}
                  >
                    Ignorar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'artwork' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4">
            <div>
              <strong className="block text-sm text-white">Capas e sinopses faltantes</strong>
              <p className="mt-0.5 mb-0 text-xs text-[var(--sc-text-muted)]">
                Baixa pôsteres localmente para <code className="text-white/80">data/artwork</code>{' '}
                evitando chamadas repetidas às APIs externas.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {gaps?.generatedPrompt && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(gaps.generatedPrompt).catch(() => undefined)
                    setFeedback('Prompt de atualização copiado! Cole em uma nova sessão para ajustar novos filmes.')
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copiar prompt de correção
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={fetchingArtwork}
                onClick={() => void triggerMissingArtworkFetch()}
              >
                <Sparkles className="h-4 w-4" />
                {fetchingArtwork ? 'Buscando...' : 'Buscar capas faltantes'}
              </Button>
            </div>
          </div>

          {gaps && (
            <div className="flex flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-white">Diagnóstico do Catálogo ({gaps.totalMovies} filmes)</strong>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone={gaps.missingPoster.length === 0 ? 'neutral' : 'accent'}>
                    Sem capa: {gaps.missingPoster.length}
                  </Badge>
                  <Badge tone="neutral">Sem sinopse: {gaps.missingOverview.length}</Badge>
                  <Badge tone="neutral">Sem gênero: {gaps.missingGenres.length}</Badge>
                  <Badge tone={gaps.suspiciousTitles.length === 0 ? 'neutral' : 'accent'}>
                    Títulos suspeitos: {gaps.suspiciousTitles.length}
                  </Badge>
                </div>
              </div>
              {gaps.missingPoster.length > 0 && (
                <p className="m-0 text-xs text-[var(--sc-text-secondary)]">
                  Sem capa: {gaps.missingPoster.slice(0, 8).map((m) => m.title).join(', ')}
                  {gaps.missingPoster.length > 8 ? ` (+${gaps.missingPoster.length - 8})` : ''}
                </p>
              )}
              <pre className="m-0 max-h-36 overflow-auto rounded-[var(--sc-radius-md)] border border-white/10 bg-black/40 p-3 text-[11px] whitespace-pre-wrap text-white/80">
                {gaps.generatedPrompt}
              </pre>
            </div>
          )}

          {artworkError && <p className="text-xs text-red-400">{artworkError}</p>}

          {artworkGroups.length === 0 ? (
            <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-10 text-center text-sm text-[var(--sc-text-muted)]">
              Nenhuma correspondência ambígua aguardando confirmação.
            </div>
          ) : (
            artworkGroups.map((group) => (
              <div
                key={`${group.targetType}:${group.targetId}`}
                className="flex flex-col gap-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4"
              >
                <strong className="text-sm text-white">
                  {group.title} {group.year ? `(${group.year})` : ''}
                </strong>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex gap-3 rounded-[var(--sc-radius-md)] border border-white/10 bg-black/35 p-3"
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
                            onClick={() => void decideArtwork(candidate.id, 'approve')}
                          >
                            Confirmar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === candidate.id}
                            onClick={() => void decideArtwork(candidate.id, 'reject')}
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
      )}

      {tab === 'history' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-sm font-bold text-white">Itens arquivados</h2>
            {history.archived.length === 0 ? (
              <p className="text-xs text-[var(--sc-text-muted)]">Nenhum item arquivado.</p>
            ) : (
              history.archived.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-white">{item.title}</strong>
                    <p className="mt-0.5 mb-0 truncate text-[11px] text-[var(--sc-text-muted)]">
                      {item.sourceName} · {item.relativePath}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(busyId)}
                    onClick={() => void restoreHistory(`/api/catalog/${encodeURIComponent(item.id)}/restore`)}
                  >
                    Restaurar
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-sm font-bold text-white">Alterações de título</h2>
            {history.titleChanges.length === 0 ? (
              <p className="text-xs text-[var(--sc-text-muted)]">Nenhuma alteração registrada.</p>
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
                    disabled={Boolean(busyId)}
                    onClick={() =>
                      void restoreHistory(`/api/catalog/title-history/${encodeURIComponent(entry.id)}/restore`)
                    }
                  >
                    Reverter
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="flex flex-col gap-2">
          {errorLogs.length === 0 ? (
            <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-10 text-center text-sm text-[var(--sc-text-muted)]">
              Nenhum erro registrado em <code className="text-white/80">data/logs/api-errors.log</code>.
            </div>
          ) : (
            errorLogs.map((entry, idx) => (
              <div
                key={`${entry.timestamp ?? idx}-${idx}`}
                className="rounded-[var(--sc-radius-md)] border border-red-500/25 bg-red-950/20 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2 text-red-200">
                  <strong>
                    {entry.method} {entry.url}
                  </strong>
                  <span className="text-[11px] text-red-300/70">{entry.timestamp}</span>
                </div>
                <p className="mt-1 mb-0 text-red-100/90">{entry.message}</p>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
