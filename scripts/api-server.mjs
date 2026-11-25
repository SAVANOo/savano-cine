import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { findMountedSource, getRootRelativePath, getVolumeInfoForPath } from './volume-info.mjs'
import { getAdapterForSource } from './source-adapters.mjs'
import {
  assertSafeExternalUrl,
  fetchSafeWithRedirects,
  isPrivateHostname,
  isTrustedOrigin,
} from './security-url.mjs'
import { handleAdminRoutes, trackClientConnection } from './routes/admin-routes.mjs'
import { handleTelemetryRoutes } from './routes/telemetry-routes.mjs'
import { handleRealtimeRoutes } from './routes/realtime-routes.mjs'
import { handleSocialRoutes } from './routes/social-routes.mjs'
import {
  deleteStremioAddon,
  ensureStremioAddonsTable,
  fetchAddonCatalog,
  fetchAddonMeta,
  fetchFallbackMeta,
  installStremioAddon,
  listStremioAddons,
  queryAddonStreams,
  queryAddonSubtitles,
  searchAddonFallback,
  setStremioAddonEnabled,
} from './stremio-addons.mjs'
import {
  getTorrentStatus,
  isValidInfoHash,
  prepareTorrentStream,
  probeTorrentInfo,
  serveTorrentStream,
  stopTorrentStream,
} from './torrent-stream.mjs'
import { cleanTitle } from './scan-media.mjs'

const port = Number(process.env.CINE_API_PORT || 4174)
const host = process.env.CINE_HOST?.trim() || '0.0.0.0'
const accessPin =
  process.env.CINE_ACCESS_PIN?.trim() === 'off'
    ? ''
    : process.env.CINE_ACCESS_PIN?.trim() || '4321'
const pinToken = accessPin ? createHash('sha256').update(`savano-cine:${accessPin}`).digest('hex') : ''
const root = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(root, '..', 'dist')
const databasePath = process.env.CINE_DB_PATH?.trim()
  ? path.resolve(process.env.CINE_DB_PATH.trim())
  : path.resolve(root, '..', 'data', 'catalog.db')

if (!existsSync(databasePath)) {
  console.error(`Catálogo não encontrado: ${databasePath}`)
  console.error('Execute primeiro: npm run import -- "E:\\Filmes"')
  process.exit(1)
}

const database = new DatabaseSync(databasePath)
const execFileAsync = promisify(execFile)
ensureColumn('media_sources', 'root_relative_path', 'TEXT')
ensureColumn('profiles', 'passcode_hash', 'TEXT')
ensureColumn('profiles', 'is_admin', 'INTEGER NOT NULL DEFAULT 0')
{
  const hasAdmin = database.prepare('SELECT 1 FROM profiles WHERE is_admin = 1 LIMIT 1').get()
  if (!hasAdmin) {
    const adminId = process.env.CINE_ADMIN_PROFILE_ID?.trim() || 'profile-admin'
    const res = database.prepare('UPDATE profiles SET is_admin = 1 WHERE id = ?').run(adminId)
    if (res.changes === 0) {
      database.prepare('UPDATE profiles SET is_admin = 1 WHERE id = (SELECT id FROM profiles ORDER BY created_at LIMIT 1)').run()
    }
  }
}
ensureArtworkCandidatesTable()
ensureWatchlistTable()
ensureStremioAddonsTable(database)
database.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS stremio_progress (
    profile_id TEXT NOT NULL,
    media_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    poster TEXT,
    position_sec REAL NOT NULL DEFAULT 0,
    duration_sec REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (profile_id, media_key)
  )
`)
ensureColumn('stremio_progress', 'poster', 'TEXT')
ignorePromotionalAds()
reconcileMisclassifiedEpisodes()
sanitizeExistingTitles()
let lastSourceRefreshAt = 0
setTimeout(() => {
  try {
    refreshSourceStatuses()
  } catch {
    // ignore startup source refresh error
  }
}, 100)
const catalogRefresh = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  sourceIds: [],
  results: [],
  error: null,
  process: null,
}

const AUTH_FAILURES = new Map()
const LOCAL_ADDON_DOWNLOADS = new Map()
const AUTH_WINDOW_MS = 60_000
const AUTH_MAX_FAILURES = 6

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return request.socket?.remoteAddress || 'unknown'
}

function isAuthRateLimited(request) {
  const ip = getClientIp(request)
  const entry = AUTH_FAILURES.get(ip)
  if (!entry) return false
  if (Date.now() - entry.firstAt > AUTH_WINDOW_MS) {
    AUTH_FAILURES.delete(ip)
    return false
  }
  return entry.count >= AUTH_MAX_FAILURES
}

function recordAuthFailure(request) {
  const ip = getClientIp(request)
  const now = Date.now()
  const entry = AUTH_FAILURES.get(ip)
  if (!entry || now - entry.firstAt > AUTH_WINDOW_MS) {
    AUTH_FAILURES.set(ip, { count: 1, firstAt: now })
  } else {
    entry.count += 1
  }
}

function clearAuthFailures(request) {
  AUTH_FAILURES.delete(getClientIp(request))
}

function getSessionProfileId(request) {
  const cookieHeader = String(request.headers.cookie || '')
  const match = cookieHeader.match(/(?:^|;\s*)sc_profile_session=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

function isNonAdminSession(request) {
  const sessionId = getSessionProfileId(request)
  if (!sessionId) return false
  const row = database.prepare('SELECT is_admin FROM profiles WHERE id = ?').get(sessionId)
  return Boolean(row && !row.is_admin)
}

function requireAdmin(request, response) {
  if (isNonAdminSession(request)) {
    send(response, 403, { error: 'Acesso restrito ao perfil administrador.' })
    return false
  }
  return true
}

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'SAMEORIGIN')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; media-src 'self' https: blob:; connect-src 'self' https:; font-src 'self' data:; frame-ancestors 'self'",
  )
}

const ADDON_CATALOG_CACHE = new Map()
const ADDON_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
const SHOW_ARTWORK_CACHE = new Map()
const SHOW_ARTWORK_CACHE_TTL_MS = 60 * 60 * 1000

createServer(async (request, response) => {
  applySecurityHeaders(response)
  trackClientConnection(request, getClientIp)
  try {
    await handleApiRequest(request, response)
  } catch (error) {
    logApiError(request, error)
    if (!response.headersSent) {
      send(response, 500, { error: 'Erro interno na API local. Verifique os logs de monitoria.' })
    } else if (!response.destroyed) {
      response.destroy()
    }
  }
}).listen(port, host, () => {
  console.log(`Savano Cine API em http://${host}:${port}`)
})

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

function hashProfilePasscode(profileId, passcode) {
  return createHash('sha256').update(`profile-lock:${profileId}:${passcode}`).digest('hex')
}

function isPinAuthenticated(request) {
  if (!accessPin) return true
  const headerPin = request.headers['x-cine-pin']
  if (typeof headerPin === 'string' && headerPin === accessPin) return true
  const cookieHeader = String(request.headers.cookie || '')
  const match = cookieHeader.match(/(?:^|;\s*)sc_pin_ok=([^;]+)/)
  if (!match) return false
  const received = decodeURIComponent(match[1])
  if (received.length !== pinToken.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(pinToken))
}

function serveStaticDist(pathname, response) {
  const indexFile = path.join(distDir, 'index.html')
  if (!existsSync(indexFile)) return false
  const safePath = decodeURIComponent(pathname.split('?')[0] || '/')
  const relative = safePath === '/' ? 'index.html' : safePath.replace(/^\/+/, '')
  let target = path.resolve(distDir, relative)
  if (!target.startsWith(distDir + path.sep) && target !== indexFile) {
    return false
  }
  if (!existsSync(target) || statSync(target).isDirectory()) {
    target = indexFile
  }
  const ext = path.extname(target).toLowerCase()
  response.writeHead(200, {
    'Content-Type': STATIC_MIME_TYPES[ext] || 'application/octet-stream',
  })
  createReadStream(target).pipe(response)
  return true
}

