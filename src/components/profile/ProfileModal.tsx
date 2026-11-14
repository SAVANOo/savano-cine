import { Check, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Profile } from '../../domain/catalog'
import { getAvatarStyle, PROFILE_AVATAR_GROUPS } from '../../domain/uiHelpers'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

type ProfileModalProps = {
  open: boolean
  profile?: Profile
  canDelete?: boolean
  onClose: () => void
  onSaved: (profileId: string) => void
  onDeleted?: (profileId: string) => void
}

/** Netflix-style profile creator & editor with avatar icons organized by series. */
export function ProfileModal({ open, profile, canDelete = false, onClose, onSaved, onDeleted }: ProfileModalProps) {
  const [name, setName] = useState(profile?.name ?? '')
  const [avatarKey, setAvatarKey] = useState<string>(profile?.avatarKey ?? 'savino')
  const [isKids, setIsKids] = useState(Boolean(profile?.isKids))
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')

  const previewStyle = getAvatarStyle(avatarKey)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profile?.id,
          name: name.trim(),
          avatarKey,
          isKids,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(body?.error || 'Falha ao salvar perfil.')
        return
      }
      onSaved(body?.id || profile?.id || 'profile-savio')
      onClose()
    } catch {
      setError('API indisponível para salvar perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="PERFIL"
      title={profile ? `Editar perfil: ${profile.name}` : 'Escolha o ícone do seu perfil'}
      subtitle="Avatares organizados por série estilo streaming"
      maxWidthClass="max-w-4xl"
    >
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <div className="flex flex-wrap items-center gap-4 rounded-[var(--sc-radius-lg)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] p-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--sc-radius-md)] text-2xl font-black text-white shadow-lg"
            style={{ background: previewStyle.background }}
          >
            {previewStyle.imageUrl ? (
              <img src={previewStyle.imageUrl} alt={name || 'Avatar'} className="h-full w-full object-cover" />
            ) : (
              previewStyle.badge
            )}
          </span>
          <div className="min-w-0 flex-1">
            <label className="block text-xs font-semibold text-[var(--sc-text-secondary)]">
              Nome do perfil
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Savio, Família, Infantil"
                required
                className="mt-1.5 h-10 w-full rounded-[var(--sc-radius-sm)] border border-white/15 bg-black/40 px-3 text-sm text-white focus:border-[var(--sc-accent)] focus:outline-none"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--sc-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={isKids}
              onChange={(event) => setIsKids(event.target.checked)}
              className="accent-[var(--sc-accent)]"
            />
            Perfil Infantil
          </label>
        </div>

        <div className="flex max-h-[52vh] flex-col gap-5 overflow-y-auto pr-1">
          {PROFILE_AVATAR_GROUPS.map((group) => (
            <div key={group.series} className="flex flex-col gap-2.5">
              <h3 className="m-0 text-sm font-bold text-white">{group.series}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {group.options.map((option) => {
                  const selected = avatarKey === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setAvatarKey(option.key)}
                      className={`relative flex items-center gap-3 rounded-[var(--sc-radius-md)] border p-2.5 text-left transition cursor-pointer ${
                        selected
                          ? 'border-white bg-white/12 shadow-md'
                          : 'border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] hover:border-white/30'
                      }`}
                    >
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--sc-radius-sm)] text-base font-bold text-white"
                        style={{ background: option.gradient }}
                      >
                        <img src={option.imageUrl} alt={option.label} className="h-full w-full object-cover" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                        {option.label}
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-white" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="m-0 text-xs text-red-400">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sc-border-subtle)] pt-4">
          <div>
            {profile && canDelete && !confirmingDelete && (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setConfirmingDelete(true)}
                className="text-red-400 hover:bg-red-500/15 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Excluir perfil
              </Button>
            )}
            {profile && canDelete && confirmingDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-300">Confirmar exclusão?</span>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true)
                    setError('')
                    try {
                      const response = await fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, {
                        method: 'DELETE',
                      })
                      const body = await response.json().catch(() => null)
                      if (!response.ok) {
                        setError(body?.error || 'Não foi possível excluir o perfil.')
                        setConfirmingDelete(false)
                        return
                      }
                      onDeleted?.(profile.id)
                      onClose()
                    } catch {
                      setError('API indisponível para excluir perfil.')
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Sim, excluir
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancelar
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar perfil'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
