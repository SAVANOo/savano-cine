import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getTorrentLimits, setTorrentLimits } from '../torrent-stream.mjs'

const RECENT_CONNECTIONS = new Map()
let activeTunnelChild = null

function summarizeUserAgent(ua) {
  const s = String(ua || '')
  if (!s) return 'Dispositivo desconhecido'
  const os = /Android/i.test(s)
    ? 'Android'
    : /iPhone|iPad|iOS/i.test(s)
      ? 'iOS'
      : /Tizen|WebOS|SmartTV|BRAVIA|AFT/i.test(s)
        ? 'Smart TV'
        : /Windows/i.test(s)
          ? 'Windows'
          : /Mac OS/i.test(s)
            ? 'macOS'
            : /Linux/i.test(s)
              ? 'Linux'
              : 'Outro OS'
  const browser = /Edg\//i.test(s)
    ? 'Edge'
    : /Chrome\//i.test(s)
      ? 'Chrome'
      : /Firefox\//i.test(s)
        ? 'Firefox'
        : /Safari\//i.test(s)
          ? 'Safari'
          : /Dalvik|okhttp|ExoPlayer|Savano/i.test(s)
            ? 'App Mobile'
            : 'Navegador'
  return `${os} · ${browser}`
}

function classifyOrigin(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '')
  if (!clean || clean === '127.0.0.1' || clean === '::1') return 'Localhost'
  if (
    clean.startsWith('192.168.') ||
    clean.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(clean)
  ) {
    return 'Wi-Fi Local'
  }
  return 'Acesso Externo (4G/Internet)'
}

function readCookieValue(cookieHeader, key) {
  const match = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : ''
}

/** Records recent client IP / User-Agent / profile / playback activity for the admin Server & Connections tab. */
export function trackClientConnection(request, getClientIp) {
  const ip = String(request.headers['cf-connecting-ip'] || getClientIp(request) || '').replace(/^::ffff:/, '')
  const ua = String(request.headers['user-agent'] || '').slice(0, 140)
  const key = `${ip}::${ua}`
  const existing = RECENT_CONNECTIONS.get(key)
  const rawPath = String(request.url || '/').split('?')[0]
  const profileCookie = readCookieValue(request.headers.cookie, 'sc_profile_session')
  const isMediaPlay =
    /\/api\/media\/[^/]+\/(?:stream|transcode)/.test(rawPath) ||
    rawPath === '/api/addons/torrent-stream' ||
    rawPath === '/api/progress' ||
    rawPath === '/api/addons/progress'

  RECENT_CONNECTIONS.set(key, {
    ip: ip || '127.0.0.1',
    origin: classifyOrigin(ip),
    device: summarizeUserAgent(ua),
    userAgent: ua || 'Desconhecido',
    profileId: profileCookie || existing?.profileId || null,
    lastPath: rawPath,
    lastActivity: isMediaPlay ? `Reprodução (${rawPath})` : existing?.lastActivity || null,
    requests: (existing?.requests || 0) + 1,
    lastSeen: new Date().toISOString(),
  })
  if (RECENT_CONNECTIONS.size > 40) {
    const oldest = RECENT_CONNECTIONS.keys().next().value
    if (oldest) RECENT_CONNECTIONS.delete(oldest)
  }
}