async function handleApiRequest(request, response) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

  if (!requestUrl.pathname.startsWith('/api/')) {
    if (serveStaticDist(requestUrl.pathname, response)) return
  }

  const origin = String(request.headers.origin || '')
  if (isTrustedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'same-origin')
  response.setHeader('X-Frame-Options', 'SAMEORIGIN')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (requestUrl.pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(request, response)) return
  }

  const isCatalogAdminWriteRoute =
    request.method !== 'GET' &&
    (requestUrl.pathname.startsWith('/api/review') ||
      requestUrl.pathname.startsWith('/api/catalog/') ||
      requestUrl.pathname.startsWith('/api/artwork/'))
  if (isCatalogAdminWriteRoute && !requireAdmin(request, response)) return

  if (requestUrl.pathname === '/api/admin/debrid' && request.method === 'GET') {
    const provider = database.prepare("SELECT value FROM app_settings WHERE key = 'debrid_provider'").get()?.value || 'none'
    const token = database.prepare("SELECT value FROM app_settings WHERE key = 'debrid_token'").get()?.value || ''
    const maskedToken = token.length > 6 ? `${token.slice(0, 3)}***${token.slice(-3)}` : token ? '***' : ''
    return send(response, 200, { provider, configured: Boolean(token && provider !== 'none'), maskedToken })
  }

  if (requestUrl.pathname === '/api/admin/debrid' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const provider = ['none', 'realdebrid', 'torbox', 'alldebrid'].includes(body?.provider) ? body.provider : 'none'
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('debrid_provider', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(provider)
    if (token || provider === 'none') {
      database.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('debrid_token', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(provider === 'none' ? '' : token)
    }
    return send(response, 200, { ok: true, provider, configured: Boolean((token || provider !== 'none')) })
  }

  if (requestUrl.pathname === '/api/addons/debrid-status' && request.method === 'GET') {
    const provider = database.prepare("SELECT value FROM app_settings WHERE key = 'debrid_provider'").get()?.value || 'none'
    const token = database.prepare("SELECT value FROM app_settings WHERE key = 'debrid_token'").get()?.value || ''
    return send(response, 200, { provider, configured: Boolean(token && provider !== 'none') })
  }

  if (requestUrl.pathname === '/api/health') {
    return send(response, 200, { status: 'ok', pinRequired: Boolean(accessPin) })
  }

  if (requestUrl.pathname === '/api/auth/pin') {
    if (request.method === 'GET') {
      return send(response, 200, {
        required: Boolean(accessPin),
        authenticated: isPinAuthenticated(request),
      })
    }
    if (request.method === 'POST') {
      if (!accessPin) return send(response, 200, { authenticated: true })
      if (isAuthRateLimited(request)) {
        return send(response, 429, { error: 'Muitas tentativas incorretas. Aguarde 1 minuto.' })
      }
      let body
      try {
        body = await readJson(request)
      } catch {
        return send(response, 400, { error: 'JSON inválido.' })
      }
      const submitted = typeof body.pin === 'string' ? body.pin.trim() : ''
      const expectedBuf = Buffer.from(accessPin)
      const submittedBuf = Buffer.from(submitted)
      if (!submitted || submittedBuf.length !== expectedBuf.length || !timingSafeEqual(submittedBuf, expectedBuf)) {
        recordAuthFailure(request)
        return send(response, 401, { error: 'PIN incorreto.' })
      }
      clearAuthFailures(request)
      response.setHeader(
        'Set-Cookie',
        `sc_pin_ok=${encodeURIComponent(pinToken)}; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/`,
      )
      return send(response, 200, { authenticated: true })
    }
    if (request.method === 'DELETE') {
      response.setHeader('Set-Cookie', 'sc_pin_ok=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/')
      return send(response, 200, { authenticated: false })
    }
  }

  if (accessPin && !isPinAuthenticated(request)) {
    return send(response, 401, { error: 'PIN de acesso necessário.', pinRequired: true })
  }

  if (requestUrl.pathname === '/api/logs/errors' && request.method === 'GET') {
    if (!requireAdmin(request, response)) return
    return send(response, 200, readRecentErrorLogs())
  }

let cachedHwEncoder
function detectHwEncoder(ffmpegAvailable) {
  if (!ffmpegAvailable) return null
  if (cachedHwEncoder !== undefined) return cachedHwEncoder
  try {
    const res = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    })
    const out = String(res.stdout || '')
    if (/\bh264_nvenc\b/.test(out)) cachedHwEncoder = 'h264_nvenc'
    else if (/\bh264_qsv\b/.test(out)) cachedHwEncoder = 'h264_qsv'
    else if (/\bh264_amf\b/.test(out)) cachedHwEncoder = 'h264_amf'
    else cachedHwEncoder = null
  } catch {
    cachedHwEncoder = null
  }
  return cachedHwEncoder
}

  if (requestUrl.pathname === '/api/player/capabilities') {
    const runtimes = {
      ffmpeg: detectRuntime('CINE_FFMPEG_PATH', 'ffmpeg.exe'),
      ffprobe: detectRuntime('CINE_FFPROBE_PATH', 'ffprobe.exe'),
      vlc: detectRuntime('CINE_VLC_PATH', 'vlc.exe'),
    }
    return send(response, 200, {
      browser: true,
      ffmpeg: runtimes.ffmpeg.available,
      transcoding: runtimes.ffmpeg.available,
      hwEncoder: detectHwEncoder(runtimes.ffmpeg.available),
      ffprobe: runtimes.ffprobe.available,
      vlc: runtimes.vlc.available,
      diagnostics: Object.fromEntries(Object.entries(runtimes).map(([name, runtime]) => [
        name,
        { source: runtime.source, reason: runtime.reason },
      ])),
    })
  }

  if (requestUrl.pathname === '/api/sources' && request.method === 'POST') {
    if (!requireAdmin(request, response)) return
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
    const customName = typeof body.name === 'string' ? body.name.trim() : ''
    if (!rawPath) {
      return send(response, 400, { error: 'Informe o caminho da pasta ou a URL do servidor autorizado.' })
    }
    const adapter = getAdapterForSource(rawPath)
    if (adapter.kind === 'self_hosted') {
      const id = `source-${slugify(customName || rawPath) || Date.now()}`
      const status = await adapter.checkAvailability({ root_path: rawPath })
      const name = customName || new URL(rawPath).host
      database.prepare(`
        INSERT INTO media_sources (id, name, root_path, removable, status)
        VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(root_path) DO UPDATE SET name = excluded.name, status = excluded.status
      `).run(id, name, rawPath.replace(/\/+$/, ''), status)
      return send(response, 201, { id, name, path: rawPath.replace(/\/+$/, ''), status, adapter: adapter.kind })
    }

    const resolvedPath = path.resolve(rawPath)
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      return send(response, 400, { error: 'Pasta local não encontrada ou inacessível.' })
    }
    const described = adapter.describeNewSource(resolvedPath, customName)
    const id = `source-${slugify(described.name) || Date.now()}`
    database.prepare(`
      INSERT INTO media_sources (id, name, root_path, root_relative_path, volume_id, volume_label, removable, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET
        name = excluded.name,
        root_relative_path = excluded.root_relative_path,
        volume_id = excluded.volume_id,
        volume_label = excluded.volume_label,
        removable = excluded.removable,
        status = excluded.status
    `).run(
      id,
      described.name,
      described.rootPath,
      described.rootRelativePath,
      described.volumeId,
      described.volumeLabel,
      described.removable,
      described.status,
    )
    return send(response, 201, { id, name: described.name, path: described.rootPath, status: described.status, adapter: adapter.kind })
  }

  if (requestUrl.pathname === '/api/sources') {
    setTimeout(() => {
      try {
        setTimeout(() => {
  try {
    refreshSourceStatuses()
  } catch {
    // ignore startup source refresh error
  }
}, 100)
      } catch {
        // ignore background source refresh error
      }
    }, 0)
    const sources = database.prepare(`
      SELECT id, name, root_path AS path, status, removable, volume_label AS volumeLabel,
        volume_id AS volumeId,
        (SELECT COUNT(*) FROM media_items WHERE source_id = media_sources.id) AS itemCount
      FROM media_sources
      ORDER BY name
    `).all()

    return send(response, 200, sources)
  }

  if (requestUrl.pathname === '/api/catalog/refresh/status' && request.method === 'GET') {
    return send(response, 200, refreshStatus())
  }

  if (requestUrl.pathname === '/api/catalog/gaps' && request.method === 'GET') {
    return send(response, 200, buildCatalogGaps())
  }

  if (requestUrl.pathname === '/api/catalog/refresh' && request.method === 'POST') {
    if (!requireAdmin(request, response)) return
    if (catalogRefresh.state === 'running') {
      return send(response, 409, { error: 'Uma atualização do catálogo já está em andamento.', ...refreshStatus() })
    }

    refreshSourceStatuses(true)
    const requestedSourceId = requestUrl.searchParams.get('sourceId')
    const sources = database.prepare(`
      SELECT id, root_path AS rootPath, status
      FROM media_sources
      WHERE status = 'online' AND (? IS NULL OR id = ?)
      ORDER BY id
    `).all(requestedSourceId, requestedSourceId)
    if (requestedSourceId && sources.length === 0) {
      return send(response, 404, { error: 'Fonte online não encontrada.' })
    }
    if (sources.length === 0) {
      return send(response, 409, { error: 'Nenhuma fonte online disponível para atualizar.' })
    }

    startCatalogRefresh(sources)
    return send(response, 202, refreshStatus())
  }

  if (requestUrl.pathname === '/api/progress' && request.method === 'GET') {
    const progress = database.prepare(`
      SELECT position_seconds AS position, duration_seconds AS duration, watched
      FROM watch_progress
      WHERE profile_id = ? AND media_item_id = ?
    `).get(requestUrl.searchParams.get('profileId'), requestUrl.searchParams.get('mediaId'))
    return send(response, 200, progress || null)
  }

  if (requestUrl.pathname === '/api/progress' && request.method === 'DELETE') {
    const profileId = requestUrl.searchParams.get('profileId') || ''
    const mediaId = requestUrl.searchParams.get('mediaId') || ''
    if (!profileId || !mediaId) {
      return send(response, 400, { error: 'profileId e mediaId obrigatórios.' })
    }
    const info = database
      .prepare(`
        DELETE FROM watch_progress
        WHERE profile_id = ?
          AND (media_item_id = ? OR media_item_id IN (SELECT id FROM media_items WHERE show_id = ?))
      `)
      .run(profileId, mediaId, mediaId)
    return send(response, 200, { deleted: info.changes > 0 })
  }

  if (requestUrl.pathname === '/api/progress' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const position = Math.max(0, Math.floor(Number(body.position) || 0))
    const duration = Math.max(0, Math.floor(Number(body.duration) || 0))
    const nearEnd = duration > 0 && (position / duration >= 0.9 || duration - position <= 120)
    const watched = body.watched || nearEnd ? 1 : 0
    database.prepare(`
      INSERT INTO watch_progress (profile_id, media_item_id, position_seconds, duration_seconds, watched)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, media_item_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        watched = excluded.watched,
        updated_at = CURRENT_TIMESTAMP
    `).run(body.profileId, body.mediaId, position, duration, watched)
    return send(response, 200, { position, duration, watched: Boolean(watched) })
  }

  if (requestUrl.pathname === '/api/rating' && request.method === 'GET') {
    const profileId = requestUrl.searchParams.get('profileId')
    const mediaId = requestUrl.searchParams.get('mediaId')
    const showId = requestUrl.searchParams.get('showId')
    const rating = mediaId
      ? database.prepare('SELECT score, review FROM ratings WHERE profile_id = ? AND media_item_id = ?').get(profileId, mediaId)
      : database.prepare('SELECT score, review FROM ratings WHERE profile_id = ? AND show_id = ?').get(profileId, showId)
    return send(response, 200, rating || null)
  }

  if (requestUrl.pathname === '/api/rating' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId : ''
    const mediaId = typeof body.mediaId === 'string' ? body.mediaId : ''
    const showId = typeof body.showId === 'string' ? body.showId : ''
    const score = Number(body.score)
    const review = typeof body.review === 'string' ? body.review.trim().slice(0, 500) : ''
    if (!profileId || (!mediaId && !showId) || (mediaId && showId) || !Number.isInteger(score) || score < 0 || score > 10) {
      return send(response, 400, { error: 'Avaliação inválida.' })
    }
    const targetId = mediaId || showId
    const id = `rating-${profileId}-${targetId}`
    if (mediaId) {
      database.prepare(`
        INSERT INTO ratings (id, profile_id, media_item_id, score, review)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, media_item_id) DO UPDATE SET score = excluded.score, review = excluded.review, updated_at = CURRENT_TIMESTAMP
      `).run(id, profileId, mediaId, score, review || null)
    } else {
      database.prepare(`
        INSERT INTO ratings (id, profile_id, show_id, score, review)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, show_id) DO UPDATE SET score = excluded.score, review = excluded.review, updated_at = CURRENT_TIMESTAMP
      `).run(id, profileId, showId, score, review || null)
    }
    return send(response, 200, { score, review })
  }

  if (requestUrl.pathname === '/api/profiles') {
    try {
      database.exec('ALTER TABLE profiles ADD COLUMN tour_completed INTEGER NOT NULL DEFAULT 0')
    } catch {
      // column already exists
    }
    if (request.method === 'POST') {
      let body
      try {
        body = await readJson(request)
      } catch {
        return send(response, 400, { error: 'JSON inválido.' })
      }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const avatarKey = typeof body.avatarKey === 'string' ? body.avatarKey.trim() : ''
      const generatedId = slugify(name)
      if (!generatedId) return send(response, 400, { error: 'Nome inválido.' })
      const id = typeof body.id === 'string' && body.id ? body.id : `profile-${generatedId}`

      if (!name || !avatarKey) return send(response, 400, { error: 'Nome e avatar são obrigatórios.' })

      const isKids = body.isKids ? 1 : 0
      const rawPassword = typeof body.password === 'string' ? body.password.trim() : ''
      const clearPassword = Boolean(body.clearPassword)
      const existingProfile = database.prepare('SELECT id, passcode_hash FROM profiles WHERE id = ?').get(id)
      if (existingProfile?.passcode_hash) {
        const cookieHeader = String(request.headers.cookie || '')
        const sessionMatch = cookieHeader.match(/(?:^|;\s*)sc_profile_session=([^;]+)/)
        const sessionProfileId = sessionMatch ? decodeURIComponent(sessionMatch[1]) : ''
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword.trim() : ''
        const currentMatches =
          currentPassword &&
          hashProfilePasscode(id, currentPassword).length === existingProfile.passcode_hash.length &&
          timingSafeEqual(
            Buffer.from(hashProfilePasscode(id, currentPassword)),
            Buffer.from(existingProfile.passcode_hash),
          )
        if (sessionProfileId !== id && !currentMatches) {
          return send(response, 403, { error: 'Apenas o dono deste perfil pode editar ou remover a senha.' })
        }
      }
      if (clearPassword) {
        database.prepare(`
          INSERT INTO profiles (id, name, avatar_key, is_kids, passcode_hash)
          VALUES (?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            avatar_key = excluded.avatar_key,
            is_kids = excluded.is_kids,
            passcode_hash = NULL
        `).run(id, name, avatarKey, isKids)
      } else {
        const nextHash = rawPassword ? hashProfilePasscode(id, rawPassword) : null
        database.prepare(`
          INSERT INTO profiles (id, name, avatar_key, is_kids, passcode_hash)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            avatar_key = excluded.avatar_key,
            is_kids = excluded.is_kids,
            passcode_hash = COALESCE(excluded.passcode_hash, profiles.passcode_hash)
        `).run(id, name, avatarKey, isKids, nextHash)
      }

      const saved = database.prepare(`
        SELECT p.id, p.name, p.avatar_key AS avatarKey, p.is_kids AS isKids, p.is_admin AS isAdmin,
          (p.passcode_hash IS NOT NULL AND p.passcode_hash != '') AS hasPassword,
          (SELECT COUNT(*) FROM watch_progress wp WHERE wp.profile_id = p.id AND wp.watched = 1) AS watchedCount
        FROM profiles p
        WHERE p.id = ?
      `).get(id)
      return send(response, 200, {
        ...saved,
        isAdmin: Boolean(saved?.isAdmin),
        isKids: Boolean(saved?.isKids),
        hasPassword: Boolean(saved?.hasPassword),
        watchedCount: Number(saved?.watchedCount || 0),
      })
    }

    const profiles = database.prepare(`
      SELECT p.id, p.name, p.avatar_key AS avatarKey, p.is_kids AS isKids, p.is_admin AS isAdmin,
        COALESCE(p.tour_completed, 0) AS tourCompleted,
        (p.passcode_hash IS NOT NULL AND p.passcode_hash != '') AS hasPassword,
        (SELECT COUNT(*) FROM watch_progress wp WHERE wp.profile_id = p.id AND wp.watched = 1) AS watchedCount
      FROM profiles p
      ORDER BY p.created_at
    `).all().map((row) => ({
      ...row,
      isAdmin: Boolean(row.isAdmin),
      isKids: Boolean(row.isKids),
      hasPassword: Boolean(row.hasPassword),
      tourCompleted: Boolean(row.tourCompleted),
      watchedCount: Number(row.watchedCount || 0),
    }))

    return send(response, 200, profiles)
  }

  const tourProfileMatch = requestUrl.pathname.match(/^\/api\/profiles\/([^/]+)\/tour$/)
  if (tourProfileMatch && request.method === 'POST') {
    try {
      database.exec('ALTER TABLE profiles ADD COLUMN tour_completed INTEGER NOT NULL DEFAULT 0')
    } catch {
      // column already exists
    }
    const profileId = decodeURIComponent(tourProfileMatch[1])
    database.prepare('UPDATE profiles SET tour_completed = 1 WHERE id = ?').run(profileId)
    return send(response, 200, { ok: true, profileId })
  }

  const unlockProfileMatch = requestUrl.pathname.match(/^\/api\/profiles\/([^/]+)\/unlock$/)
  if (unlockProfileMatch && request.method === 'POST') {
    if (isAuthRateLimited(request)) {
      return send(response, 429, { error: 'Muitas tentativas incorretas. Aguarde 1 minuto.' })
    }
    const profileId = decodeURIComponent(unlockProfileMatch[1])
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const row = database.prepare('SELECT id, passcode_hash FROM profiles WHERE id = ?').get(profileId)
    if (!row) return send(response, 404, { error: 'Perfil não encontrado.' })
    if (!row.passcode_hash) return send(response, 200, { unlocked: true })
    const submitted = typeof body.password === 'string' ? body.password.trim() : ''
    if (!submitted) return send(response, 401, { error: 'Informe a senha do perfil.' })
    const candidate = hashProfilePasscode(profileId, submitted)
    if (
      candidate.length !== row.passcode_hash.length ||
      !timingSafeEqual(Buffer.from(candidate), Buffer.from(row.passcode_hash))
    ) {
      recordAuthFailure(request)
      return send(response, 401, { error: 'Senha do perfil incorreta.' })
    }
    clearAuthFailures(request)
    return send(response, 200, { unlocked: true })
  }

  const deleteProfileMatch = requestUrl.pathname.match(/^\/api\/profiles\/([^/]+)$/)
  if (deleteProfileMatch && request.method === 'DELETE') {
    const profileId = decodeURIComponent(deleteProfileMatch[1])
    const targetRow = database.prepare('SELECT id, is_admin FROM profiles WHERE id = ?').get(profileId)
    if (!targetRow) return send(response, 404, { error: 'Perfil não encontrado.' })
    if (targetRow.is_admin) {
      return send(response, 403, { error: 'O perfil administrador principal não pode ser excluído.' })
    }
    const total = database.prepare('SELECT COUNT(*) AS count FROM profiles').get()?.count ?? 0
    if (total <= 1) {
      return send(response, 400, { error: 'Não é possível excluir o único perfil restante.' })
    }
    database.prepare('DELETE FROM watch_progress WHERE profile_id = ?').run(profileId)
    database.prepare('DELETE FROM ratings WHERE profile_id = ?').run(profileId)
    database.prepare('DELETE FROM watchlist WHERE profile_id = ?').run(profileId)
    database.prepare('DELETE FROM profiles WHERE id = ?').run(profileId)
    return send(response, 200, { deleted: true, id: profileId })
  }

  if (requestUrl.pathname === '/api/addons' && request.method === 'GET') {
    return send(response, 200, listStremioAddons(database))
  }

  if (requestUrl.pathname === '/api/addons' && request.method === 'POST') {
    if (!requireAdmin(request, response)) return
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const manifestUrl = typeof body.manifestUrl === 'string' ? body.manifestUrl.trim() : ''
    if (!manifestUrl) {
      return send(response, 400, { error: 'Informe a URL do manifest.json do addon.' })
    }
    try {
      const installed = await installStremioAddon(database, manifestUrl)
      return send(response, 201, installed)
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao instalar addon.' })
    }
  }

  if (requestUrl.pathname === '/api/addons/search' && request.method === 'GET') {
    const q = requestUrl.searchParams.get('q') || ''
    if (!q.trim()) return send(response, 200, { metas: [] })
    try {
      const metas = await searchAddonFallback(q)
      return send(response, 200, { metas })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha na busca.' })
    }
  }

  if (requestUrl.pathname === '/api/addons/fallback-meta' && request.method === 'GET') {
    const type = requestUrl.searchParams.get('type') || 'movie'
    const id = requestUrl.searchParams.get('id') || ''
    if (!id.trim()) return send(response, 400, { error: 'Parâmetro id é obrigatório.' })
    try {
      const meta = await fetchFallbackMeta(type, id, database)
      if (!meta) return send(response, 404, { error: 'Metadado não encontrado.' })
      return send(response, 200, { meta })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao carregar metadados.' })
    }
  }

  if (requestUrl.pathname === '/api/addons/streams' && request.method === 'GET') {
    const type = requestUrl.searchParams.get('type') || 'movie'
    const id = requestUrl.searchParams.get('id') || ''
    const addonId = requestUrl.searchParams.get('addonId') || undefined
    if (!id.trim()) return send(response, 400, { error: 'Parâmetro id é obrigatório.' })
    try {
      const streams = await queryAddonStreams(database, { type, id, addonId })
      return send(response, 200, { streams })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao buscar streams.' })
    }
  }

  if (requestUrl.pathname === '/api/addons/subtitles' && request.method === 'GET') {
    const type = requestUrl.searchParams.get('type') || 'movie'
    const id = requestUrl.searchParams.get('id') || ''
    if (!id.trim()) return send(response, 400, { error: 'Parâmetro id é obrigatório.' })
    try {
      const subtitles = await queryAddonSubtitles(database, { type, id })
      return send(response, 200, { subtitles })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao buscar legendas.' })
    }
  }

  if (requestUrl.pathname === '/api/android/version' && request.method === 'GET') {
    return send(response, 200, {
      versionCode: 10000,
      versionName: '1.0.0',
      apkUrl: '/api/android/apk',
    })
  }

  if ((requestUrl.pathname === '/SavanoCine.apk' || requestUrl.pathname === '/api/android/apk') && (request.method === 'GET' || request.method === 'HEAD')) {
    const apkCandidates = [
      path.resolve(root, '..', '..', 'SavanoCine.apk'),
      path.resolve(root, '..', 'android', 'release', 'savano-cine-1.0.0-arm64-v8a.apk'),
      path.resolve(root, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
      path.resolve(root, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    ]
    const apkPath = apkCandidates.find((candidate) => existsSync(candidate))
    if (!apkPath) {
      return send(response, 404, { error: 'APK ainda não compilado.' })
    }
    const stat = statSync(apkPath)
    response.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="SavanoCine.apk"',
    })
    if (request.method === 'HEAD') return response.end()
    return createReadStream(apkPath).pipe(response)
  }

  if (requestUrl.pathname === '/api/network-info' && request.method === 'GET') {
    const interfaces = networkInterfaces()
    const lanIps = []
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
          lanIps.push(entry.address)
        }
      }
    }
    const tunnelFile = path.resolve(root, '..', 'data', 'tunnel-url.txt')
    const tunnelUrl =
      process.env.CINE_PUBLIC_URL?.trim() ||
      (existsSync(tunnelFile) ? readFileSync(tunnelFile, 'utf8').trim() : '')
    return send(response, 200, {
      apiPort: port,
      host,
      lanIps,
      urls: lanIps.map((ip) => `http://${ip}:${port}`),
      tunnelUrl,
    })
  }

  if (requestUrl.pathname === '/api/addons/subtitle-proxy' && request.method === 'GET') {
    const target = requestUrl.searchParams.get('url') || ''
    const isDownload = requestUrl.searchParams.get('download') === '1'
    const rawFilename = (requestUrl.searchParams.get('filename') || 'legenda.srt').replace(/[^a-zA-Z0-9._-]/g, '_')
    let parsed
    try {
      parsed = new URL(target)
    } catch {
      return send(response, 400, { error: 'URL de legenda inválida.' })
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isPrivateHostname(parsed.hostname)) {
      return send(response, 400, { error: 'Host ou protocolo inválido para legenda.' })
    }
    try {
      const upstream = await fetchSafeWithRedirects(parsed.toString(), { signal: AbortSignal.timeout(8000) })
      if (!upstream.ok) return send(response, 502, { error: 'Falha ao baixar legenda externa.' })
      const raw = await upstream.text()
      if (isDownload) {
        const ext = raw.trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt'
        const safeName = rawFilename.endsWith('.srt') || rawFilename.endsWith('.vtt') ? rawFilename : `${rawFilename}.${ext}`
        response.writeHead(200, {
          'Content-Type': ext === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}"`,
        })
        return response.end(raw)
      }
      const vtt = raw.trimStart().startsWith('WEBVTT')
        ? raw
        : `WEBVTT\n\n${raw.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
      response.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      })
      return response.end(vtt)
    } catch {
      return send(response, 502, { error: 'Erro ao buscar legenda externa.' })
    }
  }

  if (requestUrl.pathname === '/api/addons/http-proxy' && request.method === 'GET') {
    const target = requestUrl.searchParams.get('url') || ''
    const headersParam = requestUrl.searchParams.get('headers') || ''
    let parsed
    try {
      parsed = new URL(target)
    } catch {
      return send(response, 400, { error: 'URL inválida para proxy.' })
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || isPrivateHostname(parsed.hostname)) {
      return send(response, 400, { error: 'Host ou protocolo inválido para proxy.' })
    }
    const reqHeaders = {}
    if (headersParam) {
      try {
        const extra = JSON.parse(headersParam)
        for (const [k, v] of Object.entries(extra || {})) {
          if (/^(referer|user-agent|origin|accept)$/i.test(k) && typeof v === 'string') {
            reqHeaders[k] = v
          }
        }
      } catch {
        // ignore invalid headers json
      }
    }
    if (request.headers.range) reqHeaders.Range = String(request.headers.range)
    const ac = new AbortController()
    request.on('close', () => ac.abort())
    try {
      const upstream = await fetchSafeWithRedirects(parsed.toString(), { headers: reqHeaders, signal: ac.signal })
      const ct = upstream.headers.get('content-type') || 'application/octet-stream'
      if (ct.includes('mpegurl') || parsed.pathname.toLowerCase().endsWith('.m3u8')) {
        const text = await upstream.text()
        const base = new URL(upstream.url || parsed.toString())
        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) return line
            try {
              const abs = new URL(trimmed, base).toString()
              return `/api/addons/http-proxy?url=${encodeURIComponent(abs)}${headersParam ? `&headers=${encodeURIComponent(headersParam)}` : ''}`
            } catch {
              return line
            }
          })
          .join('\n')
        response.writeHead(upstream.status, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        return response.end(rewritten)
      }
      const outHeaders = {
        'Content-Type': ct,
        'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
        'Cache-Control': 'no-store',
      }
      const cl = upstream.headers.get('content-length')
      const cr = upstream.headers.get('content-range')
      if (cl) outHeaders['Content-Length'] = cl
      if (cr) outHeaders['Content-Range'] = cr
      response.writeHead(upstream.status, outHeaders)
      if (!upstream.body) return response.end()
      await pipeline(Readable.fromWeb(upstream.body), response).catch(() => undefined)
      return
    } catch {
      if (!response.headersSent) {
        return send(response, 502, { error: 'Falha ao carregar stream HTTP via proxy.' })
      }
      return
    }
  }

  if (requestUrl.pathname === '/api/addons/http-transcode' && request.method === 'GET') {
    const target = requestUrl.searchParams.get('url') || ''
    const headersParam = requestUrl.searchParams.get('headers') || ''
    let parsed
    try {
      parsed = new URL(target)
    } catch {
      return send(response, 400, { error: 'URL inválida para transcode.' })
    }
    try {
      await assertSafeExternalUrl(parsed.toString())
    } catch {
      return send(response, 400, { error: 'Host ou protocolo inválido para transcode.' })
    }
    const headerLines = []
    if (headersParam) {
      try {
        const extra = JSON.parse(headersParam)
        for (const [k, v] of Object.entries(extra || {})) {
          if (/^(referer|user-agent|origin|accept)$/i.test(k) && typeof v === 'string') {
            headerLines.push(`${k}: ${v.replace(/[\r\n]/g, '')}`)
          }
        }
      } catch {
        // ignore
      }
    }
    const ffArgs = ['-hide_banner', '-loglevel', 'error']
    if (headerLines.length > 0) {
      ffArgs.push('-headers', `${headerLines.join('\r\n')}\r\n`)
    }
    ffArgs.push(
      '-probesize',
      '500000',
      '-analyzeduration',
      '1000000',
      '-i',
      parsed.toString(),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    )
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' })
    const ff = spawn('ffmpeg', ffArgs, { windowsHide: true })
    ff.stdout.pipe(response)
    request.on('close', () => {
      if (!ff.killed) ff.kill('SIGTERM')
    })
    ff.on('error', () => {
      if (!response.headersSent) send(response, 500, { error: 'Falha ao transcodificar stream HTTP.' })
    })
    return
  }

  if (requestUrl.pathname === '/api/addons/torrent-stream' && request.method === 'GET') {
    const infoHash = requestUrl.searchParams.get('infoHash') || ''
    const fileIdxRaw = requestUrl.searchParams.get('fileIdx')
    const fileIdx = fileIdxRaw !== null && fileIdxRaw !== '' ? Number(fileIdxRaw) : null
    const audioStream = requestUrl.searchParams.get('audioStream') || null
    const startSec = Number(requestUrl.searchParams.get('start') || 0)
    if (!isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'infoHash inválido.' })
    }
    try {
      await serveTorrentStream(request, response, {
        infoHash,
        fileIdx: Number.isInteger(fileIdx) ? fileIdx : null,
        audioStream,
        startSec,
      })
      return
    } catch (error) {
      if (!response.headersSent) {
        return send(response, 502, {
          error: error instanceof Error ? error.message : 'Falha ao iniciar stream torrent.',
        })
      }
      return
    }
  }

  if (requestUrl.pathname === '/api/addons/torrent-info' && request.method === 'GET') {
    const infoHash = requestUrl.searchParams.get('infoHash') || ''
    const fileIdxRaw = requestUrl.searchParams.get('fileIdx')
    const fileIdx = fileIdxRaw !== null && fileIdxRaw !== '' ? Number(fileIdxRaw) : null
    if (!isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'infoHash inválido.' })
    }
    try {
      const info = await probeTorrentInfo(infoHash, Number.isInteger(fileIdx) ? fileIdx : null)
      return send(response, 200, info || { duration: 0, audio: [], subtitles: [] })
    } catch {
      return send(response, 200, { duration: 0, audio: [], subtitles: [] })
    }
  }

  if (requestUrl.pathname === '/api/addons/torrent-status' && request.method === 'GET') {
    const infoHash = requestUrl.searchParams.get('infoHash') || ''
    if (!isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'infoHash inválido.' })
    }
    const status = await getTorrentStatus(infoHash)
    return send(response, 200, status)
  }

  if (requestUrl.pathname === '/api/addons/torrent-prepare' && request.method === 'POST') {
    const body = await readJson(request).catch(() => null)
    const infoHash = String(body?.infoHash || '')
    const fileIdx = Number.isInteger(body?.fileIdx) ? body.fileIdx : null
    if (!isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'infoHash inválido.' })
    }
    try {
      const prepared = await prepareTorrentStream(infoHash, fileIdx)
      return send(response, 200, prepared)
    } catch (error) {
      return send(response, 502, {
        error: error instanceof Error ? error.message : 'Torrent sem peers disponíveis.',
      })
    }
  }

  const deleteTorrentMatch = requestUrl.pathname.match(/^\/api\/addons\/torrent-stream\/([^/]+)$/)
  if (deleteTorrentMatch && request.method === 'DELETE') {
    const infoHash = decodeURIComponent(deleteTorrentMatch[1])
    if (!isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'infoHash inválido.' })
    }
    const stopped = await stopTorrentStream(infoHash)
    return send(response, 200, { stopped, infoHash })
  }

  if (await handleAdminRoutes({ request, response, requestUrl, root, port, database, send })) {
    return
  }

  if (await handleTelemetryRoutes({ request, response, requestUrl, database, readBody: readJson, send })) {
    return
  }

  if (await handleSocialRoutes({ request, response, requestUrl, database, readBody: readJson, send })) {
    return
  }

  if (await handleRealtimeRoutes({ request, response, requestUrl, readBody: readJson, send })) {
    return
  }

  if (requestUrl.pathname === '/api/addons/progress') {
    if (request.method === 'GET') {
      const profileId = requestUrl.searchParams.get('profileId') || 'profile-admin'
      const rows = database
        .prepare('SELECT media_key AS mediaKey, title, poster, position_sec AS positionSec, duration_sec AS durationSec, updated_at AS updatedAt FROM stremio_progress WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 30')
        .all(profileId)
        .map((row) => {
          const epMatch = String(row.title || '').match(/T(\d+):E(\d+)/i)
          return {
            ...row,
            contentKey: row.mediaKey,
            type: epMatch ? 'series' : 'movie',
            season: epMatch ? Number(epMatch[1]) : null,
            episode: epMatch ? Number(epMatch[2]) : null,
          }
        })
      return send(response, 200, rows)
    }
    if (request.method === 'POST') {
      let body
      try {
        body = await readJson(request)
      } catch {
        return send(response, 400, { error: 'JSON inválido.' })
      }
      const profileId = typeof body.profileId === 'string' && body.profileId.trim() ? body.profileId.trim() : 'profile-admin'
      const mediaKey =
        typeof body.mediaKey === 'string' && body.mediaKey.trim()
          ? body.mediaKey.trim()
          : typeof body.contentKey === 'string'
            ? body.contentKey.trim()
            : ''
      if (!mediaKey) return send(response, 400, { error: 'mediaKey obrigatório.' })
      const poster = typeof body.poster === 'string' ? body.poster.trim() : null
      database.prepare(`
        INSERT INTO stremio_progress (profile_id, media_key, title, poster, position_sec, duration_sec, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(profile_id, media_key) DO UPDATE SET
          title = excluded.title,
          poster = COALESCE(excluded.poster, stremio_progress.poster),
          position_sec = excluded.position_sec,
          duration_sec = excluded.duration_sec,
          updated_at = CURRENT_TIMESTAMP
      `).run(profileId, mediaKey, String(body.title || ''), poster, Number(body.positionSec) || 0, Number(body.durationSec) || 0)
      return send(response, 200, { saved: true })
    }
    if (request.method === 'DELETE') {
      const profileId = requestUrl.searchParams.get('profileId') || 'profile-admin'
      const mediaKey = requestUrl.searchParams.get('mediaKey') || ''
      if (!mediaKey) return send(response, 400, { error: 'mediaKey obrigatório.' })
      const info = database
        .prepare('DELETE FROM stremio_progress WHERE profile_id = ? AND media_key = ?')
        .run(profileId, mediaKey)
      return send(response, 200, { deleted: info.changes > 0 })
    }
  }

  if (requestUrl.pathname === '/api/addons/downloads' && request.method === 'GET') {
    return send(response, 200, Array.from(LOCAL_ADDON_DOWNLOADS.values()))
  }

  if (requestUrl.pathname === '/api/addons/downloads' && request.method === 'DELETE') {
    let cleared = 0
    for (const [id, entry] of LOCAL_ADDON_DOWNLOADS.entries()) {
      if (entry.status === 'completed' || entry.status === 'error' || entry.status === 'qbittorrent') {
        LOCAL_ADDON_DOWNLOADS.delete(id)
        cleared += 1
      }
    }
    return send(response, 200, { cleared })
  }

  if ((requestUrl.pathname === '/api/addons/download-local' || requestUrl.pathname === '/api/downloads/add') && request.method === 'POST') {
    if (!requireAdmin(request, response)) return
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Download'
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const infoHash = typeof body.infoHash === 'string' ? body.infoHash.trim() : ''
    if (!url && !isValidInfoHash(infoHash)) {
      return send(response, 400, { error: 'Informe uma URL HTTP ou infoHash válido.' })
    }

    const sources = database.prepare('SELECT id, name, root_path AS rootPath, status FROM media_sources ORDER BY id ASC').all()
    const onlineRoot =
      sources.find((s) => s.status === 'online' && existsSync(s.rootPath))?.rootPath ||
      sources.find((s) => existsSync(s.rootPath))?.rootPath ||
      'D:\\Filmes'

    const safeFolder = title.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Media'
    const targetDir = path.join(onlineRoot, 'Downloads', safeFolder)
    mkdirSync(targetDir, { recursive: true })

    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const record = {
      id: downloadId,
      title,
      targetDir,
      mode: infoHash ? 'torrent' : 'http',
      status: 'starting',
      progress: 0,
      message: 'Iniciando download...',
    }
    LOCAL_ADDON_DOWNLOADS.set(downloadId, record)

    if (infoHash) {
      const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(safeFolder)}`
      try {
        const qbForm = new URLSearchParams({ urls: magnet, savepath: targetDir })
        const qbRes = await fetch('http://127.0.0.1:8080/api/v2/torrents/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: qbForm.toString(),
          signal: AbortSignal.timeout(1500),
        })
        if (qbRes.ok) {
          record.status = 'qbittorrent'
          record.message = `Enviado para o qBittorrent em ${targetDir}`
          return send(response, 202, record)
        }
      } catch {
        // qBittorrent WebUI not active on 8080; fallback to built-in WebTorrent
      }
      void (async () => {
        try {
          const { default: WebTorrent } = await import('webtorrent')
          const client = new WebTorrent()
          record.status = 'downloading'
          record.message = 'Conectando aos peers...'
          client.add(magnet, { path: targetDir }, (torrent) => {
            torrent.on('download', () => {
              record.progress = Math.round(torrent.progress * 100)
              record.message = `${record.progress}% · ${torrent.numPeers} peer(s)`
            })
            torrent.on('done', () => {
              record.status = 'completed'
              record.progress = 100
              record.message = `Concluído em ${targetDir}`
              client.destroy()
              spawn(process.execPath, [path.join(root, 'scan-media.mjs'), onlineRoot], {
                cwd: path.resolve(root, '..'),
                stdio: 'ignore',
                detached: true,
              }).unref()
            })
          })
        } catch {
          record.status = 'error'
          record.message = 'Falha ao baixar torrent localmente.'
        }
      })()
      return send(response, 202, record)
    }

    let parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch {
      return send(response, 400, { error: 'URL inválida.' })
    }
    if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || isPrivateHostname(parsedUrl.hostname)) {
      return send(response, 400, { error: 'Host ou protocolo inválido.' })
    }
    void (async () => {
      try {
        record.status = 'downloading'
        const res = await fetch(parsedUrl.toString(), { signal: AbortSignal.timeout(120000) })
        if (!res.ok || !res.body) {
          record.status = 'error'
          record.message = `HTTP ${res.status}`
          return
        }
        const ext = path.extname(parsedUrl.pathname) || '.mp4'
        const destFile = path.join(targetDir, `${safeFolder}${ext}`)
        await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile))
        record.status = 'completed'
        record.progress = 100
        record.message = `Salvo em ${destFile}`
        spawn(process.execPath, [path.join(root, 'scan-media.mjs'), onlineRoot], {
          cwd: path.resolve(root, '..'),
          stdio: 'ignore',
          detached: true,
        }).unref()
      } catch {
        record.status = 'error'
        record.message = 'Erro ao baixar arquivo HTTP.'
      }
    })()
    return send(response, 202, record)
  }

  const addonCatalogMatch = requestUrl.pathname.match(/^\/api\/addons\/([^/]+)\/catalog$/)
  if (addonCatalogMatch && request.method === 'GET') {
    const addonId = decodeURIComponent(addonCatalogMatch[1])
    const type = requestUrl.searchParams.get('type') || ''
    const catalogId = requestUrl.searchParams.get('catalogId') || ''
    const search = requestUrl.searchParams.get('search') || ''
    const skipRaw = Number(requestUrl.searchParams.get('skip') || 0)
    const skip = Number.isInteger(skipRaw) && skipRaw > 0 ? skipRaw : 0
    const cacheKey = `${addonId}::${type}::${catalogId}::${skip}`
    if (!search) {
      const cached = ADDON_CATALOG_CACHE.get(cacheKey)
      if (cached && Date.now() - cached.savedAt < ADDON_CATALOG_CACHE_TTL_MS) {
        return send(response, 200, cached.result)
      }
    }
    try {
      const result = await fetchAddonCatalog(database, addonId, { type, catalogId, search, skip })
      if (!result) return send(response, 404, { error: 'Addon não encontrado.' })
      if (!search) {
        ADDON_CATALOG_CACHE.set(cacheKey, { savedAt: Date.now(), result })
        if (ADDON_CATALOG_CACHE.size > 100) {
          const oldest = ADDON_CATALOG_CACHE.keys().next().value
          if (oldest) ADDON_CATALOG_CACHE.delete(oldest)
        }
      }
      return send(response, 200, result)
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao carregar catálogo.' })
    }
  }

  const addonMetaMatch = requestUrl.pathname.match(/^\/api\/addons\/([^/]+)\/meta$/)
  if (addonMetaMatch && request.method === 'GET') {
    const addonId = decodeURIComponent(addonMetaMatch[1])
    const type = requestUrl.searchParams.get('type') || 'movie'
    const metaId = requestUrl.searchParams.get('id') || ''
    try {
      const meta = await fetchAddonMeta(database, addonId, { type, metaId })
      if (!meta) return send(response, 404, { error: 'Metadado não encontrado no addon.' })
      return send(response, 200, { meta })
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : 'Falha ao carregar metadados.' })
    }
  }

  const addonIdMatch = requestUrl.pathname.match(/^\/api\/addons\/([^/]+)$/)
  if (addonIdMatch && request.method === 'PATCH') {
    if (!requireAdmin(request, response)) return
    const addonId = decodeURIComponent(addonIdMatch[1])
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const updated = setStremioAddonEnabled(database, addonId, Boolean(body.enabled))
    if (!updated) return send(response, 404, { error: 'Addon não encontrado.' })
    return send(response, 200, updated)
  }

  if (addonIdMatch && request.method === 'DELETE') {
    if (!requireAdmin(request, response)) return
    const addonId = decodeURIComponent(addonIdMatch[1])
    const deleted = deleteStremioAddon(database, addonId)
    if (!deleted) return send(response, 404, { error: 'Addon não encontrado.' })
    return send(response, 200, { deleted: true, id: addonId })
  }

  if (requestUrl.pathname === '/api/library') {
    const payload = await buildLibrary(requestUrl.searchParams.get('profileId'))
    const json = JSON.stringify(payload)
    const etag = `"${createHash('sha1').update(json).digest('hex').slice(0, 16)}"`
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' })
      return response.end()
    }
    response.setHeader('ETag', etag)
    response.setHeader('Cache-Control', 'private, no-cache')
    return send(response, 200, payload)
  }

  if (requestUrl.pathname === '/api/review' && request.method === 'GET') {
    const items = database.prepare(`
      SELECT m.id, m.title, m.kind, m.classification_reason AS reason,
        m.relative_path AS relativePath, s.name AS sourceName, s.root_path AS sourcePath
      FROM media_items m
      JOIN media_sources s ON s.id = m.source_id
      WHERE m.classification_status = 'review' AND m.deleted_at IS NULL
      ORDER BY s.name, m.relative_path COLLATE NOCASE
      LIMIT 500
    `).all()
    return send(response, 200, items)
  }

  if (requestUrl.pathname === '/api/review' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const id = typeof body.id === 'string' ? body.id : ''
    const action = typeof body.action === 'string' ? body.action : ''
    const current = database.prepare('SELECT id FROM media_items WHERE id = ? AND classification_status = ?').get(id, 'review')
    if (!current) return send(response, 404, { error: 'Item de revisão não encontrado.' })

    if (action === 'ignore') {
      database.prepare('UPDATE media_items SET classification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('ignored', id)
      return send(response, 200, { status: 'ignored' })
    }

    if (action === 'correct_movie' || action === 'approve_other') {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const kind = action === 'correct_movie' ? 'movie' : 'other'
      if (!title) return send(response, 400, { error: 'Título obrigatório.' })
      database.prepare(`
        UPDATE media_items
        SET title = ?, kind = ?, classification_status = 'approved', classification_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title, kind, id)
      return send(response, 200, { status: 'approved', action, title, kind })
    }

    return send(response, 400, { error: 'Ação de revisão inválida. Escolha corrigir como filme, aprovar como especial/outro ou ignorar.' })
  }

  const reviewActionMatch = requestUrl.pathname.match(/^\/api\/review\/([^/]+)\/(approve-movie|set-other|ignore)$/)
  if (reviewActionMatch && request.method === 'POST') {
    const id = decodeURIComponent(reviewActionMatch[1])
    const action = reviewActionMatch[2]
    const current = database.prepare('SELECT id, title FROM media_items WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!current) return send(response, 404, { error: 'Item de revisão não encontrado.' })

    if (action === 'ignore') {
      database.prepare("UPDATE media_items SET classification_status = 'ignored', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
      return send(response, 200, { status: 'ignored', id })
    }

    const kind = action === 'approve-movie' ? 'movie' : 'other'
    database.prepare(`
      UPDATE media_items
      SET kind = ?, classification_status = 'approved', classification_reason = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(kind, id)
    return send(response, 200, { status: 'approved', id, kind })
  }

  if (requestUrl.pathname === '/api/review/bulk' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && id) : []
    const action = typeof body.action === 'string' ? body.action : ''
    if (!ids.length || !['approve-movie', 'set-other', 'ignore'].includes(action)) {
      return send(response, 400, { error: 'Parâmetros inválidos para revisão em lote.' })
    }
    const updateIgnore = database.prepare("UPDATE media_items SET classification_status = 'ignored', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    const updateKind = database.prepare("UPDATE media_items SET kind = ?, classification_status = 'approved', classification_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    for (const id of ids) {
      if (action === 'ignore') updateIgnore.run(id)
      else updateKind.run(action === 'approve-movie' ? 'movie' : 'other', id)
    }
    return send(response, 200, { status: 'ok', count: ids.length, action })
  }

  if (requestUrl.pathname === '/api/catalog/history' && request.method === 'GET') {
    const archived = database.prepare(`
      SELECT m.id, m.title, m.kind, m.deleted_at AS deletedAt,
        m.relative_path AS relativePath, s.name AS sourceName
      FROM media_items m
      JOIN media_sources s ON s.id = m.source_id
      WHERE m.deleted_at IS NOT NULL
      ORDER BY m.deleted_at DESC
      LIMIT 500
    `).all()
    const titleChanges = database.prepare(`
      SELECT h.id, h.media_item_id AS mediaItemId, h.old_title AS oldTitle,
        h.new_title AS newTitle, h.reason, h.created_at AS createdAt,
        m.title AS currentTitle, m.deleted_at AS deletedAt,
        m.relative_path AS relativePath, s.name AS sourceName
      FROM media_item_title_history h
      JOIN media_items m ON m.id = h.media_item_id
      JOIN media_sources s ON s.id = m.source_id
      ORDER BY h.created_at DESC
      LIMIT 500
    `).all()
    return send(response, 200, { archived, titleChanges })
  }

  const restoreMatch = requestUrl.pathname.match(/^\/api\/catalog\/([^/]+)\/restore$/)
  if (restoreMatch && request.method === 'POST') {
    const result = database.prepare(`
      UPDATE media_items SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NOT NULL
    `).run(restoreMatch[1])
    if (!result.changes) return send(response, 404, { error: 'Item arquivado não encontrado.' })
    return send(response, 200, { status: 'restored' })
  }

  const titleRestoreMatch = requestUrl.pathname.match(/^\/api\/catalog\/title-history\/([^/]+)\/restore$/)
  if (titleRestoreMatch && request.method === 'POST') {
    const history = database.prepare(`
      SELECT h.id, h.media_item_id AS mediaItemId, h.old_title AS oldTitle,
        m.title AS currentTitle
      FROM media_item_title_history h
      JOIN media_items m ON m.id = h.media_item_id
      WHERE h.id = ?
    `).get(titleRestoreMatch[1])
    if (!history) return send(response, 404, { error: 'Alteração de título não encontrada.' })
    if (history.currentTitle !== history.oldTitle) {
      database.prepare(`
        INSERT INTO media_item_title_history (id, media_item_id, old_title, new_title, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(`title-restore-${history.id}-${Date.now()}`, history.mediaItemId, history.currentTitle, history.oldTitle, 'restauração manual do título')
      database.prepare('UPDATE media_items SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(history.oldTitle, history.mediaItemId)
    }
    return send(response, 200, { status: 'restored', title: history.oldTitle })
  }

  const archiveMatch = requestUrl.pathname.match(/^\/api\/catalog\/([^/]+)\/archive$/)
  if (archiveMatch && request.method === 'POST') {
    database.prepare('UPDATE media_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(archiveMatch[1])
    return send(response, 200, { status: 'archived' })
  }

  const editCatalogMatch = requestUrl.pathname.match(/^\/api\/catalog\/([^/]+)$/)
  if (editCatalogMatch && request.method === 'PATCH') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const targetId = decodeURIComponent(editCatalogMatch[1])
    const movie = database.prepare('SELECT id, title, year, overview, tags_json FROM media_items WHERE id = ? AND deleted_at IS NULL').get(targetId)
    if (movie) {
      const nextTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : movie.title
      const nextYear = body.year === null || body.year === '' ? null : Number.isInteger(Number(body.year)) ? Number(body.year) : movie.year
      const nextOverview = typeof body.overview === 'string' ? body.overview.trim() : movie.overview
      const nextTags = Array.isArray(body.tags)
        ? JSON.stringify(body.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()))
        : movie.tags_json

      if (nextTitle !== movie.title) {
        database.prepare(`
          INSERT INTO media_item_title_history (id, media_item_id, old_title, new_title, reason)
          VALUES (?, ?, ?, ?, ?)
        `).run(`title-edit-${movie.id}-${Date.now()}`, movie.id, movie.title, nextTitle, 'edição manual na interface')
      }
      database.prepare(`
        UPDATE media_items
        SET title = ?, year = ?, overview = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextTitle, nextYear, nextOverview || null, nextTags, movie.id)
      return send(response, 200, { status: 'updated', id: movie.id, title: nextTitle })
    }

    const show = database.prepare('SELECT id, title, year, overview FROM shows WHERE id = ?').get(targetId)
    if (show) {
      const nextTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : show.title
      const nextYear = body.year === null || body.year === '' ? null : Number.isInteger(Number(body.year)) ? Number(body.year) : show.year
      const nextOverview = typeof body.overview === 'string' ? body.overview.trim() : show.overview
      database.prepare('UPDATE shows SET title = ?, year = ?, overview = ? WHERE id = ?').run(nextTitle, nextYear, nextOverview || null, show.id)
      return send(response, 200, { status: 'updated', id: show.id, title: nextTitle })
    }

    return send(response, 404, { error: 'Item do catálogo não encontrado.' })
  }

  const mediaMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)$/)
  if (mediaMatch) {
    return streamMedia(mediaMatch[1], request, response)
  }

  const transcodeMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/transcode$/)
  if (transcodeMatch && request.method === 'GET') {
    return transcodeMedia(transcodeMatch[1], request, response)
  }

  const streamInfoMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/streams$/)
  if (streamInfoMatch && request.method === 'GET') {
    return analyzeMediaStreams(streamInfoMatch[1], response)
  }

  const thumbnailMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/thumbnail$/)
  if (thumbnailMatch && request.method === 'GET') {
    return serveMediaThumbnail(thumbnailMatch[1], requestUrl.searchParams.get('t'), response)
  }

  const subtitleListMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/subtitles$/)
  if (subtitleListMatch && request.method === 'GET') {
    return send(response, 200, findSubtitleTracks(subtitleListMatch[1]))
  }

  const embeddedSubtitleMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/subtitles\/embedded\/(\d+)$/)
  if (embeddedSubtitleMatch && request.method === 'GET') {
    return streamEmbeddedSubtitle(embeddedSubtitleMatch[1], Number(embeddedSubtitleMatch[2]), request, response)
  }

  const subtitleSearchMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/subtitles\/search$/)
  if (subtitleSearchMatch && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    return searchOpenSubtitles(subtitleSearchMatch[1], body, response)
  }

  const subtitleDownloadMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/subtitles\/download$/)
  if (subtitleDownloadMatch && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    return downloadOpenSubtitle(subtitleDownloadMatch[1], body, response)
  }

  const subtitleMatch = requestUrl.pathname.match(/^\/api\/subtitle\/([^/]+)$/)
  if (subtitleMatch) {
    return streamSubtitle(subtitleMatch[1], response)
  }

  const artworkMatch = requestUrl.pathname.match(/^\/api\/artwork\/([^/]+)\/(poster|banner)$/)
  if (artworkMatch) {
    return streamArtwork('show', artworkMatch[1], artworkMatch[2], response)
  }

  const movieArtworkMatch = requestUrl.pathname.match(/^\/api\/artwork\/movie\/([^/]+)\/(poster|banner)$/)
  if (movieArtworkMatch) {
    return streamArtwork('movie', movieArtworkMatch[1], movieArtworkMatch[2], response)
  }

  if (requestUrl.pathname === '/api/watchlist/toggle' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const profileId = typeof body.profileId === 'string' && body.profileId ? body.profileId : 'profile-admin'
    const targetType = body.targetType === 'show' ? 'show' : 'movie'
    const targetId = typeof body.targetId === 'string' ? body.targetId : ''
    if (!targetId) return send(response, 400, { error: 'targetId obrigatório.' })
    const existing = database.prepare('SELECT 1 FROM watchlist WHERE profile_id = ? AND target_type = ? AND target_id = ?').get(profileId, targetType, targetId)
    if (existing) {
      database.prepare('DELETE FROM watchlist WHERE profile_id = ? AND target_type = ? AND target_id = ?').run(profileId, targetType, targetId)
      return send(response, 200, { inWatchlist: false })
    }
    database.prepare('INSERT INTO watchlist (profile_id, target_type, target_id) VALUES (?, ?, ?)').run(profileId, targetType, targetId)
    return send(response, 200, { inWatchlist: true })
  }

  if (requestUrl.pathname === '/api/artwork/candidates' && request.method === 'GET') {
    return send(response, 200, listPendingArtworkCandidates())
  }

  if (requestUrl.pathname === '/api/artwork/fetch' && request.method === 'POST') {
    return send(response, 202, startArtworkFetch())
  }

  if (requestUrl.pathname === '/api/artwork/candidates/search' && request.method === 'POST') {
    let body
    try {
      body = await readJson(request)
    } catch {
      return send(response, 400, { error: 'JSON inválido.' })
    }
    const targetType = body.targetType === 'show' ? 'show' : body.targetType === 'movie' ? 'movie' : ''
    const targetId = typeof body.targetId === 'string' ? body.targetId : ''
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!targetType || !targetId) {
      return send(response, 400, { error: 'Alvo inválido para busca de arte.' })
    }
    const result = await searchArtworkCandidatesForTarget(targetType, targetId, query)
    if (result.error) return send(response, result.status || 404, { error: result.error })
    return send(response, 200, result)
  }

  const approveCandidateMatch = requestUrl.pathname.match(/^\/api\/artwork\/candidates\/([^/]+)\/approve$/)
  if (approveCandidateMatch && request.method === 'POST') {
    const result = await approveArtworkCandidate(decodeURIComponent(approveCandidateMatch[1]))
    if (result.error) return send(response, result.status || 400, { error: result.error })
    return send(response, 200, result)
  }

  const rejectCandidateMatch = requestUrl.pathname.match(/^\/api\/artwork\/candidates\/([^/]+)\/reject$/)
  if (rejectCandidateMatch && request.method === 'POST') {
    const result = rejectArtworkCandidate(decodeURIComponent(rejectCandidateMatch[1]))
    if (result.error) return send(response, result.status || 404, { error: result.error })
    return send(response, 200, result)
  }

  return send(response, 404, { error: 'Rota não encontrada' })
}

