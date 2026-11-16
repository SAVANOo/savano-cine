import { CheckCircle2, Download, FolderDown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'

export type AddonDownloadRecord = {
  id: string
  title: string
  targetDir: string
  mode: 'torrent' | 'http'
  status: string
  progress: number
  message: string
}

type DownloadsPanelProps = {
  alwaysVisible?: boolean
  onRefreshCatalog?: () => void
}

/** Displays active and recent local downloads started from addons or the video player. */
export function DownloadsPanel({ alwaysVisible = false, onRefreshCatalog }: DownloadsPanelProps) {
  const [downloads, setDownloads] = useState<AddonDownloadRecord[]>([])

  const loadDownloads = useCallback(async () => {
    try {
      const res = await fetch('/api/addons/downloads')
      if (!res.ok) return
      const rows = await res.json()
      if (Array.isArray(rows)) setDownloads(rows)
    } catch {
      // ignore transient network errors
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/addons/downloads')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (active && Array.isArray(rows)) setDownloads(rows)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const hasActive = downloads.some((d) => d.status === 'starting' || d.status === 'downloading')

  useEffect(() => {
    if (!hasActive && !alwaysVisible) return
    const timer = window.setInterval(() => {
      void loadDownloads()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [alwaysVisible, hasActive, loadDownloads])

  if (downloads.length === 0 && !alwaysVisible) {
    return null
  }

  return (
    <section className="space-y-3 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderDown className="h-4 w-4 text-[var(--sc-accent)]" />
          <h2 className="m-0 text-sm font-bold text-[var(--sc-text-primary)]">
            Downloads para o Acervo Local ({downloads.length})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {downloads.some((d) => d.status === 'completed' || d.status === 'error' || d.status === 'qbittorrent') ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                await fetch('/api/addons/downloads', { method: 'DELETE' }).catch(() => undefined)
                void loadDownloads()
              }}
            >
              Limpar concluídos
            </Button>
          ) : null}
          {onRefreshCatalog && downloads.some((d) => d.status === 'completed') ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRefreshCatalog}>
              <RefreshCw className="h-3.5 w-3.5" />
              Escanear concluídos
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void loadDownloads()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      {downloads.length === 0 ? (
        <p className="m-0 text-xs text-[var(--sc-text-secondary)]">
          Nenhum download em andamento nesta sessão. Use o botão Offline/Baixar em qualquer filme, série ou player online.
        </p>
      ) : (
        <div className="space-y-2">
          {downloads.map((item) => {
            const pct = Math.max(0, Math.min(100, Math.round(Number(item.progress) || 0)))
            const done = item.status === 'completed' || item.status === 'qbittorrent'
            return (
              <div
                key={item.id}
                className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--sc-text-primary)]">
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <Download className="h-3.5 w-3.5 shrink-0 text-[var(--sc-accent)]" />
                      )}
                      {item.title}
                    </p>
                    <p className="mt-0.5 mb-0 truncate text-[11px] text-[var(--sc-text-muted)]">
                      {item.mode.toUpperCase()} · {item.message} · {item.targetDir}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-[var(--sc-text-primary)]">
                    {item.status === 'qbittorrent' ? 'qBittorrent' : `${pct}%`}
                  </span>
                </div>
                {item.status !== 'qbittorrent' && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full transition-all ${done ? 'bg-emerald-500' : 'bg-[var(--sc-accent)]'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
