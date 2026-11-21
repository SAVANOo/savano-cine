import { ArrowLeft, AlertTriangle, Copy, Download, Flag, Globe, History, Image, Puzzle, QrCode, RefreshCw, Server, Sparkles } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { ReviewItem } from '../../domain/catalog'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { StremioAddonsPanel } from '../addons/StremioAddonsPanel'
import { DownloadsPanel } from '../addons/DownloadsPanel'
import type { ArtworkCandidateGroup, CatalogHistory } from '../modals/CatalogModals'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type AdminTab = 'review' | 'artwork' | 'history' | 'logs' | 'addons' | 'server'

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
  onPlayMedia?: (media: PlayableMedia) => void
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
  onPlayMedia,
}: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>(initialTab)
  const [busyId, setBusyId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [fetchingArtwork, setFetchingArtwork] = useState(false)
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([])
  const [gaps, setGaps] = useState<CatalogGaps | null>(null)
  const [hiddenReviewIds, setHiddenReviewIds] = useState<Set<string>>(() => new Set())
  const [hiddenCandidateIds, setHiddenCandidateIds] = useState<Set<string>>(() => new Set())
  const [networkUrls, setNetworkUrls] = useState<string[]>([])
  const [tunnelUrl, setTunnelUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showQr, setShowQr] = useState(false)
  const [downloads, setDownloads] = useState<Array<{ id: string; title: string; status: string; progress: number; message: string }>>([])
  const [connections, setConnections] = useState<
    Array<{
      ip: string
      origin?: string
      device?: string
      userAgent: string
      profileId?: string | null
      lastPath: string
      lastActivity?: string | null
      requests?: number
      lastSeen: string
    }>
  >([])
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [pinRequired, setPinRequired] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/network-info')
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        const urls = Array.isArray(data?.urls) ? data.urls : []
        const pub = typeof data?.tunnelUrl === 'string' ? data.tunnelUrl : ''
        setNetworkUrls(urls)
        setTunnelUrl(pub)
        const target = pub || urls[0]
        if (target) {
          const qr = await QRCode.toDataURL(target, { width: 140, margin: 1 }).catch(() => '')
          setQrDataUrl(qr)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    const poll = () => {
      fetch('/api/addons/downloads')
        .then((res) => (res.ok ? res.json() : []))
        .then((rows) => {
          if (active && Array.isArray(rows)) setDownloads(rows)
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 4000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const visibleReviewItems = reviewItems.filter((item) => !hiddenReviewIds.has(item.id))
  const visibleArtworkGroups = artworkGroups
    .map((group) => ({
      ...group,
      candidates: group.candidates.filter((c) => !hiddenCandidateIds.has(c.id)),
    }))
    .filter((group) => group.candidates.length > 0)

  useEffect(() => {
    if (tab === 'artwork') {
      fetch('/api/catalog/gaps')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.totalMovies === 'number') setGaps(data)
        })
        .catch(() => undefined)
    }
    if (tab === 'server') {
      fetch('/api/admin/connections')
        .then((res) => (res.ok ? res.json() : []))
        .then((rows) => setConnections(Array.isArray(rows) ? rows : []))
        .catch(() => setConnections([]))
      fetch('/api/health')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.pinRequired === 'boolean') setPinRequired(data.pinRequired)
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
      setHiddenReviewIds((prev) => new Set(prev).add(id))
      setFeedback('Item atualizado no catálogo.')
      onRefreshAll()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao atualizar revisão.')
    } finally {
      setBusyId('')
    }
  }

  async function runBulkReviewAction(folderKey: string, ids: string[], action: 'approve-movie' | 'set-other' | 'ignore') {
    setBusyId(`bulk:${folderKey}`)
    setFeedback('')
    try {
      const response = await fetch('/api/review/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Falha ao atualizar pasta.')
      }
      setHiddenReviewIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      setFeedback(`${ids.length} item(ns) de "${folderKey}" atualizados.`)
      onRefreshAll()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro na revisão em lote.')
    } finally {
      setBusyId('')
    }
  }

  async function decideArtwork(candidateId: string, decision: 'approve' | 'reject', siblingIds: string[] = []) {
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
      setHiddenCandidateIds((prev) => {
        const next = new Set(prev)
        next.add(candidateId)
        if (decision === 'approve') {
          for (const siblingId of siblingIds) next.add(siblingId)
        }
        return next
      })
      setFeedback(
        decision === 'approve'
          ? 'Arte confirmada e aplicada ao catálogo! O título saiu das pendências.'
          : 'Sugestão descartada.',
      )
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
            <h1 className="m-0 text-2xl font-extrabold text-[var(--sc-text-primary)]">Painel do Catálogo</h1>
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
          { key: 'review' as const, label: `Revisão (${visibleReviewItems.length})`, icon: Flag },
          { key: 'artwork' as const, label: `Arte & Metadados (${visibleArtworkGroups.length})`, icon: Image },
          {
            key: 'history' as const,
            label: `Histórico (${history.archived.length + history.titleChanges.length})`,
            icon: History,
          },
          { key: 'logs' as const, label: 'Logs de Erro', icon: AlertTriangle },
          { key: 'addons' as const, label: 'Addons (Stremio)', icon: Puzzle },
          { key: 'server' as const, label: 'Servidor & Conexões', icon: Server },
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
        <div className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-4 py-3 text-xs text-[var(--sc-text-primary)]">
          {feedback}
        </div>
      )}

      {(networkUrls.length > 0 || tunnelUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-4 py-2.5 text-xs">
          <div className="flex flex-col gap-0.5">
            {networkUrls.length > 0 && (
              <span className="text-[var(--sc-text-secondary)]">
                Wi-Fi local (celular / APK):{' '}
                <strong className="text-[var(--sc-text-primary)]">{networkUrls[0]}</strong>
              </span>
            )}
            {tunnelUrl && (
              <span className="text-[var(--sc-text-secondary)]">
                Internet pública (4G/externo):{' '}
                <strong className="text-[var(--sc-accent)]">{tunnelUrl}</strong>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {qrDataUrl && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowQr((v) => !v)}
              >
                <QrCode className="h-3.5 w-3.5" />
                {showQr ? 'Ocultar QR' : 'QR Code'}
              </Button>
            )}
            <a
              href="/api/android/apk"
              download="SavanoCine.apk"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs font-medium text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
            >
              Baixar APK Android
            </a>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const target = tunnelUrl || networkUrls[0]
                void navigator.clipboard?.writeText(target)
                setFeedback(`Endereço ${target} copiado!`)
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar link
            </Button>
          </div>
          {showQr && qrDataUrl && (
            <div className="mt-2 flex w-full flex-wrap items-center gap-4 border-t border-[var(--sc-border-subtle)] pt-3">
              <a
                href={tunnelUrl || networkUrls[0]}
                target="_blank"
                rel="noreferrer"
                title="Abrir servidor Savano Cine"
                className="shrink-0 rounded-lg transition hover:ring-2 hover:ring-[var(--sc-accent)]"
              >
                <img src={qrDataUrl} alt="QR Code de acesso" className="h-28 w-28 rounded-lg bg-white p-1" />
              </a>
              <div className="space-y-1.5 text-xs text-[var(--sc-text-secondary)]">
                <p className="m-0 font-semibold text-[var(--sc-text-primary)]">Escaneie ou clique no QR Code</p>
                <p className="mt-0 mb-0">
                  Abre o Savano Cine no celular ou conecta diretamente no servidor.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={tunnelUrl || networkUrls[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                  >
                    Abrir Web / Conectar
                  </a>
                  <a
                    href={`intent://connect?server=${encodeURIComponent(tunnelUrl || networkUrls[0])}#Intent;scheme=savanocine;package=com.savanocine.app;S.browser_fallback_url=${encodeURIComponent(tunnelUrl || networkUrls[0])};end`}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-accent)]/40 bg-[var(--sc-accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/20"
                  >
                    Abrir no App / Baixar APK
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {downloads.length > 0 && (
        <div className="space-y-2 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] px-4 py-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-[var(--sc-text-primary)]">
              <Download className="h-3.5 w-3.5 text-[var(--sc-accent)]" />
              Downloads Offline ({downloads.length})
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={onRefreshAll}>
              Atualizar Acervo Local
            </Button>
          </div>
          {downloads.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-[11px] text-[var(--sc-text-secondary)]">
              <span className="truncate font-medium text-[var(--sc-text-primary)]">{d.title}</span>
              <span>{d.message}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'addons' && (
        <StremioAddonsPanel onPlayStream={(media) => onPlayMedia?.(media)} />
      )}

      {tab === 'server' && (
        <div className="space-y-4">
          <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 flex items-center gap-2 text-lg font-bold text-[var(--sc-text-primary)]">
                  <Globe className="h-5 w-5 text-[var(--sc-accent)]" />
                  Controle do Servidor &amp; Túnel Público
                </h2>
                <p className="mt-1 mb-0 text-xs text-[var(--sc-text-secondary)]">
                  Gerencie o acesso externo (4G/internet), links de download do APK e conexões recentes.
                  {pinRequired !== null && (
                    <span className="ml-2 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--sc-text-primary)]">
                      PIN Global: {pinRequired ? 'Ativo (CINE_ACCESS_PIN)' : 'Desativado'}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--sc-text-secondary)]">
                  {tunnelBusy
                    ? 'Atualizando túnel...'
                    : tunnelUrl
                      ? 'Túnel Público Ativo'
                      : 'Túnel Público Desligado'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(tunnelUrl)}
                  aria-label="Alternar Túnel Público"
                  disabled={tunnelBusy}
                  onClick={async () => {
                    setTunnelBusy(true)
                    try {
                      if (tunnelUrl) {
                        await fetch('/api/admin/tunnel/stop', { method: 'POST' })
                        setTunnelUrl('')
                        setFeedback('Túnel público encerrado.')
                      } else {
                        const res = await fetch('/api/admin/tunnel/start', { method: 'POST' })
                        const data = await res.json().catch(() => null)
                        if (data?.tunnelUrl) {
                          setTunnelUrl(data.tunnelUrl)
                          const qr = await QRCode.toDataURL(data.tunnelUrl, { width: 140, margin: 1 }).catch(() => '')
                          if (qr) setQrDataUrl(qr)
                          setFeedback(`Túnel público ativo: ${data.tunnelUrl}`)
                        } else if (data?.error) {
                          setFeedback(data.error)
                        }
                      }
                    } finally {
                      setTunnelBusy(false)
                    }
                  }}
                  className={`relative inline-flex h-7 w-13 shrink-0 items-center rounded-full border border-white/15 transition-colors cursor-pointer disabled:opacity-50 ${
                    tunnelUrl ? 'bg-emerald-500' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      tunnelUrl ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              {[
                { label: 'PC Local', value: 'http://127.0.0.1:4174', accent: false },
                { label: 'Wi-Fi Local', value: networkUrls[0] || '', accent: false },
                { label: 'Internet Pública', value: tunnelUrl || '', accent: true },
              ].map((endpoint) => (
                <div
                  key={endpoint.label}
                  className="flex items-center justify-between gap-2 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 font-semibold text-[var(--sc-text-muted)]">{endpoint.label}</p>
                    <p
                      className={`mt-1 mb-0 truncate font-bold ${
                        endpoint.accent ? 'text-[var(--sc-accent)]' : 'text-[var(--sc-text-primary)]'
                      }`}
                    >
                      {endpoint.value || (endpoint.label === 'Internet Pública' ? 'Desligado' : 'Indisponível')}
                    </p>
                  </div>
                  {endpoint.value ? (
                    <button
                      type="button"
                      title={`Copiar ${endpoint.label}`}
                      aria-label={`Copiar ${endpoint.label}`}
                      onClick={() => {
                        void navigator.clipboard?.writeText(endpoint.value)
                        setFeedback(`Link "${endpoint.label}" copiado: ${endpoint.value}`)
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] text-[var(--sc-text-secondary)] hover:border-[var(--sc-accent)] hover:text-[var(--sc-accent)] cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <DownloadsPanel alwaysVisible onRefreshCatalog={onRefreshAll} />

          <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-bold text-[var(--sc-text-primary)]">
                Conexões Recentes ({connections.length})
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/api/admin/export-history?format=csv"
                  className="inline-flex h-8 items-center rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)]"
                >
                  Exportar CSV (Letterboxd/Trakt)
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const res = await fetch('/api/admin/backup', { method: 'POST' })
                    const data = await res.json().catch(() => null)
                    if (res.ok && data?.filename) {
                      setFeedback(`Backup salvo: ${data.filename} (${data.totalBackups} mantidos)`)
                    } else {
                      setFeedback(data?.error || 'Falha ao gerar backup.')
                    }
                  }}
                >
                  Backup do Banco
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    fetch('/api/admin/connections')
                      .then((res) => (res.ok ? res.json() : []))
                      .then((rows) => setConnections(Array.isArray(rows) ? rows : []))
                      .catch(() => undefined)
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Atualizar
                </Button>
              </div>
            </div>
            {connections.length === 0 ? (
              <p className="text-xs text-[var(--sc-text-secondary)]">Nenhuma conexão registrada ainda.</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {connections.map((conn, idx) => (
                  <div
                    key={`${conn.ip}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[var(--sc-text-primary)]">{conn.ip}</span>
                        {conn.origin && (
                          <span className="rounded-full bg-[var(--sc-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sc-accent)]">
                            {conn.origin}
                          </span>
                        )}
                        {conn.device && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[var(--sc-text-primary)]">
                            {conn.device}
                          </span>
                        )}
                        {conn.profileId && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Perfil: {conn.profileId.replace(/^profile-/, '')}
                          </span>
                        )}
                      </div>
                      <p className="m-0 truncate text-[11px] text-[var(--sc-text-secondary)]">
                        Rota: {conn.lastPath}
                        {conn.lastActivity ? ` · ${conn.lastActivity}` : ''}
                        {conn.requests ? ` · ${conn.requests} reqs` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] text-[var(--sc-text-muted)]">
                      {new Date(conn.lastSeen).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'review' && (
        <div className="flex flex-col gap-3">
          {reviewError && <p className="text-xs text-red-400">{reviewError}</p>}
          {visibleReviewItems.length === 0 ? (
            <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-10 text-center text-sm text-[var(--sc-text-muted)]">
              Nenhum item pendente de revisão.
            </div>
          ) : (
            (() => {
              const folderGroups = new Map<string, ReviewItem[]>()
              for (const item of visibleReviewItems) {
                const topFolder = item.relativePath.split(/[\\/]/).filter(Boolean)[0] || item.title
                const list = folderGroups.get(topFolder) ?? []
                list.push(item)
                folderGroups.set(topFolder, list)
              }
              return Array.from(folderGroups.entries()).map(([folder, items]) => (
                <div key={folder} className="flex flex-col gap-2">
                  {items.length > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--sc-radius-md)] border border-white/15 bg-white/[0.04] px-4 py-2.5">
                      <span className="text-xs font-semibold text-white">
                        Pasta "{folder}" ({items.length} arquivos)
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === `bulk:${folder}`}
                          onClick={() => void runBulkReviewAction(folder, items.map((i) => i.id), 'approve-movie')}
                        >
                          Todos são Filmes
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === `bulk:${folder}`}
                          onClick={() => void runBulkReviewAction(folder, items.map((i) => i.id), 'set-other')}
                        >
                          Todos Especial/Outro
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === `bulk:${folder}`}
                          onClick={() => void runBulkReviewAction(folder, items.map((i) => i.id), 'ignore')}
                        >
                          Ignorar todos
                        </Button>
                      </div>
                    </div>
                  )}
                  {items.map((item) => (
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
                  ))}
                </div>
              ))
            })()
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
                variant="secondary"
                size="sm"
                disabled={fetchingArtwork}
                onClick={async () => {
                  setFetchingArtwork(true)
                  try {
                    const res = await fetch('/api/admin/artwork/sync-ptbr', { method: 'POST' })
                    const data = await res.json().catch(() => null)
                    if (res.ok) {
                      setFeedback(`Re-sincronização concluída: ${data?.updated ?? 0} capa(s) atualizada(s) de ${data?.checked ?? 0} verificada(s).`)
                      onRefreshAll()
                    } else {
                      setFeedback(data?.error || 'Falha ao re-sincronizar capas.')
                    }
                  } finally {
                    setFetchingArtwork(false)
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Re-sincronizar Capas
              </Button>
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

          <div className="rounded-[var(--sc-radius-lg)] border border-sky-500/25 bg-sky-500/10 p-4 text-xs text-sky-100">
            <strong className="block text-sm text-white">Como avaliar as sugestões abaixo</strong>
            <p className="mt-1 mb-0 leading-relaxed text-sky-100/85">
              Quando o sistema encontra mais de um filme ou série com nome parecido, ele lista as opções aqui para você confirmar qual é o arquivo real do seu HD.
              Clique em <strong>Confirmar arte</strong> na opção correta (isso baixa a capa, preenche a sinopse e remove o título das pendências) ou em{' '}
              <strong>Descartar</strong> se a sugestão for de outro filme.
            </p>
          </div>

          {artworkError && <p className="text-xs text-red-400">{artworkError}</p>}

          {visibleArtworkGroups.length === 0 ? (
            <div className="rounded-[var(--sc-radius-lg)] border border-dashed border-white/15 p-10 text-center text-sm text-[var(--sc-text-muted)]">
              Nenhuma correspondência ambígua aguardando confirmação.
            </div>
          ) : (
            visibleArtworkGroups.map((group) => {
              const siblingIds = group.candidates.map((c) => c.id)
              return (
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
                            onClick={() => void decideArtwork(candidate.id, 'approve', siblingIds)}
                          >
                            Confirmar arte
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
              )
            })
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