function refreshSourceStatuses(force = false) {
  const now = Date.now()
  if (!force && now - lastSourceRefreshAt < 600_000) {
    return
  }
  lastSourceRefreshAt = now
  const sources = database.prepare(`
    SELECT id, name, root_path, root_relative_path, volume_id, volume_label, removable
    FROM media_sources
  `).all()
  const update = database.prepare(`
    UPDATE media_sources
    SET root_path = ?, root_relative_path = ?, volume_id = ?, name = ?, volume_label = ?, removable = ?,
      status = ?, last_scan_at = CASE WHEN ? = 'online' THEN CURRENT_TIMESTAMP ELSE last_scan_at END
    WHERE id = ?
  `)

  for (const source of sources) {
    const sourceWithRelativePath = {
      ...source,
      root_relative_path: source.root_relative_path || getRootRelativePath(source.root_path),
    }

    const mounted = findMountedSource(sourceWithRelativePath)
    if (mounted && existsSync(mounted.rootPath)) {
      const label = mounted.volumeLabel || source.volume_label || path.basename(mounted.rootPath)
      update.run(
        mounted.rootPath,
        sourceWithRelativePath.root_relative_path,
        mounted.volumeId,
        `${label} (${mounted.driveLetter}:)`,
        mounted.volumeLabel,
        mounted.removable ? 1 : source.removable,
        'online',
        'online',
        source.id,
      )
      continue
    }

    const rootExists = existsSync(source.root_path)
    const fallbackVolume = rootExists ? getVolumeInfoForPath(source.root_path) : null
    if (fallbackVolume) {
      update.run(
        source.root_path,
        fallbackVolume.rootRelativePath || sourceWithRelativePath.root_relative_path,
        fallbackVolume.volumeId,
        `${fallbackVolume.volumeLabel || path.basename(source.root_path)} (${fallbackVolume.driveLetter}:)`,
        fallbackVolume.volumeLabel,
        fallbackVolume.removable ? 1 : source.removable,
        'online',
        'online',
        source.id,
      )
    } else if (rootExists) {
      update.run(
        source.root_path,
        sourceWithRelativePath.root_relative_path,
        source.volume_id,
        source.name,
        source.volume_label,
        source.removable,
        'online',
        'online',
        source.id,
      )
    } else {
      update.run(
        source.root_path,
        sourceWithRelativePath.root_relative_path,
        source.volume_id,
        source.name,
        source.volume_label,
        source.removable,
        'offline',
        'offline',
        source.id,
      )
    }
  }

}

