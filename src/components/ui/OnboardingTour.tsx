import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export type TourStep = {
  selector: string
  title: string
  description: string
  hint: string
}

const SAVANO_TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="search-bar"]',
    title: 'Busca Unificada',
    description:
      'Pesquise filmes, séries ou gêneros em um só lugar. A busca consulta seu Acervo Local e todos os Addons Online simultaneamente.',
    hint: 'Dica: pressione a tecla "/" a qualquer momento para focar na busca.',
  },
  {
    selector: '[data-tour="nav-links"]',
    title: 'Navegação e Catálogos',
    description:
      'Alterne rapidamente entre Início, Continue assistindo, Acervo Local, Filmes e Séries com carrosséis por gênero.',
    hint: 'Dica: você pode recolher o menu e passar o mouse na borda esquerda para abri-lo.',
  },
  {
    selector: '[data-tour="nav-online"]',
    title: 'Acervo Online & Fontes',
    description:
      'Explore catálogos dos seus addons Stremio, veja bandeiras de idioma nas fontes e troque de fonte dentro do próprio player mantendo seu tempo.',
    hint: 'Clique em qualquer título online para ver as fontes agrupadas e legendas.',
  },
  {
    selector: '[data-tour="nav-surprise"]',
    title: 'Me Surpreenda',
    description:
      'Não sabe o que assistir? Escolha um clima ou descreva o estilo de filme/série e sorteie uma sugestão na hora.',
    hint: 'Experimente digitar palavras como "alienígena", "comédia" ou "suspense".',
  },
  {
    selector: '[data-tour="profile-theme"]',
    title: 'Seu Perfil e Tema',
    description:
      'Seu progresso, avaliações e Minha Lista são salvos só para este perfil. Você também pode personalizar o tema visual aqui embaixo.',
    hint: 'Você pode rever este tutorial quando quiser pelo botão "Tutorial" no rodapé do menu.',
  },
]

type OnboardingTourProps = {
  open: boolean
  onClose: () => void
}

type RectBox = {
  top: number
  left: number
  width: number
  height: number
}

/** Interactive step-by-step spotlight onboarding tour circling real UI elements. */
export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<RectBox | null>(null)

  const activeStep = SAVANO_TOUR_STEPS[stepIndex] ?? SAVANO_TOUR_STEPS[0]

  const measureTarget = useCallback(() => {
    if (!open || !activeStep) return
    const el = document.querySelector(activeStep.selector) as HTMLElement | null
    if (!el) {
      setTargetRect(null)
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) {
      setTargetRect(null)
      return
    }
    const pad = 6
    setTargetRect({
      top: Math.max(4, r.top - pad),
      left: Math.max(4, r.left - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    })
  }, [activeStep, open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(measureTarget)
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measureTarget)
      window.removeEventListener('scroll', measureTarget, true)
    }
  }, [measureTarget, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') {
        setStepIndex((prev) => (prev + 1 < SAVANO_TOUR_STEPS.length ? prev + 1 : prev))
      }
      if (e.key === 'ArrowLeft') {
        setStepIndex((prev) => Math.max(0, prev - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  if (!open) return null

  const isLast = stepIndex >= SAVANO_TOUR_STEPS.length - 1
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  let cardTop = Math.max(24, vh / 2 - 120)
  let cardLeft = Math.max(16, vw / 2 - 180)
  if (targetRect) {
    const spaceBelow = vh - (targetRect.top + targetRect.height)
    cardTop =
      spaceBelow >= 230
        ? targetRect.top + targetRect.height + 14
        : Math.max(16, targetRect.top - 220)
    cardLeft = Math.min(Math.max(16, targetRect.left), Math.max(16, vw - 376))
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Tutorial do Savano Cine">
      {!targetRect && <div className="fixed inset-0 bg-black/75 backdrop-blur-[1px]" onClick={onClose} />}

      {targetRect && (
        <div
          className="pointer-events-none fixed rounded-[14px] border-2 border-[var(--sc-accent)] transition-all duration-300"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.74), 0 0 24px rgba(245, 158, 11, 0.45)',
          }}
        />
      )}

      <div
        className="fixed z-[95] w-[360px] max-w-[calc(100vw-2rem)] rounded-[var(--sc-radius-lg)] border border-[var(--sc-accent)]/50 bg-[var(--sc-bg-elevated)] p-5 shadow-2xl transition-all duration-300"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sc-accent-soft)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sc-accent)]">
            <Sparkles className="h-3 w-3" />
            Passo {stepIndex + 1} de {SAVANO_TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar tutorial"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[var(--sc-text-secondary)] hover:bg-white/20 hover:text-[var(--sc-text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="mt-3 mb-1 text-base font-bold text-[var(--sc-text-primary)]">{activeStep.title}</h3>
        <p className="m-0 text-xs leading-relaxed text-[var(--sc-text-secondary)]">{activeStep.description}</p>
        <p className="mt-2.5 mb-0 rounded-[var(--sc-radius-sm)] border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-2.5 py-2 text-[11px] font-medium text-[var(--sc-text-primary)]">
          {activeStep.hint}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] cursor-pointer"
          >
            Pular tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--sc-text-primary)] hover:border-[var(--sc-accent)] cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) {
                  setStepIndex(0)
                  onClose()
                } else {
                  setStepIndex((prev) => prev + 1)
                }
              }}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--sc-accent)] px-3.5 py-1.5 text-xs font-bold text-[#090a0d] hover:bg-[var(--sc-accent-hover)] cursor-pointer"
            >
              <span>{isLast ? 'Concluir' : 'Próximo'}</span>
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
