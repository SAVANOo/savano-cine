import { Lock } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../ui/Button'

type PinGateProps = {
  onUnlocked: () => void
}

/** Optional PIN access gate shown when CINE_ACCESS_PIN is configured on the server. */
export function PinGate({ onUnlocked }: PinGateProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!pin.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setError(payload?.error || 'PIN incorreto.')
        return
      }
      onUnlocked()
    } catch {
      setError('Não foi possível validar o PIN.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Acesso protegido por PIN"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#08090d] px-6 text-white"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-[var(--sc-radius-xl)] border border-white/15 bg-[#12141c] p-7 text-center shadow-2xl"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sc-accent-soft)] text-[var(--sc-accent)]">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Savano Cine</h1>
          <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
            Digite o PIN de acesso configurado neste servidor.
          </p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN de acesso"
          className="w-full rounded-[var(--sc-radius-md)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-4 py-2.5 text-center text-lg tracking-widest text-white outline-none focus:border-white/50"
        />
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Verificando...' : 'Entrar'}
        </Button>
      </form>
    </div>
  )
}