function refreshStatus() {
  const { process: _process, ...status } = catalogRefresh
  return status
}

function startCatalogRefresh(sources) {
  catalogRefresh.state = 'running'
  catalogRefresh.startedAt = new Date().toISOString()
  catalogRefresh.finishedAt = null
  catalogRefresh.sourceIds = sources.map((source) => source.id)
  catalogRefresh.results = []
  catalogRefresh.error = null
  void runCatalogRefresh(sources)
}

async function runCatalogRefresh(sources) {
  try {
    for (const source of sources) {
      const adapter = getAdapterForSource(source.rootPath)
      if (adapter.kind === 'self_hosted') {
        const synced = await adapter.syncToDatabase(database, source.id, source.rootPath)
        catalogRefresh.results.push({
          sourceId: source.id,
          status: 'ok',
          message: `${synced} itens remotos sincronizados`,
        })
        continue
      }
      const result = await runImporter(source)
      catalogRefresh.results.push(result)
    }
    reconcileMisclassifiedEpisodes()
    sanitizeExistingTitles()
    startArtworkFetch()
    catalogRefresh.state = 'succeeded'
  } catch (error) {
    catalogRefresh.state = 'failed'
    catalogRefresh.error = error instanceof Error ? error.message : String(error)
  } finally {
    catalogRefresh.finishedAt = new Date().toISOString()
    catalogRefresh.process = null
  }
}

