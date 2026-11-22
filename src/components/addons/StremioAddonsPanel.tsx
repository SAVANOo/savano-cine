import { Check, Globe, Plus, Power, Puzzle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { StremioAddonDescriptor } from '../../domain/sourceAdapter'
import type { PlayableMedia } from '../../domain/uiHelpers'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type StremioAddonsPanelProps = {
  onPlayStream?: (media: PlayableMedia) => void
}

/** Stremio-compatible Addon manager focused on installing, toggling, and removing addons. */
export function StremioAddonsPanel({ onPlayStream: _onPlayStream }: StremioAddonsPanelProps) {
  const [addons, setAddons] = useState<StremioAddonDescriptor[]>([])
  const [manifestUrl, setManifestUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [feedback, setFeedback] = useState('')

  const loadAddons = useCallback(async () => {
    try {
      const response = await fetch('/api/addons')
      if (!response.ok) return
      const data: StremioAddonDescriptor[] = await response.json()
      setAddons(data)
    } catch {
      // ignore network error when API offline
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch('/api/addons')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: StremioAddonDescriptor[]) => {
        if (active) setAddons(data)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  async function handleInstall(event: FormEvent) {
    event.preventDefault()
    const cleanUrl = manifestUrl.trim().replace(/^stremio:\/\//i, 'https://')
    if (!cleanUrl) return
    const alreadyInstalled = addons.find(
      (a) => a.manifestUrl.trim().toLowerCase() === cleanUrl.toLowerCase(),
    )
    if (alreadyInstalled) {
      setFeedback(`O addon "${alreadyInstalled.name}" já está instalado na sua lista!`)
      return
    }
    setInstalling(true)
    setFeedback('')
    try {
      const response = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: manifestUrl.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setFeedback(payload?.error || 'Não foi possível instalar o addon.')
        return
      }
      setManifestUrl('')
      setFeedback(`Addon "${payload.name}" instalado com sucesso. Explore os títulos em Acervo Online.`)
      await loadAddons()
    } catch {
      setFeedback('Falha de rede ao instalar o addon.')
    } finally {
      setInstalling(false)
    }
  }

  async function toggleAddon(addon: StremioAddonDescriptor) {
    try {
      const response = await fetch(`/api/addons/${encodeURIComponent(addon.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !addon.enabled }),
      })
      if (response.ok) await loadAddons()
    } catch {
      // ignore
    }
  }

  async function removeAddon(addonId: string) {
    try {
      const response = await fetch(`/api/addons/${encodeURIComponent(addonId)}`, { method: 'DELETE' })
      if (response.ok) await loadAddons()
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--sc-text-primary)]">
              <Puzzle className="h-5 w-5 text-[var(--sc-accent)]" />
              Adicionar &amp; Gerenciar Addons (Stremio)
            </h2>
            <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
              Cole a URL <code className="rounded bg-[var(--sc-bg-surface)] px-1.5 py-0.5 text-[var(--sc-text-primary)]">manifest.json</code> (ou link <code className="rounded bg-[var(--sc-bg-surface)] px-1.5 py-0.5 text-[var(--sc-text-primary)]">stremio://</code>) para conectar novos addons. Para navegar e assistir, use a aba <strong>Acervo Online</strong> na barra lateral.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Cinemeta (Catálogo)', url: 'https://v3-cinemeta.strem.io/manifest.json' },
              { label: 'TMDB PT-BR (Catálogo)', url: 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/manifest.json' },
              { label: 'Anime Kitsu (Animes)', url: 'https://anime-kitsu.strem.fun/manifest.json' },
              { label: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' },
              { label: 'Mico-Leão Dublado BR', url: 'https://27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club/manifest.json' },
              { label: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json' },
              { label: 'TorrentsDB', url: 'https://torrentsdb.com/manifest.json' },
            ].map((preset) => {
              const isInstalled = addons.some(
                (a) => a.manifestUrl.trim().toLowerCase() === preset.url.toLowerCase(),
              )
              return (
                <Button
                  key={preset.url}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (isInstalled) {
                      setFeedback(`O addon "${preset.label}" já está instalado!`)
                    } else {
                      setManifestUrl(preset.url)
                    }
                  }}
                >
                  {isInstalled ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Globe className="h-3.5 w-3.5" />}
                  <span>{preset.label}</span>
                  {isInstalled && (
                    <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      Já instalado
                    </span>
                  )}
                </Button>
              )
            })}
          </div>
        </div>

        <form onSubmit={handleInstall} className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            value={manifestUrl}
            onChange={(e) => setManifestUrl(e.target.value)}
            placeholder="https://exemplo.com/manifest.json ou stremio://..."
            className="min-w-[260px] flex-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3.5 py-2 text-sm text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] outline-none focus:border-[var(--sc-border-strong)]"
            required
          />
          <Button type="submit" variant="primary" disabled={installing}>
            <Plus className="h-4 w-4" />
            {installing ? 'Instalando...' : 'Instalar addon'}
          </Button>
        </form>

        {feedback ? (
          <p className="mt-3 text-sm font-medium text-[var(--sc-accent)]">{feedback}</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {addons.length === 0 ? (
          <div className="col-span-full rounded-[var(--sc-radius-lg)] border border-dashed border-[var(--sc-border-subtle)] p-8 text-center text-sm text-[var(--sc-text-secondary)]">
            Nenhum addon Stremio instalado ainda. Cole um <code className="rounded bg-[var(--sc-bg-surface)] px-1.5 py-0.5 text-[var(--sc-text-primary)]">manifest.json</code> acima para começar.
          </div>
        ) : (
          addons.map((addon) => (
            <div
              key={addon.id}
              className="flex flex-col justify-between rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4 transition"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {addon.logo ? (
                      <img src={addon.logo} alt={addon.name} className="h-10 w-10 rounded-md bg-black/40 object-contain p-1" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--sc-bg-elevated)] text-[var(--sc-text-primary)]">
                        <Puzzle className="h-5 w-5" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-[var(--sc-text-primary)]">{addon.name}</h3>
                      <p className="text-xs text-[var(--sc-text-muted)]">v{addon.version} · {addon.id}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={addon.enabled ? 'accent' : 'neutral'}>
                      {addon.enabled ? 'Ativo' : 'Pausado'}
                    </Badge>
                    {addon.health && addon.health.status !== 'unknown' && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          addon.health.status === 'healthy'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : addon.health.status === 'slow'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {addon.health.status === 'healthy'
                          ? `Saudável (${addon.health.avgMs}ms)`
                          : addon.health.status === 'slow'
                            ? `Lento (${addon.health.avgMs}ms)`
                            : 'Instável (pausa auto)'}
                      </span>
                    )}
                  </div>
                </div>
                {addon.description ? (
                  <p className="mt-2.5 line-clamp-2 text-xs text-[var(--sc-text-secondary)]">{addon.description}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {addon.resources.map((res) => (
                    <Badge key={res} tone="neutral">{res}</Badge>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sc-border-subtle)] pt-3">
                <span className="text-[11px] text-[var(--sc-text-muted)]">
                  {addon.catalogs.length > 0 ? `${addon.catalogs.length} catálogo(s)` : 'Addon de stream / legenda'}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="ghost" onClick={() => void toggleAddon(addon)} title="Ativar/Pausar">
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => void removeAddon(addon.id)} title="Remover addon">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
