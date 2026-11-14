import {
  Check,
  ChevronDown,
  Film,
  Flag,
  FolderPlus,
  History,
  Home,
  Image,
  Pencil,
  Plus,
  RefreshCw,
  Tv,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { MediaSource, Profile } from '../../domain/catalog'
import { getAvatarStyle } from '../../domain/uiHelpers'

type SidebarProps = {
  sources: MediaSource[]
  sourcesError: string
  activeProfile: Profile
  profiles: Profile[]
  activeKind: 'Todos' | 'Filme' | 'Série'
  onSelectKind: (kind: 'Todos' | 'Filme' | 'Série') => void
  onSelectProfile: (profileId: string) => void
  onOpenProfileEditor: (profile?: Profile) => void
  onGoHome: () => void
  onOpenReview: () => void
  onOpenArtworkReview: () => void
  onOpenHistory: () => void
  onRefreshCatalog: () => void
  onSourceAdded: () => void
  refreshing: boolean
  refreshStatus: string
  reviewCount: number
  artworkCount: number
  historyCount: number
}

/** Persistent navigation rail with responsive brand collapse, profiles, and catalog tools. */
export function Sidebar({
  sources,
  sourcesError,
  activeProfile,
  profiles,
  activeKind,
  onSelectKind,
  onSelectProfile,
  onOpenProfileEditor,
  onGoHome,
  onOpenReview,
  onOpenArtworkReview,
  onOpenHistory,
  onRefreshCatalog,
  onSourceAdded,
  refreshing,
  refreshStatus,
  reviewCount,
  artworkCount,
  historyCount,
}: SidebarProps) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [addingSource, setAddingSource] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceStatus, setSourceStatus] = useState('')
  const [savingSource, setSavingSource] = useState(false)

  const activeStyle = getAvatarStyle(activeProfile.avatarKey)
  const onlineCount = sources.filter((source) => source.status === 'online').length

  async function submitSource(event: FormEvent) {
    event.preventDefault()
    if (!sourcePath.trim()) return
    setSavingSource(true)
    setSourceStatus('')
    try {
      const response = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sourceName.trim() || undefined, path: sourcePath.trim() }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setSourceStatus(body?.error || 'Não foi possível cadastrar a fonte.')
        return
      }
      setSourceName('')
      setSourcePath('')
      setAddingSource(false)
      setSourceStatus('Fonte cadastrada.')
      onSourceAdded()
    } catch {
      setSourceStatus('API indisponível para cadastrar fonte.')
    } finally {
      setSavingSource(false)
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-b border-[var(--sc-border-subtle)] bg-[#0b0c12] p-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5">
      {/* Clickable Brand */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onGoHome}
          title="Voltar para o início"
          className="flex items-center gap-2.5 border-0 bg-transparent p-0 text-left cursor-pointer"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--sc-radius-md)] bg-gradient-to-br from-[#e50914] to-[#9b1c31] text-base font-black text-white shadow-lg shadow-red-950/50">
            S
          </span>
          <span className="hidden text-base font-bold tracking-tight text-white md:inline">
            Savano Cine
          </span>
        </button>
      </div>

      {/* Active Profile Switcher */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setProfileMenuOpen((value) => !value)}
          className="flex w-full items-center gap-3 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-2.5 text-left transition hover:border-white/25 cursor-pointer"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--sc-radius-sm)] text-sm font-bold text-white"
            style={{ background: activeStyle.background }}
          >
            {activeStyle.badge}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-semibold text-white">
              {activeProfile.name}
            </strong>
            <span className="block text-[11px] text-[var(--sc-text-muted)]">Trocar perfil</span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-[var(--sc-text-muted)] transition-transform ${
              profileMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {profileMenuOpen && (
          <div className="flex flex-col gap-1 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-2">
            <p className="m-0 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
              Quem está assistindo?
            </p>
            {profiles.map((profile) => {
              const style = getAvatarStyle(profile.avatarKey)
              const selected = profile.id === activeProfile.id
              return (
                <div key={profile.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProfile(profile.id)
                      setProfileMenuOpen(false)
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-[var(--sc-radius-sm)] px-2 py-1.5 text-left text-xs transition cursor-pointer ${
                      selected ? 'bg-white/12 text-white' : 'text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                      style={{ background: style.background }}
                    >
                      {style.badge}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--sc-accent)]" />}
                  </button>
                  <button
                    type="button"
                    title={`Editar ${profile.name}`}
                    onClick={() => {
                      onOpenProfileEditor(profile)
                      setProfileMenuOpen(false)
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sc-radius-sm)] text-[var(--sc-text-muted)] hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => {
                onOpenProfileEditor(undefined)
                setProfileMenuOpen(false)
              }}
              className="mt-1 flex items-center gap-2 rounded-[var(--sc-radius-sm)] border border-dashed border-white/15 px-2 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:border-white/30 hover:text-white cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Criar perfil
            </button>
          </div>
        )}
      </div>

      {/* Primary Streaming Nav */}
      <nav className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
        {[
          { key: 'Todos' as const, label: 'Início', icon: Home },
          { key: 'Filme' as const, label: 'Filmes', icon: Film },
          { key: 'Série' as const, label: 'Séries', icon: Tv },
        ].map(({ key, label, icon: Icon }) => {
          const active = activeKind === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                onSelectKind(key)
                onGoHome()
              }}
              className={`flex shrink-0 items-center gap-2.5 rounded-[var(--sc-radius-md)] px-3 py-2 text-sm font-medium transition cursor-pointer ${
                active
                  ? 'bg-white/12 text-white'
                  : 'text-[var(--sc-text-secondary)] hover:bg-white/6 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      {/* Sources & Catalog Management */}
      <div className="mt-auto hidden flex-col gap-3 border-t border-[var(--sc-border-subtle)] pt-4 lg:flex">
        <div className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white">
              {sourcesError ? 'API indisponível' : `${sources.length} fonte(s)`}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${
                sourcesError ? 'bg-red-500' : onlineCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
          </div>
          <p className="mt-1 mb-0 text-[11px] text-[var(--sc-text-muted)]">
            {sourcesError || `${onlineCount} conectada(s)`}
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-[var(--sc-text-secondary)]">{source.name}</span>
                <span className="shrink-0 text-[var(--sc-text-muted)]">{source.itemCount}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAddingSource((value) => !value)}
          className="flex items-center gap-2 rounded-[var(--sc-radius-sm)] px-2.5 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Adicionar fonte
        </button>

        {addingSource && (
          <form className="flex flex-col gap-2 rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-2.5" onSubmit={submitSource}>
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="Nome (opcional)"
              className="h-8 rounded border border-white/10 bg-black/40 px-2 text-xs text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
            <input
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="Pasta ou URL"
              required
              className="h-8 rounded border border-white/10 bg-black/40 px-2 text-xs text-white focus:border-[var(--sc-accent)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={savingSource}
              className="h-8 rounded bg-[var(--sc-accent)] text-xs font-semibold text-white hover:bg-[var(--sc-accent-hover)] cursor-pointer"
            >
              {savingSource ? 'Salvando...' : 'Salvar fonte'}
            </button>
          </form>
        )}
        {sourceStatus && <p className="m-0 px-2 text-[11px] text-[var(--sc-text-secondary)]">{sourceStatus}</p>}

        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefreshCatalog}
            className="flex items-center gap-2 rounded-[var(--sc-radius-sm)] px-2.5 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Atualizando...' : 'Atualizar catálogo'}
          </button>
          {refreshStatus && <p className="m-0 px-2.5 text-[11px] text-[var(--sc-text-muted)]">{refreshStatus}</p>}

          <button
            type="button"
            onClick={onOpenReview}
            className="flex items-center justify-between rounded-[var(--sc-radius-sm)] px-2.5 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Flag className="h-3.5 w-3.5" />
              Revisão
            </span>
            <span>({reviewCount})</span>
          </button>

          <button
            type="button"
            onClick={onOpenArtworkReview}
            className="flex items-center justify-between rounded-[var(--sc-radius-sm)] px-2.5 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Image className="h-3.5 w-3.5" />
              Arte
            </span>
            {artworkCount > 0 && <span>({artworkCount})</span>}
          </button>

          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center justify-between rounded-[var(--sc-radius-sm)] px-2.5 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <History className="h-3.5 w-3.5" />
              Histórico
            </span>
            <span>({historyCount})</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
