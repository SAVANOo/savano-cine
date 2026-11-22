const MAX_BATCH_SIZE = 100

function ensureTelemetrySchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      session_id TEXT NOT NULL,
      profile_id TEXT,
      ts TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      flow_id TEXT,
      flow_name TEXT,
      status TEXT,
      duration_ms REAL,
      target_id TEXT,
      view TEXT,
      rapid_count INTEGER NOT NULL DEFAULT 1,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(ts);
    CREATE INDEX IF NOT EXISTS idx_telemetry_cat ON telemetry_events(category);
    CREATE INDEX IF NOT EXISTS idx_telemetry_flow ON telemetry_events(flow_name, name);
  `)
}

function safeStr(val, maxLen = 160) {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  return s ? s.slice(0, maxLen) : null
}

function percentile95(sortedAsc) {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * 0.95))
  return Math.round(sortedAsc[idx])
}

/** Handles /api/telemetry/* ingestion, flow/bottleneck aggregation, and event inspection. */
export async function handleTelemetryRoutes({ request, response, requestUrl, database, readBody, send }) {
  if (!requestUrl.pathname.startsWith('/api/telemetry')) {
    return false
  }
  if (!database) {
    send(response, 503, { error: 'Banco de dados indisponível.' })
    return true
  }

  ensureTelemetrySchema(database)

  if (requestUrl.pathname === '/api/telemetry/events' && request.method === 'POST') {
    let body
    try {
      body = await readBody(request)
    } catch {
      send(response, 400, { error: 'JSON inválido.' })
      return true
    }

    const rawEvents = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH_SIZE) : []
    if (rawEvents.length === 0) {
      send(response, 202, { accepted: 0 })
      return true
    }

    const insert = database.prepare(`
      INSERT INTO telemetry_events (
        event_id, session_id, profile_id, ts, category, name,
        flow_id, flow_name, status, duration_ms, target_id, view, rapid_count, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertBatch = (items) => {
      let count = 0
      database.exec('BEGIN')
      try {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const sessionId = safeStr(item.sessionId, 80) || 'unknown'
          const category = safeStr(item.category, 32) || 'interaction'
          const name = safeStr(item.name, 80) || 'unknown'
          const ts = safeStr(item.ts, 40) || new Date().toISOString()
          const durationMs =
            typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0
              ? Math.round(item.durationMs)
              : null
          const rapidCount =
            typeof item.rapidCount === 'number' && Number.isFinite(item.rapidCount) && item.rapidCount >= 1
              ? Math.min(99, Math.floor(item.rapidCount))
              : 1
          let metaJson = null
          if (item.meta && typeof item.meta === 'object') {
            try {
              metaJson = JSON.stringify(item.meta).slice(0, 2000)
            } catch {
              metaJson = null
            }
          }
          insert.run(
            safeStr(item.eventId, 80),
            sessionId,
            safeStr(item.profileId, 80),
            ts,
            category,
            name,
            safeStr(item.flowId, 80),
            safeStr(item.flowName, 80),
            safeStr(item.status, 32),
            durationMs,
            safeStr(item.targetId, 120),
            safeStr(item.view, 120),
            rapidCount,
            metaJson,
          )
          count += 1
        }
        database.exec('COMMIT')
        return count
      } catch (err) {
        try {
          database.exec('ROLLBACK')
        } catch {
          // ignore rollback error
        }
        throw err
      }
    }

    const accepted = insertBatch(rawEvents)
    send(response, 202, { accepted })
    return true
  }

  if (requestUrl.pathname === '/api/telemetry/summary' && request.method === 'GET') {
    const hoursParam = Number(requestUrl.searchParams.get('hours') || 24)
    const hours = Number.isFinite(hoursParam) ? Math.min(168, Math.max(1, Math.floor(hoursParam))) : 24
    const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString()

    const totals = database
      .prepare(`
        SELECT COUNT(*) AS totalEvents, COUNT(DISTINCT session_id) AS uniqueSessions
        FROM telemetry_events
        WHERE ts >= ?
      `)
      .get(sinceIso)

    // Flow aggregation: detect started vs completed vs abandoned vs errored + durations
    const flowRows = database
      .prepare(`
        SELECT flow_name, name, status, duration_ms, flow_id
        FROM telemetry_events
        WHERE ts >= ? AND category = 'flow' AND flow_name IS NOT NULL
      `)
      .all(sinceIso)

    const flowMap = new Map()
    const startedFlowIds = new Map()
    const closedFlowIds = new Set()

    for (const row of flowRows) {
      const fn = row.flow_name
      if (!flowMap.has(fn)) {
        flowMap.set(fn, {
          flowName: fn,
          started: 0,
          completed: 0,
          abandoned: 0,
          errored: 0,
          inProgress: 0,
          durations: [],
        })
      }
      const agg = flowMap.get(fn)
      if (row.name === 'flow_start') {
        agg.started += 1
        if (row.flow_id) startedFlowIds.set(row.flow_id, fn)
      } else if (row.name === 'flow_end') {
        if (row.flow_id) closedFlowIds.add(row.flow_id)
        if (row.status === 'abandoned') agg.abandoned += 1
        else if (row.status === 'error' || row.status === 'timeout') agg.errored += 1
        else agg.completed += 1
        if (typeof row.duration_ms === 'number') agg.durations.push(row.duration_ms)
      } else if (row.name === 'flow_abandon') {
        if (row.flow_id) closedFlowIds.add(row.flow_id)
        agg.abandoned += 1
        if (typeof row.duration_ms === 'number') agg.durations.push(row.duration_ms)
      } else if (row.name === 'flow_error') {
        if (row.flow_id) closedFlowIds.add(row.flow_id)
        agg.errored += 1
        if (typeof row.duration_ms === 'number') agg.durations.push(row.duration_ms)
      }
    }

    for (const [fid, fn] of startedFlowIds.entries()) {
      if (!closedFlowIds.has(fid)) {
        const agg = flowMap.get(fn)
        if (agg) agg.inProgress += 1
      }
    }

    const flows = [...flowMap.values()]
      .map((f) => {
        const sorted = [...f.durations].sort((a, b) => a - b)
        const avgDurationMs =
          sorted.length > 0 ? Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length) : 0
        const maxDurationMs = sorted.length > 0 ? Math.round(sorted[sorted.length - 1]) : 0
        const completionRate = f.started > 0 ? Math.round((f.completed / f.started) * 100) : 0
        return {
          flowName: f.flowName,
          started: f.started,
          completed: f.completed,
          abandoned: f.abandoned,
          errored: f.errored,
          inProgress: f.inProgress,
          completionRate,
          avgDurationMs,
          p95DurationMs: percentile95(sorted),
          maxDurationMs,
        }
      })
      .sort((a, b) => b.started - a.started)

    // Button / interaction clicks + repeated clicks
    const interactions = database
      .prepare(`
        SELECT
          COALESCE(target_id, name) AS targetId,
          COALESCE(view, '/') AS view,
          COUNT(*) AS clicks,
          SUM(CASE WHEN rapid_count >= 2 THEN 1 ELSE 0 END) AS repeatedClicks,
          MAX(rapid_count) AS maxRapidCount
        FROM telemetry_events
        WHERE ts >= ? AND category = 'interaction'
        GROUP BY COALESCE(target_id, name), COALESCE(view, '/')
        ORDER BY clicks DESC
        LIMIT 30
      `)
      .all(sinceIso)

    // Player granular telemetry
    const playerRows = database
      .prepare(`
        SELECT name, duration_ms, meta_json
        FROM telemetry_events
        WHERE ts >= ? AND category = 'player'
      `)
      .all(sinceIso)

    const ttffs = []
    const buffers = []
    const seeks = []
    let opens = 0
    let firstFrames = 0
    let sourceSwitches = 0
    let audioSwitches = 0
    let subtitleSwitches = 0
    let slowSeeks = 0
    let stallRecoveries = 0
    let errors = 0

    for (const r of playerRows) {
      if (r.name === 'player_open') opens += 1
      else if (r.name === 'player_first_frame') {
        firstFrames += 1
        if (typeof r.duration_ms === 'number') ttffs.push(r.duration_ms)
      } else if (r.name === 'player_buffering_end') {
        if (typeof r.duration_ms === 'number') buffers.push(r.duration_ms)
      } else if (r.name === 'player_seek') {
        if (typeof r.duration_ms === 'number') {
          seeks.push(r.duration_ms)
          if (r.duration_ms > 2500) slowSeeks += 1
        }
      } else if (r.name === 'player_source_switch') sourceSwitches += 1
      else if (r.name === 'player_audio_switch') audioSwitches += 1
      else if (r.name === 'player_subtitle_switch') subtitleSwitches += 1
      else if (r.name === 'player_stall_recovery') stallRecoveries += 1
      else if (r.name === 'player_error') errors += 1
    }

    const totalBufferingMs = Math.round(buffers.reduce((s, v) => s + v, 0))
    const player = {
      opens,
      firstFrames,
      avgTtffMs: ttffs.length > 0 ? Math.round(ttffs.reduce((s, v) => s + v, 0) / ttffs.length) : 0,
      maxTtffMs: ttffs.length > 0 ? Math.round(Math.max(...ttffs)) : 0,
      bufferingEvents: buffers.length,
      totalBufferingMs,
      avgBufferingMs: buffers.length > 0 ? Math.round(totalBufferingMs / buffers.length) : 0,
      seeks: seeks.length,
      slowSeeks,
      avgSeekMs: seeks.length > 0 ? Math.round(seeks.reduce((s, v) => s + v, 0) / seeks.length) : 0,
      sourceSwitches,
      audioSwitches,
      subtitleSwitches,
      stallRecoveries,
      errors,
    }

    // Navigation views
    const navigation = database
      .prepare(`
        SELECT COALESCE(view, target_id, name) AS view, COUNT(*) AS visits
        FROM telemetry_events
        WHERE ts >= ? AND category = 'navigation'
        GROUP BY COALESCE(view, target_id, name)
        ORDER BY visits DESC
        LIMIT 20
      `)
      .all(sinceIso)

    // Slowest API endpoints
    const apiRows = database
      .prepare(`
        SELECT target_id AS endpoint, duration_ms, status
        FROM telemetry_events
        WHERE ts >= ? AND category = 'api' AND target_id IS NOT NULL AND duration_ms IS NOT NULL
      `)
      .all(sinceIso)

    const apiMap = new Map()
    for (const row of apiRows) {
      if (!apiMap.has(row.endpoint)) {
        apiMap.set(row.endpoint, { endpoint: row.endpoint, calls: 0, errors: 0, durations: [] })
      }
      const entry = apiMap.get(row.endpoint)
      entry.calls += 1
      if (row.status && row.status !== 'ok') entry.errors += 1
      entry.durations.push(row.duration_ms)
    }
    const slowApis = [...apiMap.values()]
      .map((a) => {
        const sorted = [...a.durations].sort((x, y) => x - y)
        return {
          endpoint: a.endpoint,
          calls: a.calls,
          errors: a.errors,
          avgDurationMs: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
          p95DurationMs: percentile95(sorted),
        }
      })
      .sort((a, b) => b.p95DurationMs - a.p95DurationMs)
      .slice(0, 15)

    send(response, 200, {
      windowHours: hours,
      totalEvents: totals?.totalEvents || 0,
      uniqueSessions: totals?.uniqueSessions || 0,
      flows,
      interactions,
      player,
      navigation,
      slowApis,
    })
    return true
  }

  if (requestUrl.pathname === '/api/telemetry/events' && request.method === 'GET') {
    const category = safeStr(requestUrl.searchParams.get('category'), 32)
    const limitParam = Number(requestUrl.searchParams.get('limit') || 100)
    const limit = Number.isFinite(limitParam) ? Math.min(300, Math.max(1, Math.floor(limitParam))) : 100
    const rows = category && category !== 'all'
      ? database
          .prepare(`
            SELECT id, session_id AS sessionId, profile_id AS profileId, ts, category, name,
                   flow_id AS flowId, flow_name AS flowName, status, duration_ms AS durationMs,
                   target_id AS targetId, view, rapid_count AS rapidCount, meta_json AS metaJson
            FROM telemetry_events
            WHERE category = ?
            ORDER BY id DESC
            LIMIT ?
          `)
          .all(category, limit)
      : database
          .prepare(`
            SELECT id, session_id AS sessionId, profile_id AS profileId, ts, category, name,
                   flow_id AS flowId, flow_name AS flowName, status, duration_ms AS durationMs,
                   target_id AS targetId, view, rapid_count AS rapidCount, meta_json AS metaJson
            FROM telemetry_events
            ORDER BY id DESC
            LIMIT ?
          `)
          .all(limit)

    send(response, 200, rows)
    return true
  }

  if (requestUrl.pathname === '/api/telemetry/events' && request.method === 'DELETE') {
    const info = database.prepare('DELETE FROM telemetry_events').run()
    send(response, 200, { cleared: info.changes })
    return true
  }

  return false
}