function runImporter(source) {
  return new Promise((resolve, reject) => {
    const importer = spawn(process.execPath, [
      path.resolve(root, 'import-catalog.mjs'),
      source.rootPath,
    ], {
      cwd: path.resolve(root, '..'),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    catalogRefresh.process = importer
    let stdout = ''
    let stderr = ''
    importer.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    importer.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    importer.once('error', (error) => reject(error))
    importer.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Importador terminou com código ${code}.`))
        return
      }
      resolve({
        sourceId: source.id,
        status: 'succeeded',
        message: stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'Fonte atualizada.',
      })
    })
  })
}

function ensureColumn(table, column, definition) {
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error
  }
}

function detectRuntime(environmentVariable, commandName) {
  const configuredPath = process.env[environmentVariable]?.trim()
  if (configuredPath) {
    return isExecutableFile(configuredPath)
      ? { available: true, source: 'environment', reason: 'configured-path' }
      : { available: false, source: 'environment', reason: 'configured-path-not-found' }
  }

  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', [commandName], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0 && result.stdout?.split(/\r?\n/).some((candidate) => isExecutableFile(candidate.trim()))) {
      return { available: true, source: 'path', reason: 'found-on-path' }
    }
  } else {
    const result = spawnSync(commandName, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    if (result.status === 0) return { available: true, source: 'path', reason: 'found-on-path' }
  }

  return { available: false, source: 'none', reason: 'not-found' }
}

function isExecutableFile(candidatePath) {
  try {
    return Boolean(candidatePath) && statSync(candidatePath).isFile()
  } catch {
    return false
  }
}

function getRuntimeExecutable(environmentVariable, commandName) {
  return process.env[environmentVariable]?.trim() || commandName
}

const thumbnailCache = new Map()

async function serveMediaThumbnail(mediaId, rawSeconds, response) {
  if (typeof mediaId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(mediaId)) {
    return send(response, 400, { error: 'mediaId inválido.' })
  }
  const parsedSeconds = rawSeconds === null || rawSeconds === '' ? 90 : Number(rawSeconds)
  if (!Number.isFinite(parsedSeconds) || parsedSeconds < 0) {
    return send(response, 400, { error: 'Parâmetro t inválido.' })
  }
  const bucket = Math.floor(parsedSeconds / 5) * 5
  const cacheKey = `${mediaId}:${bucket}`
  const cached = thumbnailCache.get(cacheKey)
  if (cached) {
    response.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': cached.length,
      'Cache-Control': 'public, max-age=86400',
    })
    return response.end(cached)
  }
  const thumbDir = path.resolve(root, '..', 'data', 'thumbnails')
  const thumbFile = path.join(thumbDir, `${mediaId}-${bucket}.jpg`)
  try {
    const diskCached = await readFile(thumbFile)
    if (diskCached.length > 0) {
      thumbnailCache.set(cacheKey, diskCached)
      response.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': diskCached.length,
        'Cache-Control': 'public, max-age=86400',
      })
      return response.end(diskCached)
    }
  } catch {
    // Not cached on disk yet
  }

  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ? AND m.deleted_at IS NULL
  `).get(mediaId)
  if (!media) return send(response, 404, { error: 'Mídia não encontrada.' })

  const adapter = getAdapterForSource(media.rootPath)
  if (adapter.kind === 'self_hosted') {
    return send(response, 404, { error: 'Miniatura indisponível para stream remoto.' })
  }

  const filePath = path.resolve(media.rootPath, media.relativePath)
  const rootPath = path.resolve(media.rootPath)
  if (filePath === rootPath || !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return send(response, 400, { error: 'Caminho de mídia inválido.' })
  }
  try {
    if (!statSync(filePath).isFile()) return send(response, 404, { error: 'Arquivo indisponível.' })
  } catch {
    return send(response, 404, { error: 'Arquivo indisponível.' })
  }

  const runtime = detectRuntime('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  if (!runtime.available) {
    return send(response, 404, { available: false, reason: 'ffmpeg-not-found' })
  }

  const executable = getRuntimeExecutable('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  const chunks = []
  const child = spawn(
    executable,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(bucket),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=240:-1',
      '-q:v',
      '6',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      'pipe:1',
    ],
    { windowsHide: true },
  )

  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }, 5000)

  child.stdout.on('data', (chunk) => chunks.push(chunk))
  child.once('close', (code) => {
    clearTimeout(timer)
    if (code !== 0 || chunks.length === 0) {
      if (!response.writableEnded) send(response, 404, { error: 'Miniatura indisponível.' })
      return
    }
    const buffer = Buffer.concat(chunks)
    if (thumbnailCache.size >= 200) {
      const oldestKey = thumbnailCache.keys().next().value
      if (oldestKey) thumbnailCache.delete(oldestKey)
    }
    thumbnailCache.set(cacheKey, buffer)
    mkdir(thumbDir, { recursive: true })
      .then(() => writeFile(thumbFile, buffer))
      .catch(() => undefined)
    if (!response.writableEnded) {
      response.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=86400',
      })
      response.end(buffer)
    }
  })
  child.once('error', () => {
    clearTimeout(timer)
    if (!response.writableEnded) send(response, 404, { error: 'Falha ao gerar miniatura.' })
  })
}

