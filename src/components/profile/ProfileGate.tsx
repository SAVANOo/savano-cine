import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Profile } from '../../domain/catalog'
import { getAvatarStyle } from '../../domain/uiHelpers'

type ProfileGateProps = {
  profiles: Profile[]
  backdropUrl?: string
  onSelectProfile: (profileId: string) => void
  onAddProfile: () => void
  onEditProfile: (profile: Profile) => void
}

/**
 * Netflix-style "Quem está assistindo?" full-screen profile selector.
 * Shown on first visit, incognito sessions, or when the 24h profile cookie TTL expires.
 */
export function ProfileGate({
  profiles,
  backdropUrl,
  onSelectProfile,
  onAddProfile,
  onEditProfile,
}: ProfileGateProps) {
  const [managing, setManaging] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#08090d] px-6 py-10 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Quem está assistindo?"
    >
      {backdropUrl && (
        <img
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-20 blur-md"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-black/55 to-[#08090d]" />

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--sc-radius-md)] bg-gradient-to-br from-[#e50914] to-[#9b1c31] text-base font-black text-white shadow-lg">
            S
          </span>
          <span className="text-lg font-bold tracking-tight text-white">Savano Cine</span>
        </div>

        <h1 className="m-0 text-3xl font-black tracking-tight text-white sm:text-5xl">
          {managing ? 'Gerenciar perfis' : 'Quem está assistindo?'}
        </h1>

        <div className="flex flex-wrap items-center justify-center gap-5 sm:gap-7">
          {profiles.map((profile) => {
            const style = getAvatarStyle(profile.avatarKey)
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => (managing ? onEditProfile(profile) : onSelectProfile(profile.id))}
                className="group flex w-28 flex-col items-center gap-3 border-0 bg-transparent p-0 text-center cursor-pointer sm:w-32"
              >
                <div
                  className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-[var(--sc-radius-lg)] border-2 border-white/15 shadow-2xl transition-all duration-200 group-hover:scale-105 group-hover:border-white sm:h-32 sm:w-32"
                  style={{ background: style.background }}
                >
                  {style.imageUrl ? (
                    <img
                      src={style.imageUrl}
                      alt={profile.name}
                      className={`h-full w-full object-cover transition ${managing ? 'opacity-50' : ''}`}
                    />
                  ) : (
                    <span className="text-3xl font-black text-white">{style.badge}</span>
                  )}

                  {Boolean(profile.isKids) && (
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      Infantil
                    </span>
                  )}

                  {managing && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-black/70 text-white">
                        <Pencil className="h-4 w-4" />
                      </span>
                    </span>
                  )}
                </div>
                <span className="max-w-full truncate text-sm font-semibold text-[var(--sc-text-secondary)] transition group-hover:text-white">
                  {profile.name}
                </span>
              </button>
            )
          })}

          <button
            type="button"
            onClick={onAddProfile}
            className="group flex w-28 flex-col items-center gap-3 border-0 bg-transparent p-0 text-center cursor-pointer sm:w-32"
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-[var(--sc-radius-lg)] border-2 border-dashed border-white/25 bg-white/5 text-white/75 transition-all duration-200 group-hover:scale-105 group-hover:border-white group-hover:bg-white/12 group-hover:text-white sm:h-32 sm:w-32">
              <Plus className="h-10 w-10" />
            </div>
            <span className="text-sm font-semibold text-[var(--sc-text-secondary)] transition group-hover:text-white">
              Adicionar perfil
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setManaging((value) => !value)}
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/8 px-5 py-2 text-xs font-semibold text-white/90 transition hover:border-white hover:bg-white/15 cursor-pointer"
        >
          <Pencil className="h-3.5 w-3.5" />
          {managing ? 'Concluir' : 'Gerenciar perfis'}
        </button>
      </div>
    </div>
  )
}
