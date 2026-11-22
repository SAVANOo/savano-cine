import { Activity, AlertCircle, BarChart3, Clock, MousePointerClick, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'

type TelemetrySummary = {
  windowHours: number
  totalEvents: number
  uniqueSessions: number
  flows: Array<{
    flowName: string
    started: number
    completed: number
    abandoned: number
    errored: number
    inProgress: number
    completionRate: number
    avgDurationMs: number
    p95DurationMs: number
    maxDurationMs: number
  }>
  interactions: Array<{
    targetId: string
    view: string
    clicks: number
    repeatedClicks: number
    maxRapidCount: number
  }>
  player: {
    opens: number
    firstFrames: number
    avgTtffMs: number
    maxTtffMs: number
    bufferingEvents: number
    totalBufferingMs: number
    avgBufferingMs: number
    seeks: number
    slowSeeks: number
    avgSeekMs: number
    sourceSwitches: number
    audioSwitches: number
    subtitleSwitches: number
    stallRecoveries: number
    errors: number
  }
  navigation: Array<{ view: string; visits: number }>
  slowApis: Array<{
    endpoint: string
    calls: number
    errors: number
    avgDurationMs: number
    p95DurationMs: number
  }>
}

type TelemetryEventRow = {
  id: number
  sessionId: string
  profileId: string | null
  ts: string
  category: string
  name: string
  flowName: string | null
  status: string | null
  durationMs: number | null
  targetId: string | null
  view: string | null
  rapidCount: number
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0 ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)} ms`
}

/** Admin Analytics & Telemetry panel showing flows, bottlenecks, repeated clicks, and player health. */
export function TelemetryDashboard() {
  const [hours, setHours] = useState(24)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [summary, setSummary] = useState<TelemetrySummary | null>(null)
  const [events, setEvents] = useState<TelemetryEventRow[]>([])
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async () => {
    await Promise.resolve()
    setLoading(true)
    try {
      const [sumRes, evRes] = await Promise.all([
        fetch(`/api/telemetry/summary?hours=${hours}`),
        fetch(`/api/telemetry/events?category=${encodeURIComponent(categoryFilter)}&limit=80`),
      ])
      if (sumRes.ok) {
        setSummary((await sumRes.json()) as TelemetrySummary)
      }
      if (evRes.ok) {
        const rows = (await evRes.json()) as TelemetryEventRow[]
        setEvents(Array.isArray(rows) ? rows : [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [hours, categoryFilter])

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`/api/telemetry/summary?hours=${hours}`),
      fetch(`/api/telemetry/events?category=${encodeURIComponent(categoryFilter)}&limit=80`),
    ])
      .then(async ([sumRes, evRes]) => {
        if (!active) return
        if (sumRes.ok) {
          setSummary((await sumRes.json()) as TelemetrySummary)
        }
        if (evRes.ok) {
          const rows = (await evRes.json()) as TelemetryEventRow[]
          setEvents(Array.isArray(rows) ? rows : [])
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [hours, categoryFilter])

  const clearLogs = async () => {
    await fetch('/api/telemetry/events', { method: 'DELETE' }).catch(() => undefined)
    void loadData()
  }

  const totalRepeated = summary?.interactions.reduce((acc, item) => acc + item.repeatedClicks, 0) || 0
  const totalAbandoned = summary?.flows.reduce((acc, item) => acc + item.abandoned, 0) || 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-bold text-white">Telemetria, Fluxos & Gargalos</h2>
          <p className="m-0 text-xs text-white/60">
            Rastreamento completo de navegação, cliques repetidos, fluxos inacabados, APIs lentas e saúde do player.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[1, 24, 72].map((h) => (
            <Button key={h} size="sm" variant={hours === h ? 'light' : 'secondary'} onClick={() => setHours(h)}>
              {h}h
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void clearLogs()}>
            <Trash2 className="h-4 w-4" />
            Limpar
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-[var(--sc-radius-md)] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Activity className="h-4 w-4 text-[var(--sc-accent)]" />
            <span>Eventos ({hours}h)</span>
          </div>
          <p className="mt-2 mb-0 text-2xl font-extrabold text-white">{summary?.totalEvents ?? 0}</p>
          <p className="m-0 text-[11px] text-white/50">{summary?.uniqueSessions ?? 0} sessões</p>
        </div>

        <div className="rounded-[var(--sc-radius-md)] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Play className="h-4 w-4 text-emerald-400" />
            <span>1º Frame Médio</span>
          </div>
          <p className="mt-2 mb-0 text-2xl font-extrabold text-white">{fmtMs(summary?.player.avgTtffMs)}</p>
          <p className="m-0 text-[11px] text-white/50">Máx: {fmtMs(summary?.player.maxTtffMs)}</p>
        </div>

        <div className="rounded-[var(--sc-radius-md)] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Clock className="h-4 w-4 text-amber-400" />
            <span>Buffering Total</span>
          </div>
          <p className="mt-2 mb-0 text-2xl font-extrabold text-white">{fmtMs(summary?.player.totalBufferingMs)}</p>
          <p className="m-0 text-[11px] text-white/50">
            {summary?.player.bufferingEvents ?? 0} travamentos · {summary?.player.sourceSwitches ?? 0} trocas de fonte
          </p>
        </div>

        <div className="rounded-[var(--sc-radius-md)] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <AlertCircle className="h-4 w-4 text-rose-400" />
            <span>Fluxos Abandonados</span>
          </div>
          <p className="mt-2 mb-0 text-2xl font-extrabold text-white">{totalAbandoned}</p>
          <p className="m-0 text-[11px] text-white/50">{summary?.player.errors ?? 0} erros de player</p>
        </div>

        <div className="rounded-[var(--sc-radius-md)] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <MousePointerClick className="h-4 w-4 text-sky-400" />
            <span>Cliques Repetidos</span>
          </div>
          <p className="mt-2 mb-0 text-2xl font-extrabold text-white">{totalRepeated}</p>
          <p className="m-0 text-[11px] text-white/50">Acionamentos rápidos (&lt;2s)</p>
        </div>
      </div>

      {/* Flows Table */}
      <div className="rounded-[var(--sc-radius-lg)] border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <BarChart3 className="h-4 w-4 text-[var(--sc-accent)]" />
          <span>Fluxos (Início → Conclusão / Abandono / Tempo)</span>
        </div>
        {!summary || summary.flows.length === 0 ? (
          <p className="m-0 text-xs text-white/50">Nenhum fluxo registrado nessa janela ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 text-white/60">
                <tr>
                  <th className="py-2 pr-3">Fluxo</th>
                  <th className="py-2 px-3">Iniciados</th>
                  <th className="py-2 px-3">Concluídos</th>
                  <th className="py-2 px-3">Abandonados</th>
                  <th className="py-2 px-3">Erros</th>
                  <th className="py-2 px-3">Taxa</th>
                  <th className="py-2 px-3">Média</th>
                  <th className="py-2 pl-3">P95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/90">
                {summary.flows.map((f) => (
                  <tr key={f.flowName}>
                    <td className="py-2 pr-3 font-semibold">{f.flowName}</td>
                    <td className="py-2 px-3">{f.started}</td>
                    <td className="py-2 px-3 text-emerald-400">{f.completed}</td>
                    <td className="py-2 px-3 text-amber-300">{f.abandoned}</td>
                    <td className="py-2 px-3 text-rose-400">{f.errored}</td>
                    <td className="py-2 px-3">{f.completionRate}%</td>
                    <td className="py-2 px-3">{fmtMs(f.avgDurationMs)}</td>
                    <td className="py-2 pl-3">{fmtMs(f.p95DurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interactions + Slow APIs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--sc-radius-lg)] border border-white/10 bg-white/[0.02] p-4">
          <h3 className="mt-0 mb-3 text-sm font-bold text-white">Botões Mais Acionados & Cliques Duplicados</h3>
          {!summary || summary.interactions.length === 0 ? (
            <p className="m-0 text-xs text-white/50">Sem cliques registrados ainda.</p>
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-xs">
              {summary.interactions.map((row, idx) => (
                <div
                  key={`${row.targetId}-${row.view}-${idx}`}
                  className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-semibold text-white">{row.targetId}</div>
                    <div className="truncate text-[11px] text-white/50">{row.view}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-white/10 px-2 py-0.5 font-bold text-white">{row.clicks}x</span>
                    {row.repeatedClicks > 0 && (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        {row.repeatedClicks} repet.
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[var(--sc-radius-lg)] border border-white/10 bg-white/[0.02] p-4">
          <h3 className="mt-0 mb-3 text-sm font-bold text-white">Endpoints /api/* Mais Lentos (P95)</h3>
          {!summary || summary.slowApis.length === 0 ? (
            <p className="m-0 text-xs text-white/50">Sem chamadas de API medidas ainda.</p>
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-xs">
              {summary.slowApis.map((api) => (
                <div
                  key={api.endpoint}
                  className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-mono text-white">{api.endpoint}</div>
                    <div className="text-[11px] text-white/50">
                      {api.calls} chamadas · {api.errors} erros
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold text-white">P95 {fmtMs(api.p95DurationMs)}</div>
                    <div className="text-[11px] text-white/50">Média {fmtMs(api.avgDurationMs)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Events Feed */}
      <div className="rounded-[var(--sc-radius-lg)] border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-bold text-white">Eventos Recentes ({events.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {['all', 'player', 'flow', 'interaction', 'navigation', 'api'].map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={categoryFilter === cat ? 'light' : 'secondary'}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'all' ? 'Todos' : cat}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto font-mono text-[11px]">
          {events.map((ev) => (
            <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/[0.025] px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/80">{ev.category}</span>
                <span className="font-bold text-white">{ev.flowName || ev.name}</span>
                {ev.targetId && <span className="text-sky-300">{ev.targetId}</span>}
                {ev.status && ev.status !== 'ok' && <span className="text-amber-300">[{ev.status}]</span>}
                {ev.rapidCount >= 2 && <span className="text-rose-300">x{ev.rapidCount}</span>}
              </div>
              <div className="flex items-center gap-3 text-white/50">
                {typeof ev.durationMs === 'number' && <span className="text-emerald-300">{fmtMs(ev.durationMs)}</span>}
                <span>{ev.ts.slice(11, 19)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