async function transcodeMedia(mediaId, request, response) {
  if (typeof mediaId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(mediaId)) {
    return send(response, 400, { error: 'mediaId inválido.' })
  }

  const format = requestUrlFormat(request)
  if (format !== 'mp4') {
    return send(response, 400, { error: 'Formato de transcodificação inválido.' })
  }

  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ? AND m.deleted_at IS NULL
  `).get(mediaId)
  if (!media) return send(response, 404, { error: 'Mídia não encontrada.' })

  const adapter = getAdapterForSource(media.rootPath)
  if (adapter.kind === 'self_hosted') {
    const remote = adapter.resolveStream(media.rootPath, media.relativePath)
    if (!remote?.url) return send(response, 400, { error: 'Stream remoto inválido.' })
    response.writeHead(302, { Location: remote.url })
    return response.end()
  }

  const filePath = path.resolve(media.rootPath, media.relativePath)
  const rootPath = path.resolve(media.rootPath)
  if (filePath === rootPath || !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return send(response, 400, { error: 'Caminho de mídia inválido.' })
  }

  try {
    if (!statSync(filePath).isFile()) return send(response, 404, { error: 'Arquivo indisponível.' })
  } catch {
    return send(response, 404, { error: 'Arquivo indisponível.' })
  }

  const runtime = detectRuntime('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  if (!runtime.available) {
    return send(response, 200, {
      available: false,
      reason: 'ffmpeg-not-found',
      format,
    })
  }

  const executable = getRuntimeExecutable('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  const audioStream = parseStreamIndex(requestUrl.searchParams.get('audioStream'))
  const subtitleStream = parseStreamIndex(requestUrl.searchParams.get('subtitleStream'))
  const startSeconds = Number(requestUrl.searchParams.get('start') || 0)
  const seekArgs = Number.isFinite(startSeconds) && startSeconds > 0 ? ['-ss', String(Math.floor(startSeconds))] : []
  const transcoder = spawn(executable, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    ...seekArgs,
    '-i', filePath,
    '-map', '0:v:0?',
    '-map', audioStream === null ? '0:a:0?' : `0:${audioStream}?`,
    ...(subtitleStream === null ? [] : ['-map', `0:${subtitleStream}?`, '-c:s', 'mov_text']),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ], {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  let headersSent = false
  const abort = () => {
    if (!transcoder.killed) transcoder.kill()
  }
  request.once('close', abort)
  response.once('close', abort)
  transcoder.once('error', () => {
    if (!headersSent) send(response, 503, { available: false, reason: 'ffmpeg-failed' })
    else response.destroy()
  })
  transcoder.once('close', (code) => {
    request.off('close', abort)
    response.off('close', abort)
    if (!headersSent && code !== 0) send(response, 503, { available: false, reason: 'ffmpeg-failed' })
  })

  response.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
    'Transfer-Encoding': 'chunked',
  })
  headersSent = true
  return transcoder.stdout.pipe(response)
}

function parseStreamIndex(value) {
  if (value === null || value === '') return null
  const index = Number(value)
  return Number.isInteger(index) && index >= 0 && index <= 999 ? index : null
}

function requestUrlFormat(request) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  return requestUrl.searchParams.get('format') || 'mp4'
}

async function analyzeMediaStreams(mediaId, response) {
  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(mediaId)

  if (!media) return send(response, 404, { error: 'Mídia não encontrada.' })

  const adapter = getAdapterForSource(media.rootPath)
  if (adapter.kind === 'self_hosted') {
    const remote = adapter.resolveStream(media.rootPath, media.relativePath)
    if (!remote?.url) return send(response, 400, { error: 'Stream remoto inválido.' })
    response.writeHead(302, { Location: remote.url })
    return response.end()
  }

  const filePath = path.resolve(media.rootPath, media.relativePath)
  const rootPath = path.resolve(media.rootPath)
  if (filePath === rootPath || !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return send(response, 400, { error: 'Caminho de mídia inválido.' })
  }

  const runtime = detectRuntime('CINE_FFPROBE_PATH', 'ffprobe.exe')
  if (!runtime.available) {
    return send(response, 200, {
      available: false,
      reason: 'ffprobe-not-found',
      audio: [],
      subtitles: [],
    })
  }

  try {
    const executable = process.env.CINE_FFPROBE_PATH?.trim() || 'ffprobe.exe'
    const { stdout } = await execFileAsync(executable, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name:stream_tags=language,title',
      '-of', 'json',
      filePath,
    ], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    })
    const parsed = JSON.parse(stdout)
    const streams = Array.isArray(parsed.streams) ? parsed.streams : []
    const mapTrack = (stream, index) => ({
      index: Number.isInteger(stream.index) ? stream.index : index,
      codec: typeof stream.codec_name === 'string' ? stream.codec_name : undefined,
      language: typeof stream.tags?.language === 'string' ? stream.tags.language : undefined,
      title: typeof stream.tags?.title === 'string' ? stream.tags.title : undefined,
    })
    const totalDuration = parsed.format?.duration ? Number(parsed.format.duration) : 0
    return send(response, 200, {
      available: true,
      duration: Number.isFinite(totalDuration) ? totalDuration : 0,
      audio: streams.filter((stream) => stream.codec_type === 'audio').map(mapTrack),
      subtitles: streams.filter((stream) => stream.codec_type === 'subtitle').map(mapTrack),
    })
  } catch {
    return send(response, 200, {
      available: false,
      reason: 'ffprobe-failed',
      audio: [],
      subtitles: [],
    })
  }
}

async function buildLibrary(profileId) {
  const transcodeExtensions = new Set(['rmvb', 'rm', 'avi', 'wmv', 'flv'])
  const subtitlesByMediaId = new Map()
  for (const row of database.prepare(`
    SELECT media_item_id AS mediaId, language, label, 1 AS available, provider
    FROM subtitle_tracks
    ORDER BY language, relative_path
  `).all()) {
    const list = subtitlesByMediaId.get(row.mediaId) || []
    list.push({ language: row.language, label: row.label, available: row.available, provider: row.provider })
    subtitlesByMediaId.set(row.mediaId, list)
  }
  const watchlistRows = database.prepare('SELECT target_type, target_id FROM watchlist WHERE profile_id = ?').all(profileId)
  const watchlistSet = new Set(watchlistRows.map((r) => `${r.target_type}:${r.target_id}`))
  const rawMovies = database.prepare(`
    SELECT m.id, m.title, m.year, m.overview, m.genres_json, m.extension, m.tags_json, m.relative_path AS relativePath,
      s.name AS sourceName, s.status AS sourceStatus,
      p.position_seconds AS progressPosition, p.duration_seconds AS progressDuration,
      p.watched AS progressWatched, p.updated_at AS progressUpdatedAt,
      (SELECT 1 FROM artwork a WHERE a.movie_id = m.id AND a.artwork_type = 'poster' AND a.source = 'local' LIMIT 1) AS hasPoster,
      (SELECT 1 FROM artwork a WHERE a.movie_id = m.id AND a.artwork_type = 'banner' AND a.source = 'local' LIMIT 1) AS hasBanner
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    LEFT JOIN watch_progress p ON p.media_item_id = m.id AND p.profile_id = ?
    WHERE m.kind = 'movie'
      AND m.classification_status IN ('auto', 'approved')
      AND m.deleted_at IS NULL
    ORDER BY m.title COLLATE NOCASE
    LIMIT 500
  `).all(profileId).map((item) => {
    const ext = String(item.extension || '').replace(/^\./, '').toLowerCase()
    const needsTranscode = transcodeExtensions.has(ext)
    const movieNearEnd = Boolean(item.progressDuration && (item.progressPosition / item.progressDuration >= 0.9 || item.progressDuration - item.progressPosition <= 120))
  const movieWatched = Boolean(item.progressWatched || movieNearEnd)
  return {
    id: item.id,
    title: item.title,
    kind: 'Filme',
    meta: item.extension.toUpperCase(),
    detail: item.relativePath,
    year: item.year,
    overview: item.overview,
    genres: JSON.parse(item.genres_json || item.tags_json || '[]'),
    posterClass: 'poster-default',
    sourceName: item.sourceName,
    sourceStatus: item.sourceStatus,
    needsTranscode,
    mediaUrl: `/api/media/${item.id}`,
    subtitleUrl: `/api/media/${item.id}/subtitles`,
    mediaId: item.id,
    inWatchlist: watchlistSet.has(`movie:${item.id}`),
    subtitles: subtitlesByMediaId.get(item.id) || [],
    tags: JSON.parse(item.tags_json || '[]'),
    artwork: { source: 'none', verified: false },
    ...(item.hasPoster || item.hasBanner ? {
      artwork: {
        source: 'local',
        ...(item.hasPoster ? { posterUrl: `/api/artwork/movie/${item.id}/poster` } : {}),
        bannerUrl: item.hasBanner ? `/api/artwork/movie/${item.id}/banner` : (item.hasPoster ? `/api/artwork/movie/${item.id}/poster` : undefined),
        verified: true,
      },
    } : {}),
    progress: movieWatched ? 100 : (item.progressDuration ? Math.round((item.progressPosition / item.progressDuration) * 100) : undefined),
    ...(!movieWatched && item.progressPosition > 0 ? {
      resume: {
        kind: 'movie',
        title: item.title,
        position: item.progressPosition,
        duration: item.progressDuration || undefined,
        updatedAt: item.progressUpdatedAt,
        mediaId: item.id,
        mediaUrl: `/api/media/${item.id}`,
        subtitleUrl: `/api/media/${item.id}/subtitles`,
        needsTranscode,
      },
    } : {}),
  }})

  const extractVersionLabel = (movie) => {
    const src = `${movie.detail || ''} ${movie.meta || ''}`
    const res = src.match(/\b(2160p|4k|1080p|720p|480p)\b/i)?.[1]?.toUpperCase() || ''
    const audio = /\bdual\b/i.test(src) ? 'Dual' : (/\bdublado\b/i.test(src) ? 'Dublado' : '')
    return [res, movie.meta, audio].filter(Boolean).join(' · ') || movie.meta
  }

  const versionScore = (movie) => {
    const src = `${movie.detail || ''} ${movie.meta || ''}`
    let score = 0
    if (movie.resume) score += 1000
    if (movie.artwork?.verified) score += 200
    if (/2160p|4k/i.test(src)) score += 40
    else if (/1080p/i.test(src)) score += 30
    else if (/720p/i.test(src)) score += 20
    if (/mkv/i.test(movie.meta)) score += 5
    return score
  }

  const groupedMovies = new Map()
  for (const movie of rawMovies) {
    const key = String(movie.title || '')
      .replace(/\b(?:2160p|1080p|720p|480p|4k|uhd|imax|bluray|blu-ray|web-dl|webrip|dublado|dual)\b/gi, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
    if (!key) continue
    const list = groupedMovies.get(key) || []
    list.push(movie)
    groupedMovies.set(key, list)
  }

  const items = []
  for (const group of groupedMovies.values()) {
    group.sort((a, b) => versionScore(b) - versionScore(a))
    const primary = { ...group[0] }
    if (group.length > 1) {
      primary.versions = group.map((entry) => ({
        mediaId: entry.id,
        label: extractVersionLabel(entry),
        mediaUrl: entry.mediaUrl,
        subtitleUrl: entry.subtitleUrl,
        meta: entry.meta,
        detail: entry.detail,
        needsTranscode: entry.needsTranscode,
      }))
    }
    items.push(primary)
  }

  const shows = database.prepare(`
    SELECT id, title, year, overview, genres_json
    FROM shows
    WHERE EXISTS (
      SELECT 1
      FROM seasons s
      JOIN episodes e ON e.season_id = s.id
      WHERE s.show_id = shows.id
    )
    ORDER BY title COLLATE NOCASE
  `).all()

  const showArtworks = await Promise.all(shows.map((show) => fetchShowArtwork(show.title)))

  for (const [index, show] of shows.entries()) {
    const seasons = database.prepare(`
      SELECT id, season_number AS number
      FROM seasons
      WHERE show_id = ?
      ORDER BY number
    `).all(show.id).map((season) => ({
      number: season.number,
      label: season.number === 0 ? 'Curtas' : `Temporada ${season.number.toString().padStart(2, '0')}`,
      episodes: database.prepare(`
        SELECT e.id, e.episode_number AS number, e.title, m.id AS mediaId, m.relative_path AS filename,
          m.extension, ms.name AS sourceName, ms.status AS sourceStatus,
          p.position_seconds AS progressPosition, p.duration_seconds AS progressDuration
        FROM episodes e
        JOIN media_items m ON m.id = e.media_item_id
        JOIN media_sources ms ON ms.id = m.source_id
        LEFT JOIN watch_progress p ON p.media_item_id = m.id AND p.profile_id = ?
        WHERE e.season_id = ? AND m.deleted_at IS NULL
        ORDER BY number
      `).all(profileId, season.id).map((episode) => {
        const ext = String(episode.extension || '').replace(/^\./, '').toLowerCase()
        const needsTranscode = transcodeExtensions.has(ext)
        const nearEnd = Boolean(episode.progressDuration && (episode.progressPosition / episode.progressDuration >= 0.9 || episode.progressDuration - episode.progressPosition <= 120))
        const epProgress = nearEnd
          ? 100
          : (episode.progressDuration ? Math.round((episode.progressPosition / episode.progressDuration) * 100) : undefined)
        const remainingMinutes =
          !nearEnd && episode.progressDuration && episode.progressPosition > 0 && episode.progressDuration > episode.progressPosition
            ? Math.max(1, Math.round((episode.progressDuration - episode.progressPosition) / 60))
            : null
        return {
          id: episode.id,
          season: season.number,
          number: episode.number,
          title: episode.title,
          filename: episode.filename,
          duration: episode.progressDuration ? `${Math.max(1, Math.round(episode.progressDuration / 60))} min` : '',
          subtitles: subtitlesByMediaId.get(episode.mediaId) || [],
          mediaUrl: `/api/media/${episode.mediaId}`,
          subtitleUrl: `/api/media/${episode.mediaId}/subtitles`,
          thumbnailUrl: episode.sourceStatus === 'online' ? `/api/media/${episode.mediaId}/thumbnail?t=90` : undefined,
          mediaId: episode.mediaId,
          needsTranscode,
          sourceName: episode.sourceName,
          sourceStatus: episode.sourceStatus,
          progress: epProgress,
          position: remainingMinutes ? `Restam ${remainingMinutes} min` : undefined,
        }
      }),
    }))

    const flatShowEpisodes = seasons.flatMap((s) => s.episodes)
    const episodeCount = flatShowEpisodes.length
    const onlineEpisode = flatShowEpisodes.find((ep) => ep.sourceStatus === 'online')
    const showSourceName = onlineEpisode?.sourceName ?? flatShowEpisodes[0]?.sourceName
    const showSourceStatus = onlineEpisode ? 'online' : (flatShowEpisodes[0]?.sourceStatus ?? 'online')
    let resumeEpisode = database.prepare(`
      SELECT e.episode_number AS number, e.title, s.season_number AS season,
        m.id AS mediaId, p.position_seconds AS position, p.duration_seconds AS duration,
        p.updated_at AS updatedAt
      FROM episodes e
      JOIN seasons s ON s.id = e.season_id
      JOIN media_items m ON m.id = e.media_item_id
      JOIN watch_progress p ON p.media_item_id = m.id
      WHERE s.show_id = ? AND p.profile_id = ? AND p.position_seconds > 0 AND p.watched = 0
        AND m.deleted_at IS NULL
      ORDER BY p.updated_at DESC
      LIMIT 1
    `).get(show.id, profileId)
    if (!resumeEpisode) {
      const lastWatched = database.prepare(`
        SELECT m.id AS mediaId, p.updated_at AS updatedAt
        FROM episodes e
        JOIN seasons s ON s.id = e.season_id
        JOIN media_items m ON m.id = e.media_item_id
        JOIN watch_progress p ON p.media_item_id = m.id
        WHERE s.show_id = ? AND p.profile_id = ? AND p.watched = 1 AND m.deleted_at IS NULL
        ORDER BY p.updated_at DESC
        LIMIT 1
      `).get(show.id, profileId)
      if (lastWatched) {
        const flatEpisodes = seasons.flatMap((s) => s.episodes)
        const idx = flatEpisodes.findIndex((ep) => ep.mediaId === lastWatched.mediaId)
        const nextEp = idx >= 0 && idx + 1 < flatEpisodes.length ? flatEpisodes[idx + 1] : null
        if (nextEp) {
          resumeEpisode = {
            number: nextEp.number,
            title: nextEp.title,
            season: nextEp.season,
            mediaId: nextEp.mediaId,
            position: 0,
            duration: undefined,
            updatedAt: lastWatched.updatedAt,
          }
        }
      }
    }
    const resumeEpObj = resumeEpisode ? flatShowEpisodes.find((ep) => ep.mediaId === resumeEpisode.mediaId) : undefined
    items.push({
      id: show.id,
      title: show.title,
      kind: 'Série',
      meta: `${seasons.length} temporadas`,
      detail: `${episodeCount} episódios catalogados`,
      year: show.year,
      overview: show.overview,
      genres: JSON.parse(show.genres_json || '[]'),
      posterClass: show.title.toLocaleLowerCase().includes('south park') ? 'poster-south-park' : 'poster-default',
      sourceName: showSourceName,
      sourceStatus: showSourceStatus,
      artwork: showArtworks[index].artwork,
      bannerUrl: showArtworks[index].bannerUrl,
      tags: showArtworks[index].tags,
      seasons,
      ...(resumeEpisode ? {
        resume: {
          kind: 'episode',
          title: resumeEpisode.title,
          showTitle: show.title,
          season: resumeEpisode.season,
          episode: resumeEpisode.number,
          position: resumeEpisode.position,
          duration: resumeEpisode.duration || undefined,
          updatedAt: resumeEpisode.updatedAt,
          mediaId: resumeEpisode.mediaId,
          mediaUrl: `/api/media/${resumeEpisode.mediaId}`,
          subtitleUrl: `/api/media/${resumeEpisode.mediaId}/subtitles`,
          needsTranscode: Boolean(resumeEpObj?.needsTranscode),
        },
      } : {}),
      inWatchlist: watchlistSet.has(`show:${show.id}`),
    })
  }

  async function fetchShowArtwork(title) {
    const showId = `show-${slugify(title)}`
    const localArt = database.prepare(`
      SELECT artwork_type AS type
      FROM artwork
      WHERE show_id = ? AND source = 'local'
    `).all(showId)
    const hasPoster = localArt.some((art) => art.type === 'poster')
    const hasBanner = localArt.some((art) => art.type === 'banner')
    const cached = SHOW_ARTWORK_CACHE.get(showId)
    if (cached && Date.now() - cached.savedAt < SHOW_ARTWORK_CACHE_TTL_MS) {
      return cached.value
    }
    try {
      const response = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`, {
        signal: AbortSignal.timeout(1800),
      })
      if (!response.ok) throw new Error(`TVMaze ${response.status}`)
      const show = await response.json()
      const posterUrl = show.image?.original || show.image?.medium
      const tags = ['Série']
      if (show.type === 'Animation') tags.push('Animação')
      for (const genre of show.genres || []) tags.push(genre)
      const value = {
        artwork: posterUrl || hasPoster
          ? { source: hasPoster ? 'local' : 'tvmaze', posterUrl: hasPoster ? `/api/artwork/${showId}/poster` : posterUrl, providerId: String(show.id), verified: true }
          : { source: 'none', verified: false },
        bannerUrl: hasBanner ? `/api/artwork/${showId}/banner` : posterUrl,
        tags,
      }
      SHOW_ARTWORK_CACHE.set(showId, { savedAt: Date.now(), value })
      return value
    } catch {
      const fallback = {
        artwork: hasPoster
          ? { source: 'local', posterUrl: `/api/artwork/${showId}/poster`, verified: true }
          : { source: 'none', verified: false },
        bannerUrl: hasBanner ? `/api/artwork/${showId}/banner` : undefined,
        tags: ['Série'],
      }
      SHOW_ARTWORK_CACHE.set(showId, { savedAt: Date.now(), value: fallback })
      return fallback
    }

    function slugify(value) {
      return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }
  }

  return items
}

function send(response, status, body) {
  const json = JSON.stringify(body)
  const acceptEncoding = String(response.req?.headers?.['accept-encoding'] || '')
  if (json.length >= 1024 && /\bgzip\b/i.test(acceptEncoding)) {
    const compressed = gzipSync(json)
    response.writeHead(status, {
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Content-Length': compressed.length,
    })
    response.end(compressed)
    return
  }
  response.writeHead(status)
  response.end(json)
}

function streamArtwork(ownerType, ownerId, artworkType, response) {
  const ownerColumn = ownerType === 'movie' ? 'movie_id' : 'show_id'
  const artwork = database.prepare(`
    SELECT local_path AS localPath
    FROM artwork
    WHERE ${ownerColumn} = ? AND artwork_type = ? AND source = 'local'
    LIMIT 1
  `).get(ownerId, artworkType)
  if (!artwork) return send(response, 404, { error: 'Arte não encontrada.' })

  const filePath = path.resolve(root, '..', artwork.localPath)
  try {
    const fileSize = statSync(filePath).size
    response.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    })
    return createReadStream(filePath).pipe(response)
  } catch {
    return send(response, 404, { error: 'Arquivo de arte indisponível.' })
  }
}

function findSubtitleTracks(mediaId) {
  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(mediaId)
  if (!media) return []
  const directory = path.dirname(path.resolve(media.rootPath, media.relativePath))
  return database.prepare(`
    SELECT language, label, relative_path AS name
    FROM subtitle_tracks
    WHERE media_item_id = ?
    ORDER BY language, relative_path
  `).all(mediaId)
    .filter((track) => {
      const filePath = path.resolve(directory, track.name)
      return path.basename(track.name) === track.name && filePath.startsWith(`${directory}${path.sep}`)
    })
    .map((track) => ({
      language: track.language,
      label: track.label,
      url: `/api/subtitle/${encodeURIComponent(Buffer.from(JSON.stringify({ mediaId, name: track.name })).toString('base64url'))}`,
    }))
}

function streamSubtitle(token, response) {
  let subtitle
  try {
    subtitle = JSON.parse(Buffer.from(decodeURIComponent(token), 'base64url').toString('utf8'))
  } catch {
    return send(response, 400, { error: 'Legenda inválida.' })
  }
  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(subtitle.mediaId)
  if (!media || typeof subtitle.name !== 'string' || path.basename(subtitle.name) !== subtitle.name) {
    return send(response, 400, { error: 'Legenda inválida.' })
  }
  const directory = path.dirname(path.resolve(media.rootPath, media.relativePath))
  const filePath = path.resolve(directory, subtitle.name)
  const registered = database.prepare(`
    SELECT 1
    FROM subtitle_tracks
    WHERE media_item_id = ? AND relative_path = ?
  `).get(subtitle.mediaId, subtitle.name)
  if (!registered || !/\.(srt|vtt)$/i.test(subtitle.name) || !filePath.startsWith(`${directory}${path.sep}`)) {
    return send(response, 400, { error: 'Legenda inválida.' })
  }
  try {
    const extension = path.extname(filePath).toLowerCase()
    const rawBuffer = readFileSync(filePath)
    const content = decodeSubtitleBuffer(rawBuffer)
    const body = extension === '.srt' ? srtToVtt(content) : content
    response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' })
    return response.end(body)
  } catch {
    return send(response, 404, { error: 'Legenda indisponível.' })
  }
}

function decodeSubtitleBuffer(buffer) {
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    decoded = new TextDecoder('windows-1252').decode(buffer)
  }
  return decoded.replace(/^\uFEFF/, '')
}

