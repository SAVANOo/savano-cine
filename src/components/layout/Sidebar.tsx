import {
  Check,
  ChevronDown,
  Film,
  FolderPlus,
  Gamepad2,
  HardDrive,
  Home,
  Lock,
  Palette,
  Pencil,
  PlayCircle,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
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
  activeKind: 'Todos' | 'Local' | 'Filme' | 'Série' | 'Continuar'
  onSelectKind: (kind: 'Todos' | 'Local' | 'Filme' | 'Série' | 'Continuar') => void
  onSelectProfile: (profileId: string) => void
  onOpenProfileEditor: (profile?: Profile) => void
  onGoHome: () => void
  onOpenAdmin: () => void
  onOpenAddons: () => void
  adminActive: boolean
  addonsActive?: boolean
  onRefreshCatalog: () => void
  onSourceAdded: () => void
  refreshing: boolean
  refreshStatus: string
  adminBadgeCount: number
  gamepadConnected?: boolean
  theme: 'dark' | 'light' | 'momolada'
  onChangeTheme: (theme: 'dark' | 'light' | 'momolada') => void
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
  onOpenAdmin,
  onOpenAddons,
  adminActive,
  addonsActive,
  onRefreshCatalog,
  onSourceAdded,
  refreshing,
  refreshStatus,
  adminBadgeCount,
  gamepadConnected,
  theme,
  onChangeTheme,
}: SidebarProps) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [addingSource, setAddingSource] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceStatus, setSourceStatus] = useState('')
  const [savingSource, setSavingSource] = useState(false)
  const [brokenAvatarUrls, setBrokenAvatarUrls] = useState<Set<string>>(() => new Set())

  const markAvatarBroken = (url: string) => {
    setBrokenAvatarUrls((prev) => {
      if (prev.has(url)) return prev
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }

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
    <aside className="flex w-full shrink-0 flex-col gap-5 border-b border-[var(--sc-border-subtle)] bg-[var(--sc-bg-elevated)] p-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-5">
      {/* Clickable Brand */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onGoHome}
          title="Voltar para o início"
          className="flex items-center gap-2.5 border-0 bg-transparent p-0 text-left cursor-pointer"
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--sc-radius-md)] bg-gradient-to-br from-[#e50914] to-[#9b1c31] text-base font-black text-white shadow-lg shadow-red-950/30">
            S
            {theme === 'momolada' && (
              <svg
                viewBox="0 0 24 14"
                aria-hidden="true"
                className="absolute -top-2 -right-2 h-4 w-5 drop-shadow"
              >
                <path d="M12 7 L3 2 Q1 7 3 12 Z" fill="#ff4fa3" stroke="#fff" strokeWidth="1" />
                <path d="M12 7 L21 2 Q23 7 21 12 Z" fill="#ff4fa3" stroke="#fff" strokeWidth="1" />
                <circle cx="12" cy="7" r="2.6" fill="#ff85c0" stroke="#fff" strokeWidth="1" />
              </svg>
            )}
          </span>
          <span className="hidden items-center gap-1.5 text-base font-bold tracking-tight text-white md:inline-flex">
            Savano Cine
            {theme === 'momolada' && <Sparkles className="h-3.5 w-3.5 text-[var(--sc-accent)]" />}
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
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--sc-radius-sm)] text-sm font-bold text-white"
            style={{ background: activeStyle.background }}
          >
            {activeStyle.imageUrl && !brokenAvatarUrls.has(activeStyle.imageUrl) ? (
              <img
                src={activeStyle.imageUrl}
                alt={activeProfile.name}
                className="h-full w-full object-cover"
                onError={() => markAvatarBroken(activeStyle.imageUrl!)}
              />
            ) : (
              activeStyle.badge
            )}
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
                      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded text-[11px] font-bold text-white"
                      style={{ background: style.background }}
                    >
                      {style.imageUrl && !brokenAvatarUrls.has(style.imageUrl) ? (
                        <img
                          src={style.imageUrl}
                          alt={profile.name}
                          className="h-full w-full object-cover"
                          onError={() => markAvatarBroken(style.imageUrl!)}
                        />
                      ) : (
                        style.badge
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate">
                        <span className="truncate">{profile.name}</span>
                        {profile.hasPassword && <Lock className="h-3 w-3 shrink-0 text-amber-300" />}
                      </span>
                      <span className="block text-[10px] text-[var(--sc-text-muted)]">
                        {profile.watchedCount ?? 0} assistido(s)
                      </span>
                    </span>
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
          { key: 'Continuar' as const, label: 'Continuar assistindo', icon: PlayCircle },
          { key: 'Local' as const, label: 'Acervo Local', icon: HardDrive },
          { key: 'Filme' as const, label: 'Filmes', icon: Film },
          { key: 'Série' as const, label: 'Séries', icon: Tv },
        ].map(({ key, label, icon: Icon }) => {
          const active = !adminActive && activeKind === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                onSelectKind(key)
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

        <button
          type="button"
          onClick={onOpenAddons}
          className={`flex shrink-0 items-center gap-2.5 rounded-[var(--sc-radius-md)] px-3 py-2 text-sm font-medium transition cursor-pointer ${
            addonsActive
              ? 'bg-white/12 text-white'
              : 'text-[var(--sc-text-secondary)] hover:bg-white/6 hover:text-white'
          }`}
        >
          <Puzzle className="h-4 w-4 shrink-0" />
          <span>Addons</span>
        </button>

        <button
          type="button"
          onClick={onOpenAdmin}
          className={`flex shrink-0 items-center justify-between gap-2 rounded-[var(--sc-radius-md)] px-3 py-2 text-sm font-medium transition cursor-pointer ${
            adminActive && !addonsActive
              ? 'bg-white/12 text-white'
              : 'text-[var(--sc-text-secondary)] hover:bg-white/6 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Admin</span>
          </span>
          {adminBadgeCount > 0 && (
            <span className="rounded-full bg-[var(--sc-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-red-200">
              {adminBadgeCount}
            </span>
          )}
        </button>
      </nav>

      {/* Compact Sources & Refresh */}
      <div className="mt-auto hidden flex-col gap-2.5 border-t border-[var(--sc-border-subtle)] pt-3 lg:flex">
        <div className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--sc-text-secondary)]">
            <Palette className="h-3.5 w-3.5" />
            <span>Tema</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {[
              { id: 'dark' as const, label: 'Escuro' },
              { id: 'light' as const, label: 'Claro' },
              { id: 'momolada' as const, label: 'Momolada' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTheme(opt.id)}
                className={`rounded-[var(--sc-radius-sm)] px-1.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                  theme === opt.id
                    ? 'bg-[var(--sc-accent)] text-white'
                    : 'bg-black/20 text-[var(--sc-text-secondary)] hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {gamepadConnected && (
          <div className="flex items-center gap-2 rounded-[var(--sc-radius-md)] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">
            <Gamepad2 className="h-3.5 w-3.5 shrink-0" />
            <span>Controle conectado</span>
          </div>
        )}
        <div className="rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white">
              {sourcesError ? 'API indisponível' : `${onlineCount}/${sources.length} fonte(s)`}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${
                sourcesError ? 'bg-red-500' : onlineCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-[var(--sc-text-secondary)]">{source.name}</span>
                <span className="shrink-0 text-[var(--sc-text-muted)]">{source.itemCount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefreshCatalog}
            className="flex flex-1 items-center gap-1.5 rounded-[var(--sc-radius-sm)] px-2 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
          <button
            type="button"
            onClick={() => setAddingSource((value) => !value)}
            title="Adicionar fonte"
            className="flex items-center gap-1 rounded-[var(--sc-radius-sm)] px-2 py-1.5 text-xs text-[var(--sc-text-secondary)] hover:bg-white/8 hover:text-white cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Fonte
          </button>
        </div>

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
        {refreshStatus && <p className="m-0 px-2 text-[11px] text-[var(--sc-text-muted)]">{refreshStatus}</p>}
      </div>
    </aside>
  )
}
