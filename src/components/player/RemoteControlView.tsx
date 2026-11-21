import { Pause, Play, RotateCcw, RotateCw, SkipForward, Smartphone, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SavanoLogo } from '../ui/SavanoLogo'

type RemoteControlViewProps = {
  sessionCode: string
  onExit: () => void
}

/** Mobile-first remote control UI accessed via QR code (/remote?session=CODE) to control the PC/TV player. */
export function RemoteControlView({ sessionCode, onExit }: RemoteControlViewProps) {
  const [state, setState] = useState<{ title: string; paused: boolean; currentTime: number; duration: number }>({
    title: 'Aguardando player...',
    paused: false,
    currentTime: 0,
    duration: 0,
  })
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    const poll = () => {
      fetch(`/api/remote/${encodeURIComponent(sessionCode)}/state`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (active && data?.title) {
            setState({
              title: data.title,
              paused: Boolean(data.paused),
              currentTime: Number(data.currentTime || 0),
              duration: Number(data.duration || 0),
            })
          }
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [sessionCode])

  async function sendCommand(action: string, value?: number) {
    setStatus('')
    try {
      const res = await fetch(`/api/remote/${encodeURIComponent(sessionCode)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, value }),
      })
      if (res.ok) setStatus(`Comando enviado: ${action}`)
    } catch {
      setStatus('Erro ao enviar comando.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-[#090a0d] p-6 text-white">
      <div className="flex w-full max-w-sm items-center justify-between">
        <div className="flex items-center gap-2.5">
          <SavanoLogo size={32} />
          <div>
            <p className="m-0 text-sm font-bold">Controle Remoto</p>
            <p className="m-0 text-[11px] text-amber-400">Sessão {sessionCode}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="Fechar controle"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-[#12141c] p-6 text-center shadow-2xl">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-300">
            <Smartphone className="h-3.5 w-3.5" />
            Reproduzindo agora
          </span>
          <h1 className="m-0 truncate pt-2 text-lg font-bold">{state.title}</h1>
        </div>

        <div className="flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => void sendCommand('seekBy', -10)}
            aria-label="Voltar 10s"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 active:scale-95 cursor-pointer"
          >
            <RotateCcw className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => void sendCommand('togglePlay')}
            aria-label="Play ou Pausar"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500 text-[#090a0d] shadow-lg active:scale-95 cursor-pointer"
          >
            {state.paused ? <Play className="h-9 w-9 fill-current" /> : <Pause className="h-9 w-9 fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => void sendCommand('seekBy', 10)}
            aria-label="Avançar 10s"
            className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 active:scale-95 cursor-pointer"
          >
            <RotateCw className="h-6 w-6" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => void sendCommand('volumeDelta', -0.2)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-3 text-xs font-semibold active:scale-95 cursor-pointer"
          >
            <Volume2 className="h-4 w-4" />
            Vol -
          </button>
          <button
            type="button"
            onClick={() => void sendCommand('toggleMute')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-3 text-xs font-semibold active:scale-95 cursor-pointer"
          >
            <VolumeX className="h-4 w-4" />
            Mudo
          </button>
          <button
            type="button"
            onClick={() => void sendCommand('volumeDelta', 0.2)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-3 text-xs font-semibold active:scale-95 cursor-pointer"
          >
            <Volume2 className="h-4 w-4" />
            Vol +
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void sendCommand('nextEpisode')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-3 text-xs font-semibold active:scale-95 cursor-pointer"
          >
            <SkipForward className="h-4 w-4" />
            Próximo ep.
          </button>
          <button
            type="button"
            onClick={() => void sendCommand('close')}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/15 py-3 text-xs font-semibold text-red-300 active:scale-95 cursor-pointer"
          >
            Fechar Player
          </button>
        </div>

        {status && <p className="m-0 text-[11px] text-amber-300">{status}</p>}
      </div>

      <p className="m-0 text-[11px] text-white/40">Savano Cine · Controle Remoto Local</p>
    </div>
  )
}