function srtToVtt(content) {
  return `WEBVTT\n\n${content.replace(/\r?\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

function resolveMediaFile(mediaId) {
  const media = database.prepare(`
    SELECT m.id, m.title, m.relative_path AS relativePath, m.extension, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ? AND m.deleted_at IS NULL
  `).get(mediaId)

  if (!media) return { error: 'Mídia não encontrada.', status: 404 }
  const rootPath = path.resolve(media.rootPath)
  const filePath = path.resolve(rootPath, media.relativePath)
  if (filePath === rootPath || !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return { error: 'Caminho de mídia inválido.', status: 400 }
  }
  return { media, filePath, rootPath }
}

function streamEmbeddedSubtitle(mediaId, streamIndex, request, response) {
  const resolved = resolveMediaFile(mediaId)
  if (resolved.error) return send(response, resolved.status, { error: resolved.error })
  if (!Number.isInteger(streamIndex) || streamIndex < 0) {
    return send(response, 400, { error: 'Índice de faixa de legenda inválido.' })
  }
  if (!existsSync(resolved.filePath)) {
    return send(response, 404, { error: 'Arquivo de mídia indisponível.' })
  }

  const runtime = detectRuntime('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  if (!runtime.available) {
    return send(response, 503, { error: 'FFmpeg indisponível para extrair legenda embutida.' })
  }

  const executable = process.env.CINE_FFMPEG_PATH?.trim() || 'ffmpeg.exe'
  const child = spawn(executable, [
    '-v', 'error',
    '-i', resolved.filePath,
    '-map', `0:${streamIndex}`,
    '-f', 'webvtt',
    'pipe:1',
  ], { windowsHide: true })

  let sentHeaders = false
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  request.on('close', () => {
    clearTimeout(killTimer)
    if (!child.killed) child.kill('SIGKILL')
  })

  child.stdout.on('data', (chunk) => {
    if (!sentHeaders) {
      sentHeaders = true
      response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' })
    }
    response.write(chunk)
  })

  child.on('error', () => {
    clearTimeout(killTimer)
    if (!sentHeaders) send(response, 500, { error: 'Falha ao executar FFmpeg para legenda embutida.' })
    else response.end()
  })

  child.on('close', (code) => {
    clearTimeout(killTimer)
    if (!sentHeaders) {
      if (code !== 0) return send(response, 422, { error: 'Não foi possível extrair esta faixa como legenda de texto.' })
      response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' })
    }
    response.end()
  })
}

async function searchOpenSubtitles(mediaId, body, response) {
  const resolved = resolveMediaFile(mediaId)
  if (resolved.error) return send(response, resolved.status, { error: resolved.error })

  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim()
  if (!apiKey) {
    return send(response, 200, {
      configured: false,
      provider: 'opensubtitles',
      results: [],
      message: 'Configure OPENSUBTITLES_API_KEY para buscar legendas no OpenSubtitles.',
    })
  }

  const query = typeof body?.query === 'string' && body.query.trim() ? body.query.trim() : resolved.media.title
  const languages = typeof body?.language === 'string' && body.language.trim() ? body.language.trim() : 'pt-br,pt,en'
  const userAgent = process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'SavanoCine v1.0'

  try {
    const searchUrl = `https://api.opensubtitles.com/api/v1/subtitles?query=${encodeURIComponent(query)}&languages=${encodeURIComponent(languages)}`
    const apiResponse = await fetch(searchUrl, {
      headers: {
        'Api-Key': apiKey,
        'User-Agent': userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!apiResponse.ok) {
      return send(response, 502, { error: `OpenSubtitles respondeu HTTP ${apiResponse.status}.` })
    }
    const payload = await apiResponse.json()
    const items = Array.isArray(payload.data) ? payload.data : []
    const results = items
      .map((entry) => {
        const attrs = entry.attributes || {}
        const firstFile = Array.isArray(attrs.files) ? attrs.files[0] : null
        if (!firstFile?.file_id) return null
        return {
          fileId: firstFile.file_id,
          language: attrs.language || 'und',
          release: attrs.release || firstFile.file_name || query,
          downloads: Number(attrs.download_count || 0),
          hearingImpaired: Boolean(attrs.hearing_impaired),
        }
      })
      .filter(Boolean)
      .slice(0, 12)

    return send(response, 200, {
      configured: true,
      provider: 'opensubtitles',
      results,
    })
  } catch {
    return send(response, 502, { error: 'Não foi possível consultar o OpenSubtitles.' })
  }
}

async function downloadOpenSubtitle(mediaId, body, response) {
  const resolved = resolveMediaFile(mediaId)
  if (resolved.error) return send(response, resolved.status, { error: resolved.error })

  const apiKey = process.env.OPENSUBTITLES_API_KEY?.trim()
  if (!apiKey) {
    return send(response, 400, { error: 'OPENSUBTITLES_API_KEY não configurada.' })
  }

  const fileId = Number(body?.fileId)
  const language = typeof body?.language === 'string' && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(body.language.trim())
    ? body.language.trim().toLowerCase()
    : 'und'
  const hearingImpaired = body?.hearingImpaired ? 1 : 0
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return send(response, 400, { error: 'Identificador de legenda inválido.' })
  }

  const userAgent = process.env.OPENSUBTITLES_USER_AGENT?.trim() || 'SavanoCine v1.0'
  try {
    const linkRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!linkRes.ok) {
      return send(response, 502, { error: `Falha ao solicitar download no OpenSubtitles (HTTP ${linkRes.status}).` })
    }
    const linkData = await linkRes.json()
    if (!linkData?.link || !/^https?:\/\//i.test(linkData.link)) {
      return send(response, 502, { error: 'Link de download inválido retornado pelo OpenSubtitles.' })
    }

    const fileRes = await fetch(linkData.link, { signal: AbortSignal.timeout(10_000) })
    if (!fileRes.ok) {
      return send(response, 502, { error: 'Não foi possível baixar o arquivo de legenda.' })
    }
    const content = await fileRes.text()

    const directory = path.dirname(resolved.filePath)
    const videoStem = path.basename(resolved.filePath, path.extname(resolved.filePath))
    const subtitleFilename = `${videoStem}.${language}.srt`
    const subtitlePath = path.resolve(directory, subtitleFilename)
    if (!subtitlePath.startsWith(`${directory}${path.sep}`)) {
      return send(response, 400, { error: 'Destino de legenda inválido.' })
    }
    await writeFile(subtitlePath, content, 'utf8')

    const trackId = `sub-${mediaId}-${subtitleFilename}`
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : `${language.toUpperCase()} (OpenSubtitles)`
    database.prepare(`
      INSERT INTO subtitle_tracks (id, media_item_id, language, label, provider, remote_id, relative_path, embedded, hearing_impaired)
      VALUES (?, ?, ?, ?, 'opensubtitles', ?, ?, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        language = excluded.language,
        label = excluded.label,
        provider = excluded.provider,
        remote_id = excluded.remote_id,
        hearing_impaired = excluded.hearing_impaired
    `).run(trackId, mediaId, language, label, String(fileId), subtitleFilename, hearingImpaired)

    return send(response, 200, {
      status: 'downloaded',
      tracks: findSubtitleTracks(mediaId),
    })
  } catch {
    return send(response, 502, { error: 'Erro ao baixar legenda do OpenSubtitles.' })
  }
}

function streamMedia(mediaId, request, response) {
  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, m.extension, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(mediaId)

  if (!media) return send(response, 404, { error: 'Mídia não encontrada.' })

  const adapter = getAdapterForSource(media.rootPath)
  if (adapter.kind === 'self_hosted') {
    const remote = adapter.resolveStream(media.rootPath, media.relativePath)
    if (!remote?.url) return send(response, 400, { error: 'Stream remoto inválido.' })
    response.writeHead(302, { Location: remote.url })
    return response.end()
  }

  const filePath = path.resolve(media.rootPath, media.relativePath)
  const rootPath = path.resolve(media.rootPath)
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return send(response, 400, { error: 'Caminho de mídia inválido.' })
  }

  let fileSize
  try {
    fileSize = statSync(filePath).size
  } catch {
    return send(response, 404, { error: 'Arquivo indisponível.' })
  }

  const contentType = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
  }[media.extension.toLowerCase()] || 'application/octet-stream'
  const range = request.headers.range

  if (!range) {
    response.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    })
    return createReadStream(filePath).pipe(response)
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range)
  if (!match) return send(response, 416, { error: 'Faixa inválida.' })
  const start = match[1] ? Number(match[1]) : Math.max(fileSize - Number(match[2]), 0)
  const end = match[2] ? Number(match[2]) : fileSize - 1
  if (start >= fileSize || start > end) return send(response, 416, { error: 'Faixa fora do arquivo.' })

  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  })
  return createReadStream(filePath, { start, end }).pipe(response)
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let content = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { content += chunk })
    request.on('end', () => {
      try {
        resolve(JSON.parse(content || '{}'))
      } catch {
        reject(new Error('JSON inválido'))
      }
    })
    request.on('error', reject)
  })
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function ensureArtworkCandidatesTable() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS artwork_candidates (
      id TEXT PRIMARY KEY,
      movie_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
      show_id TEXT REFERENCES shows(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      overview TEXT,
      poster_url TEXT,
      backdrop_url TEXT,
      language TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((movie_id IS NULL) != (show_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_artwork_candidates_status ON artwork_candidates(status);
  `)
}

function listPendingArtworkCandidates() {
  const rows = database.prepare(`
    SELECT c.id, c.movie_id AS movieId, c.show_id AS showId, c.provider, c.provider_id AS providerId,
      c.title, c.year, c.overview, c.poster_url AS posterUrl, c.backdrop_url AS backdropUrl, c.language,
      COALESCE(m.title, s.title) AS targetTitle,
      COALESCE(m.year, s.year) AS targetYear
    FROM artwork_candidates c
    LEFT JOIN media_items m ON m.id = c.movie_id AND m.deleted_at IS NULL
    LEFT JOIN shows s ON s.id = c.show_id
    WHERE c.status = 'pending'
      AND (c.movie_id IS NULL OR m.id IS NOT NULL)
      AND (c.show_id IS NULL OR s.id IS NOT NULL)
    ORDER BY targetTitle, c.created_at DESC
    LIMIT 300
  `).all()

  const groups = new Map()
  for (const row of rows) {
    const targetType = row.movieId ? 'movie' : 'show'
    const targetId = row.movieId || row.showId
    const key = `${targetType}:${targetId}`
    if (!groups.has(key)) {
      groups.set(key, {
        targetType,
        targetId,
        title: row.targetTitle,
        year: row.targetYear || undefined,
        candidates: [],
      })
    }
    groups.get(key).candidates.push({
      id: row.id,
      provider: row.provider,
      providerId: row.providerId,
      title: row.title,
      year: row.year || undefined,
      overview: row.overview || undefined,
      posterUrl: row.posterUrl || undefined,
      backdropUrl: row.backdropUrl || undefined,
      language: row.language || undefined,
    })
  }
  return [...groups.values()]
}

async function downloadCandidateImage(imageUrl, targetType, targetTitle, artworkType) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) return null
  const extension = contentType.includes('png') ? 'png' : 'jpg'
  const folder = targetType === 'show' ? 'shows' : 'movies'
  const directory = path.resolve(root, '..', 'data', 'artwork', folder)
  await mkdir(directory, { recursive: true })
  const filename = `${slugify(targetTitle) || targetType}-${artworkType}.${extension}`
  const relativePath = path.join('data', 'artwork', folder, filename)
  await writeFile(path.resolve(root, '..', relativePath), Buffer.from(await response.arrayBuffer()))
  return relativePath
}

async function approveArtworkCandidate(candidateId) {
  const candidate = database.prepare(`
    SELECT c.*, COALESCE(m.title, s.title) AS targetTitle
    FROM artwork_candidates c
    LEFT JOIN media_items m ON m.id = c.movie_id
    LEFT JOIN shows s ON s.id = c.show_id
    WHERE c.id = ?
  `).get(candidateId)

  if (!candidate || !candidate.targetTitle) {
    return { status: 404, error: 'Candidato de arte não encontrado.' }
  }

  const targetType = candidate.movie_id ? 'movie' : 'show'
  const targetId = candidate.movie_id || candidate.show_id

  if (candidate.poster_url) {
    const posterPath = await downloadCandidateImage(candidate.poster_url, targetType, candidate.targetTitle, 'poster')
    if (posterPath) {
      upsertArtworkRecord(targetType, targetId, 'poster', posterPath, candidate.poster_url, candidate.provider, candidate.provider_id)
    }
  }
  if (candidate.backdrop_url) {
    const bannerPath = await downloadCandidateImage(candidate.backdrop_url, targetType, candidate.targetTitle, 'banner')
    if (bannerPath) {
      upsertArtworkRecord(targetType, targetId, 'banner', bannerPath, candidate.backdrop_url, candidate.provider, candidate.provider_id)
    }
  }

  if (targetType === 'movie') {
    database.prepare(`
      UPDATE media_items
      SET year = COALESCE(year, ?),
          overview = COALESCE(NULLIF(?, ''), overview),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(candidate.year || null, candidate.overview || '', targetId)
    database.prepare(`UPDATE artwork_candidates SET status = 'rejected' WHERE movie_id = ? AND id != ? AND status = 'pending'`).run(targetId, candidateId)
  } else {
    database.prepare(`
      UPDATE shows
      SET year = COALESCE(year, ?),
          overview = COALESCE(NULLIF(?, ''), overview)
      WHERE id = ?
    `).run(candidate.year || null, candidate.overview || '', targetId)
    database.prepare(`UPDATE artwork_candidates SET status = 'rejected' WHERE show_id = ? AND id != ? AND status = 'pending'`).run(targetId, candidateId)
  }

  database.prepare(`UPDATE artwork_candidates SET status = 'approved' WHERE id = ?`).run(candidateId)
  return { status: 'approved', id: candidateId }
}

function upsertArtworkRecord(targetType, targetId, artworkType, localPath, remoteUrl, provider, providerId) {
  const artId = `art-${targetId}-${artworkType}`
  const movieId = targetType === 'movie' ? targetId : null
  const showId = targetType === 'show' ? targetId : null
  database.prepare(`
    INSERT INTO artwork (id, movie_id, show_id, local_path, remote_url, provider, provider_id, source, verified, artwork_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      local_path = excluded.local_path,
      remote_url = excluded.remote_url,
      provider = excluded.provider,
      provider_id = excluded.provider_id,
      source = excluded.source,
      verified = excluded.verified,
      artwork_type = excluded.artwork_type
  `).run(artId, movieId, showId, localPath, remoteUrl, provider, String(providerId), artworkType)
}

function rejectArtworkCandidate(candidateId) {
  const result = database.prepare(`UPDATE artwork_candidates SET status = 'rejected' WHERE id = ?`).run(candidateId)
  if (!result.changes) return { status: 404, error: 'Candidato de arte não encontrado.' }
  return { status: 'rejected', id: candidateId }
}

async function searchArtworkCandidatesForTarget(targetType, targetId, customQuery) {
  const target = targetType === 'movie'
    ? database.prepare('SELECT id, title FROM media_items WHERE id = ? AND deleted_at IS NULL').get(targetId)
    : database.prepare('SELECT id, title FROM shows WHERE id = ?').get(targetId)
  if (!target) return { status: 404, error: 'Item do catálogo não encontrado.' }

  const query = customQuery || target.title
  const insert = database.prepare(`
    INSERT INTO artwork_candidates (
      id, movie_id, show_id, provider, provider_id, title, year, overview, poster_url, backdrop_url, language, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      year = COALESCE(excluded.year, artwork_candidates.year),
      overview = COALESCE(excluded.overview, artwork_candidates.overview),
      poster_url = COALESCE(excluded.poster_url, artwork_candidates.poster_url),
      backdrop_url = COALESCE(excluded.backdrop_url, artwork_candidates.backdrop_url),
      language = COALESCE(excluded.language, artwork_candidates.language),
      status = 'pending'
  `)

  let added = 0
  if (targetType === 'show') {
    const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) })
    if (response.ok) {
      const results = (await response.json()) || []
      for (const entry of results.slice(0, 5)) {
        const show = entry?.show
        if (!show?.id) continue
        const posterUrl = show.image?.original || show.image?.medium || null
        insert.run(
          `cand-${targetId}-tvmaze-${show.id}`,
          null,
          targetId,
          'tvmaze',
          String(show.id),
          show.name || query,
          show.premiered ? Number(show.premiered.slice(0, 4)) : null,
          show.summary ? show.summary.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null,
          posterUrl,
          posterUrl,
          show.language || null,
        )
        added += 1
      }
    }
  } else {
    for (const language of ['pt', 'en']) {
      const api = `https://${language}.wikipedia.org/w/api.php`
      const search = await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`, { signal: AbortSignal.timeout(8000) })
      if (!search.ok) continue
      const pages = (await search.json()).query?.search || []
      for (const page of pages) {
        const details = await fetch(`${api}?action=query&prop=extracts|pageimages&piprop=original&exintro=1&explaintext=1&pageids=${page.pageid}&format=json&origin=*`, { signal: AbortSignal.timeout(8000) })
        if (!details.ok) continue
        const pageData = (await details.json()).query?.pages?.[page.pageid]
        const overview = pageData?.extract?.trim() || null
        const posterUrl = pageData?.original?.source || null
        if (!overview && !posterUrl) continue
        insert.run(
          `cand-${targetId}-wikipedia-${language}:${page.pageid}`,
          targetId,
          null,
          'wikipedia',
          `${language}:${page.pageid}`,
          page.title,
          null,
          overview,
          posterUrl,
          null,
          language,
        )
        added += 1
      }
    }
    const tmdbApiKey = process.env.TMDB_API_KEY?.trim()
    if (tmdbApiKey) {
      const search = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdbApiKey)}&query=${encodeURIComponent(query)}&include_adult=false&language=pt-BR`, { signal: AbortSignal.timeout(8000) })
      if (search.ok) {
        const results = (await search.json()).results || []
        for (const candidate of results.slice(0, 5)) {
          if (!candidate.id || (!candidate.poster_path && !candidate.backdrop_path && !candidate.overview)) continue
          insert.run(
            `cand-${targetId}-tmdb-${candidate.id}`,
            targetId,
            null,
            'tmdb',
            String(candidate.id),
            candidate.title || candidate.original_title || query,
            candidate.release_date ? Number(candidate.release_date.slice(0, 4)) : null,
            candidate.overview || null,
            candidate.poster_path ? `https://image.tmdb.org/t/p/w500${candidate.poster_path}` : null,
            candidate.backdrop_path ? `https://image.tmdb.org/t/p/w1280${candidate.backdrop_path}` : null,
            'pt-BR',
          )
          added += 1
        }
      }
    }
  }

  return { added, groups: listPendingArtworkCandidates() }
}