/** Handles /api/admin/* endpoints (connections tracking, Cloudflare tunnel, backup, import/export, and batch artwork PT-BR sync). */
export async function handleAdminRoutes({ request, response, requestUrl, root, port, database, send }) {
  if (database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS client_connections (
        conn_key TEXT PRIMARY KEY,
        ip TEXT NOT NULL,
        origin TEXT,
        device TEXT,
        user_agent TEXT,
        profile_id TEXT,
        last_path TEXT,
        last_activity TEXT,
        requests INTEGER NOT NULL DEFAULT 1,
        last_seen TEXT NOT NULL
      )
    `)
    if (RECENT_CONNECTIONS.size > 0) {
      const upsertConn = database.prepare(`
        INSERT INTO client_connections (conn_key, ip, origin, device, user_agent, profile_id, last_path, last_activity, requests, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conn_key) DO UPDATE SET
          origin = excluded.origin,
          device = excluded.device,
          profile_id = COALESCE(excluded.profile_id, client_connections.profile_id),
          last_path = excluded.last_path,
          last_activity = COALESCE(excluded.last_activity, client_connections.last_activity),
          requests = client_connections.requests + 1,
          last_seen = excluded.last_seen
      `)
      for (const [k, c] of RECENT_CONNECTIONS.entries()) {
        upsertConn.run(k, c.ip, c.origin, c.device, c.userAgent, c.profileId, c.lastPath, c.lastActivity, c.requests, c.lastSeen)
      }
      RECENT_CONNECTIONS.clear()
    }
  }

  if (requestUrl.pathname === '/api/admin/connections' && request.method === 'GET') {
    if (database) {
      const rows = database
        .prepare(`
          SELECT ip, origin, device, user_agent AS userAgent, profile_id AS profileId,
                 last_path AS lastPath, last_activity AS lastActivity, requests, last_seen AS lastSeen
          FROM client_connections
          ORDER BY last_seen DESC
          LIMIT 50
        `)
        .all()
      send(response, 200, rows)
      return true
    }
    send(response, 200, Array.from(RECENT_CONNECTIONS.values()).reverse())
    return true
  }

  if (requestUrl.pathname === '/api/admin/tunnel/start' && request.method === 'POST') {
    const cloudflaredExe = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
    if (!existsSync(cloudflaredExe)) {
      send(response, 404, { error: 'cloudflared não instalado neste computador.' })
      return true
    }
    const tunnelFile = path.resolve(root, '..', 'data', 'tunnel-url.txt')
    if (activeTunnelChild && !activeTunnelChild.killed) {
      const existingUrl = existsSync(tunnelFile) ? readFileSync(tunnelFile, 'utf8').trim() : ''
      send(response, 200, { running: true, tunnelUrl: existingUrl })
      return true
    }
    const child = spawn(cloudflaredExe, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    activeTunnelChild = child
    const onChunk = (chunk) => {
      const text = chunk.toString('utf8')
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m) {
        try {
          mkdirSync(path.dirname(tunnelFile), { recursive: true })
          writeFile(tunnelFile, m[0], 'utf8').catch(() => undefined)
        } catch {
          // ignore
        }
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('exit', () => {
      if (activeTunnelChild === child) activeTunnelChild = null
    })
    await new Promise((r) => setTimeout(r, 2500))
    const tunnelUrl = existsSync(tunnelFile) ? readFileSync(tunnelFile, 'utf8').trim() : ''
    send(response, 200, { running: true, tunnelUrl })
    return true
  }

  if (requestUrl.pathname === '/api/admin/tunnel/stop' && request.method === 'POST') {
    if (activeTunnelChild && !activeTunnelChild.killed) {
      activeTunnelChild.kill()
      activeTunnelChild = null
    }
    send(response, 200, { running: false })
    return true
  }

  if (requestUrl.pathname === '/api/admin/backup' && request.method === 'POST') {
    const dataDir = path.resolve(root, '..', 'data')
    const dbPath = path.join(dataDir, 'catalog.db')
    const backupsDir = path.join(dataDir, 'backups')
    if (!existsSync(dbPath)) {
      send(response, 404, { error: 'Banco catalog.db não encontrado.' })
      return true
    }
    mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const destName = `catalog-${stamp}.db`
    copyFileSync(dbPath, path.join(backupsDir, destName))
    const allBackups = readdirSync(backupsDir)
      .filter((f) => f.startsWith('catalog-') && f.endsWith('.db'))
      .sort()
    while (allBackups.length > 5) {
      const oldest = allBackups.shift()
      if (oldest) {
        try {
          unlinkSync(path.join(backupsDir, oldest))
        } catch {
          // ignore
        }
      }
    }
    send(response, 200, { ok: true, filename: destName, totalBackups: allBackups.length })
    return true
  }

  if (requestUrl.pathname === '/api/admin/artwork/sync-ptbr' && request.method === 'POST' && database) {
    const dataDir = path.resolve(root, '..', 'data', 'artwork', 'movies')
    mkdirSync(dataDir, { recursive: true })
    const candidates = database
      .prepare(`
        SELECT m.id, m.title, m.year, a.id AS artId, a.remote_url AS remoteUrl, a.local_path AS localPath
        FROM media_items m
        LEFT JOIN artwork a ON a.movie_id = m.id AND a.artwork_type = 'poster'
        WHERE m.deleted_at IS NULL AND m.kind = 'movie' AND m.classification_status IN ('approved', 'auto')
          AND (a.id IS NULL OR a.remote_url LIKE '%Books-bookshelf%' OR a.verified = 0)
        LIMIT 20
      `)
      .all()

    let updated = 0
    for (const row of candidates) {
      try {
        const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(row.title)}.json`
        const res = await fetch(searchUrl, { signal: AbortSignal.timeout(4500) })
        if (!res.ok) continue
        const payload = await res.json().catch(() => null)
        const metas = Array.isArray(payload?.metas) ? payload.metas : []
        const match =
          metas.find((m) => row.year && String(m.releaseInfo || '').includes(String(row.year))) || metas[0]
        if (!match?.poster) continue
        const imgRes = await fetch(match.poster, { signal: AbortSignal.timeout(5000) })
        if (!imgRes.ok) continue
        const buf = Buffer.from(await imgRes.arrayBuffer())
        if (buf.length < 2000) continue
        const safeSlug = row.id.replace(/[^a-z0-9-]+/gi, '-').slice(0, 80)
        const relLocal = path.join('data', 'artwork', 'movies', `${safeSlug}-sync.jpg`)
        await writeFile(path.resolve(root, '..', relLocal), buf)
        if (row.artId) {
          database
            .prepare(`UPDATE artwork SET remote_url = ?, local_path = ?, provider = 'cinemeta', provider_id = ? WHERE id = ?`)
            .run(match.poster, relLocal, match.id || null, row.artId)
        } else {
          database
            .prepare(
              `INSERT INTO artwork (id, movie_id, remote_url, local_path, provider, provider_id, source, verified, artwork_type) VALUES (?, ?, ?, ?, 'cinemeta', ?, 'remote', 0, 'poster')`,
            )
            .run(`art-sync-${safeSlug}`, row.id, match.poster, relLocal, match.id || null)
        }
        updated += 1
      } catch {
        // skip transient network failure per item
      }
    }
    send(response, 200, { checked: candidates.length, updated })
    return true
  }

  if (requestUrl.pathname === '/api/admin/torrent-settings') {
    if (request.method === 'GET') {
      send(response, 200, getTorrentLimits())
      return true
    }
    if (request.method === 'POST') {
      const body = await new Promise((resolve) => {
        let raw = ''
        request.on('data', (c) => {
          raw += c
        })
        request.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch {
            resolve({})
          }
        })
      })
      const updated = await setTorrentLimits(body || {})
      send(response, 200, updated)
      return true
    }
  }

  if (requestUrl.pathname === '/api/admin/export-history' && request.method === 'GET' && database) {
    const profileId = requestUrl.searchParams.get('profileId') || 'profile-savio'
    const format = requestUrl.searchParams.get('format') || 'csv'
    const rows = database
      .prepare(`
        SELECT m.title AS Title, m.year AS Year, wp.completed AS Watched, wp.updated_at AS WatchedDate,
               COALESCE(rt.score, '') AS Rating10
        FROM watch_progress wp
        JOIN media_items m ON m.id = wp.media_id
        LEFT JOIN ratings rt ON rt.profile_id = wp.profile_id AND rt.media_item_id = m.id
        WHERE wp.profile_id = ?
        ORDER BY wp.updated_at DESC
      `)
      .all(profileId)
    if (format === 'json') {
      send(response, 200, { profileId, exportedAt: new Date().toISOString(), items: rows })
      return true
    }
    const header = 'Title,Year,WatchedDate,Rating'
    const lines = rows.map((r) => {
      const safeTitle = `"${String(r.Title || '').replace(/"/g, '""')}"`
      const stars = r.Rating10 ? (Number(r.Rating10) / 2).toFixed(1) : ''
      return `${safeTitle},${r.Year || ''},${String(r.WatchedDate || '').slice(0, 10)},${stars}`
    })
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="savano-cine-${profileId}-history.csv"`,
    })
    response.end([header, ...lines].join('\n'))
    return true
  }

  if (requestUrl.pathname === '/api/admin/import-history' && request.method === 'POST' && database) {
    const body = await new Promise((resolve) => {
      let raw = ''
      request.on('data', (c) => {
        raw += c
      })
      request.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'))
        } catch {
          resolve({})
        }
      })
    })
    const profileId = String(body?.profileId || 'profile-savio').trim()
    const csv = String(body?.csv || '')
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) {
      send(response, 400, { error: 'CSV vazio ou inválido.' })
      return true
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS social_reviews (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        content_key TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'movie',
        title TEXT NOT NULL,
        poster TEXT,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        comment TEXT NOT NULL DEFAULT '',
        recommended_to_profile_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(profile_id, content_key)
      )
    `)
    const stmt = database.prepare(`
      INSERT INTO social_reviews (id, profile_id, content_key, content_type, title, rating, comment)
      VALUES (?, ?, ?, 'movie', ?, ?, 'Importado via CSV')
      ON CONFLICT(profile_id, content_key) DO UPDATE SET rating = excluded.rating, updated_at = CURRENT_TIMESTAMP
    `)
    let imported = 0
    for (const line of lines.slice(1, 201)) {
      const cols = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || []
      const title = String(cols[0] || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()
      if (!title) continue
      const rawRating = Number(cols[3] || cols[2] || 4)
      const stars = Math.max(1, Math.min(5, Math.round(Number.isFinite(rawRating) && rawRating > 0 ? rawRating : 4)))
      const key = `csv:${title.toLowerCase()}`
      stmt.run(`csv-${imported}-${Date.now()}`, profileId, key, title, stars)
      imported += 1
    }
    send(response, 200, { ok: true, imported })
    return true
  }

  return false
}