const errorLogDirectory = path.resolve(root, '..', 'data', 'logs')
const errorLogFile = path.join(errorLogDirectory, 'api-errors.log')

function logApiError(request, error) {
  const entry = {
    timestamp: new Date().toISOString(),
    method: request?.method || 'UNKNOWN',
    path: String(request?.url || '/').split('?')[0],
    message: error instanceof Error ? error.message : String(error),
  }
  console.error(`[API ERROR] ${entry.method} ${entry.path}: ${entry.message}`)
  try {
    mkdirSync(errorLogDirectory, { recursive: true })
    appendFileSync(errorLogFile, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Evita falha em cascata caso o diretório de log não esteja gravável
  }
}

function readRecentErrorLogs() {
  try {
    if (!existsSync(errorLogFile)) return []
    const lines = readFileSync(errorLogFile, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    return lines.slice(-50).reverse().map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function ensureWatchlistTable() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      profile_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (profile_id, target_type, target_id)
    )
  `)
}

function ignorePromotionalAds() {
  try {
    database.prepare(`
      UPDATE media_items
      SET kind = 'other',
          classification_status = 'ignored',
          classification_reason = 'promotional'
      WHERE (
        LOWER(title) LIKE '%1xbet%'
        OR LOWER(title) LIKE '%dinheiro livre%'
        OR LOWER(relative_path) LIKE '%1xbet%'
        OR LOWER(relative_path) LIKE '%dinheiro_livre%'
      )
        AND (kind != 'other' OR classification_status != 'ignored')
    `).run()
  } catch {
    // Mantém inicialização resiliente
  }
}

function reconcileMisclassifiedEpisodes() {
  try {
    const softDelete = database.prepare(`UPDATE media_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`)

    // Exclude repository/app files (e.g. cine-local\docs\media\demo.webm) if scanned from D:\Filmes
    database.prepare(`
      UPDATE media_items
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE deleted_at IS NULL
        AND (lower(relative_path) LIKE 'cine-local\\%' OR lower(relative_path) LIKE 'cine-local/%')
    `).run()

    // Remove promo/watermark clips shipped inside torrent folders from the catalog
    const promoRows = database.prepare(`
      SELECT id, relative_path AS relativePath, title
      FROM media_items
      WHERE deleted_at IS NULL
    `).all()
    const promoRe = /^(?:bludv(?:\.tv)?|comandotorrents(?:\.com)?|lapumia|torrentdosfilmes(?:\.to)?|lucas\s*firmo\s*uploader)(?:\.[a-z0-9]{2,4})?$/i
    const adClipRe = /(?:^|[\W_])(1xbet|dinheiro[_ ]livre)(?:[\W_]|$)/i
    for (const row of promoRows) {
      const basename = path.basename(String(row.relativePath || ''))
      const stem = path.basename(basename, path.extname(basename))
      if (promoRe.test(basename) || promoRe.test(stem) || promoRe.test(String(row.title || '').trim()) || adClipRe.test(basename)) {
        softDelete.run(row.id)
      }
    }

    // Auto-approve real movies that were falsely flagged as promotional solely due to release group tags
    database.prepare(`
      UPDATE media_items
      SET kind = 'movie', classification_status = 'approved', classification_reason = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE deleted_at IS NULL
        AND classification_status = 'review'
        AND classification_reason = 'promotional'
        AND lower(relative_path) NOT LIKE '%1xbet%'
        AND lower(relative_path) NOT LIKE '%promo%'
        AND lower(relative_path) NOT LIKE '%trailer%'
    `).run()

    // Ensure Corra! has Terror genre
    database.prepare(`
      UPDATE media_items
      SET genres_json = '["Terror","Suspense"]'
      WHERE deleted_at IS NULL AND lower(title) = 'corra!' AND (genres_json IS NULL OR genres_json = '[]' OR genres_json NOT LIKE '%Terror%')
    `).run()

    const upsertSeason = database.prepare(`
      INSERT INTO seasons (id, show_id, season_number)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    const upsertEpisode = database.prepare(`
      INSERT INTO episodes (id, season_id, media_item_id, episode_number, title)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `)
    const markEpisode = database.prepare(`UPDATE media_items SET kind = 'episode', classification_status = 'auto', classification_reason = NULL WHERE id = ?`)

    // Group "A Energia do Homem" (course modules) as a structured series so user doesn't review 21 lessons one-by-one
    const energiaRows = database.prepare(`
      SELECT id, title, relative_path AS relativePath
      FROM media_items
      WHERE deleted_at IS NULL
        AND lower(relative_path) LIKE '%a energia do homem%'
        AND kind != 'episode'
    `).all()
    if (energiaRows.length > 0) {
      const energiaShowId = 'show-a-energia-do-homem'
      database.prepare(`
        INSERT INTO shows (id, title, normalized_title, overview, genres_json)
        VALUES (?, 'A Energia do Homem', 'aenergiadohomem', 'Curso "A Energia do Homem" (Cátia Damasceno) organizado por módulos e aulas.', '["Documentário"]')
        ON CONFLICT(id) DO NOTHING
      `).run(energiaShowId)
      for (const row of energiaRows) {
        const modMatch = String(row.relativePath || '').match(/m[oó]dulo\s*(\d{1,2})/i)
        const base = path.basename(String(row.relativePath || ''), path.extname(String(row.relativePath || '')))
        const epMatch = base.match(/^(\d{1,3})/)
        const seasonNumber = modMatch ? Number(modMatch[1]) : 1
        const episodeNumber = epMatch ? Number(epMatch[1]) : 1
        const seasonId = `${energiaShowId}-season-${seasonNumber}`
        upsertSeason.run(seasonId, energiaShowId, seasonNumber)
        upsertEpisode.run(`${row.id}-episode`, seasonId, row.id, episodeNumber, `Aula ${episodeNumber}`)
        markEpisode.run(row.id)
      }
    }

    // Reclassify movies under "Marvel" folder falsely parsed as episodes (e.g. "5.1" audio -> S5E1)
    const marvelEps = database.prepare(`
      SELECT e.id AS episodeId, e.season_id AS seasonId, m.id AS mediaId
      FROM episodes e
      JOIN seasons s ON s.id = e.season_id
      JOIN shows sh ON sh.id = s.show_id
      JOIN media_items m ON m.id = e.media_item_id
      WHERE sh.id = 'show-marvel' OR lower(sh.title) = 'marvel'
    `).all()
    if (marvelEps.length > 0) {
      const delEp = database.prepare(`DELETE FROM episodes WHERE id = ?`)
      const markMovie = database.prepare(`
        UPDATE media_items
        SET kind = 'movie', classification_status = 'approved', classification_reason = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      for (const row of marvelEps) {
        delEp.run(row.episodeId)
        markMovie.run(row.mediaId)
      }
      database.prepare(`DELETE FROM seasons WHERE id NOT IN (SELECT DISTINCT season_id FROM episodes)`).run()
      database.prepare(`DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM seasons)`).run()
    }

    const southParkShow = database.prepare("SELECT id FROM shows WHERE lower(title) LIKE '%south park%' LIMIT 1").get()
    if (!southParkShow?.id) return
    const rows = database.prepare(`
      SELECT id, title, relative_path AS relativePath
      FROM media_items
      WHERE kind = 'movie'
        AND deleted_at IS NULL
        AND lower(relative_path) LIKE '%south park%'
    `).all()
    // Prune orphan show rows that have zero episodes
    database.prepare(`
      DELETE FROM artwork_candidates
      WHERE show_id IN (
        SELECT id FROM shows WHERE NOT EXISTS (
          SELECT 1 FROM seasons s JOIN episodes e ON e.season_id = s.id WHERE s.show_id = shows.id
        )
      )
    `).run()
    database.prepare(`
      DELETE FROM artwork
      WHERE show_id IN (
        SELECT id FROM shows WHERE NOT EXISTS (
          SELECT 1 FROM seasons s JOIN episodes e ON e.season_id = s.id WHERE s.show_id = shows.id
        )
      )
    `).run()
    database.prepare(`
      DELETE FROM shows
      WHERE NOT EXISTS (
        SELECT 1 FROM seasons s JOIN episodes e ON e.season_id = s.id WHERE s.show_id = shows.id
      )
    `).run()
    for (const row of rows) {
      let seasonNumber = null
      let episodeNumber = null
      const match = `${row.title} ${row.relativePath}`.match(/s(\d{1,2})\s*e(\d{1,2})/i)
      if (match) {
        seasonNumber = Number(match[1])
        episodeNumber = Number(match[2])
      } else {
        const folderMatch = String(row.relativePath || '').match(/south park[\\/](\d{1,2})[\\/]/i)
        if (folderMatch) {
          seasonNumber = Number(folderMatch[1])
          const existingCount = database.prepare(`
            SELECT COALESCE(MAX(e.episode_number), 0) AS maxEp
            FROM episodes e
            JOIN seasons s ON s.id = e.season_id
            WHERE s.show_id = ? AND s.season_number = ?
          `).get(southParkShow.id, seasonNumber)?.maxEp ?? 0
          episodeNumber = Number(existingCount) + 1
        }
      }
      if (!seasonNumber || !episodeNumber) continue
      const seasonId = `${southParkShow.id}-season-${seasonNumber}`
      upsertSeason.run(seasonId, southParkShow.id, seasonNumber)
      const epTitle = cleanTitle(String(row.title || '').replace(/^s\d{1,2}\s*e\d{1,2}\s*[-:]?\s*/i, '')) || row.title
      upsertEpisode.run(`${row.id}-episode`, seasonId, row.id, episodeNumber, epTitle)
      markEpisode.run(row.id)
    }
  } catch {
    // Mantém inicialização resiliente
  }
}

function sanitizeExistingTitles() {
  try {
    const movies = database.prepare('SELECT id, title FROM media_items WHERE deleted_at IS NULL').all()
    const updateMovie = database.prepare('UPDATE media_items SET title = ? WHERE id = ?')
    for (const row of movies) {
      const cleaned = cleanTitle(row.title)
      if (cleaned && cleaned !== row.title) {
        updateMovie.run(cleaned, row.id)
      }
    }

    const shows = database.prepare('SELECT id, title FROM shows').all()
    const updateShow = database.prepare('UPDATE shows SET title = ? WHERE id = ?')
    for (const row of shows) {
      const cleaned = cleanTitle(row.title)
      if (cleaned && cleaned !== row.title) {
        updateShow.run(cleaned, row.id)
      }
    }
  } catch {
    // Mantém inicialização resiliente
  }
}

function buildCatalogGaps() {
  const movies = database.prepare(`
    SELECT m.id, m.title, m.year, m.overview, m.genres_json AS genresJson, m.relative_path AS relativePath,
      (SELECT 1 FROM artwork a WHERE a.movie_id = m.id AND a.artwork_type = 'poster' AND a.source = 'local' LIMIT 1) AS hasPoster
    FROM media_items m
    WHERE m.kind = 'movie' AND m.classification_status IN ('auto', 'approved') AND m.deleted_at IS NULL
    ORDER BY m.title COLLATE NOCASE
  `).all()

  const reviewCount = database.prepare(`
    SELECT COUNT(*) AS count FROM media_items WHERE classification_status = 'review' AND deleted_at IS NULL
  `).get()?.count ?? 0

  const missingPoster = movies.filter((m) => !m.hasPoster).map((m) => ({
    id: m.id,
    title: m.title,
    year: m.year,
    relativePath: m.relativePath,
  }))
  const missingOverview = movies.filter((m) => !m.overview || m.overview.trim().length < 20).map((m) => ({
    id: m.id,
    title: m.title,
    year: m.year,
  }))
  const missingGenres = movies.filter((m) => {
    try {
      const parsed = JSON.parse(m.genresJson || '[]')
      return !Array.isArray(parsed) || parsed.length === 0
    } catch {
      return true
    }
  }).map((m) => ({ id: m.id, title: m.title }))

  const suspiciousRe = /wolverdon|andretpf|bludv|thepirate|comando|lapumia|yify|repack|1080p|720p|480p|dublado|dual|x264|x265|bluray|bdrip|web-?dl|webrip|\(\d{4}\)|\[|\]/i
  const suspiciousTitles = movies.filter((m) => suspiciousRe.test(m.title)).map((m) => ({
    id: m.id,
    title: m.title,
    relativePath: m.relativePath,
  }))

  const lines = [
    'Atualize o catálogo do Savano Cine (D:\\Filmes\\cine-local) para novos filmes/séries adicionados:',
    '1. Rode o scanner (`node scripts/scan-media.mjs`) e `reconcileMisclassifiedEpisodes()` + `sanitizeExistingTitles()`.',
    '2. Baixe capas, sinopses e gêneros faltantes (`node scripts/fetch-artwork.mjs`).',
    `Estado atual: ${movies.length} filmes, ${missingPoster.length} sem capa, ${missingOverview.length} sem sinopse, ${missingGenres.length} sem gênero, ${suspiciousTitles.length} título(s) suspeito(s), ${reviewCount} em revisão.`,
  ]
  if (missingPoster.length > 0) {
    lines.push(`Sem capa: ${missingPoster.slice(0, 15).map((m) => `"${m.title}"`).join(', ')}`)
  }
  if (suspiciousTitles.length > 0) {
    lines.push(`Títulos para limpar em scan-media.mjs: ${suspiciousTitles.slice(0, 15).map((m) => `"${m.title}"`).join(', ')}`)
  }
  if (missingOverview.length > 0) {
    lines.push(`Sem sinopse (${missingOverview.length}): ${missingOverview.slice(0, 10).map((m) => `"${m.title}"`).join(', ')}`)
  }

  return {
    totalMovies: movies.length,
    reviewCount,
    missingPoster,
    missingOverview,
    missingGenres,
    suspiciousTitles,
    generatedPrompt: lines.join('\n'),
  }
}

let artworkFetchRunning = false
function startArtworkFetch() {
  if (artworkFetchRunning) {
    return { status: 'running', message: 'Busca de capas já está em andamento.' }
  }
  artworkFetchRunning = true
  const child = spawn(process.execPath, [path.resolve(root, 'fetch-artwork.mjs')], {
    cwd: path.resolve(root, '..'),
    stdio: 'ignore',
    detached: false,
  })
  child.once('close', () => {
    artworkFetchRunning = false
  })
  child.once('error', () => {
    artworkFetchRunning = false
  })
  return { status: 'started', message: 'Busca de capas faltantes iniciada em segundo plano.' }
}
