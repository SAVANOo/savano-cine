import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { findMountedSource, getRootRelativePath, getVolumeInfoForPath } from './volume-info.mjs'

const port = Number(process.env.CINE_API_PORT || 4174)
const root = path.dirname(fileURLToPath(import.meta.url))
const databasePath = path.resolve(root, '..', 'data', 'catalog.db')

if (!existsSync(databasePath)) {
  console.error(`Catálogo não encontrado: ${databasePath}`)
  console.error('Execute primeiro: npm run import -- "E:\\Filmes"')
  process.exit(1)
}

const database = new DatabaseSync(databasePath)
const execFileAsync = promisify(execFile)
ensureColumn('media_sources', 'root_relative_path', 'TEXT')

createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`)
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (requestUrl.pathname === '/api/health') {
    return send(response, 200, { status: 'ok' })
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
      ffprobe: runtimes.ffprobe.available,
      vlc: runtimes.vlc.available,
      diagnostics: Object.fromEntries(Object.entries(runtimes).map(([name, runtime]) => [
        name,
        { source: runtime.source, reason: runtime.reason },
      ])),
    })
  }

  if (requestUrl.pathname === '/api/sources') {
    refreshSourceStatuses()
    const sources = database.prepare(`
      SELECT id, name, root_path AS path, status, removable, volume_label AS volumeLabel,
        volume_id AS volumeId,
        (SELECT COUNT(*) FROM media_items WHERE source_id = media_sources.id) AS itemCount
      FROM media_sources
      ORDER BY name
    `).all()

    return send(response, 200, sources)
  }

  if (requestUrl.pathname === '/api/progress' && request.method === 'GET') {
    const progress = database.prepare(`
      SELECT position_seconds AS position, duration_seconds AS duration, watched
      FROM watch_progress
      WHERE profile_id = ? AND media_item_id = ?
    `).get(requestUrl.searchParams.get('profileId'), requestUrl.searchParams.get('mediaId'))
    return send(response, 200, progress || null)
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
    const watched = body.watched ? 1 : 0
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

      database.prepare(`
        INSERT INTO profiles (id, name, avatar_key)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar_key = excluded.avatar_key
      `).run(id, name, avatarKey)

      return send(response, 200, { id, name, avatarKey, isKids: 0 })
    }

    const profiles = database.prepare(`
      SELECT id, name, avatar_key AS avatarKey, is_kids AS isKids
      FROM profiles
      ORDER BY created_at
    `).all()

    return send(response, 200, profiles)
  }

  if (requestUrl.pathname === '/api/library') {
    return send(response, 200, await buildLibrary(requestUrl.searchParams.get('profileId')))
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

    if (action === 'approve' || action === 'correct') {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const kind = body.kind === 'movie' ? 'movie' : 'other'
      if (!title) return send(response, 400, { error: 'Título obrigatório.' })
      database.prepare(`
        UPDATE media_items
        SET title = ?, kind = ?, classification_status = 'approved', classification_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title, kind, id)
      return send(response, 200, { status: 'approved', title, kind })
    }

    return send(response, 400, { error: 'Ação de revisão inválida.' })
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

  const subtitleListMatch = requestUrl.pathname.match(/^\/api\/media\/([^/]+)\/subtitles$/)
  if (subtitleListMatch) {
    return send(response, 200, findSubtitleTracks(subtitleListMatch[1]))
  }

  const subtitleMatch = requestUrl.pathname.match(/^\/api\/subtitle\/([^/]+)$/)
  if (subtitleMatch) {
    return streamSubtitle(subtitleMatch[1], response)
  }

  const artworkMatch = requestUrl.pathname.match(/^\/api\/artwork\/([^/]+)\/(poster|banner)$/)
  if (artworkMatch) {
    return streamArtwork('show', artworkMatch[1], artworkMatch[2], response)
  }

  const movieArtworkMatch = requestUrl.pathname.match(/^\/api\/artwork\/movie\/([^/]+)\/poster$/)
  if (movieArtworkMatch) {
    return streamArtwork('movie', movieArtworkMatch[1], 'poster', response)
  }

  return send(response, 404, { error: 'Rota não encontrada' })
}).listen(port, '127.0.0.1', () => {
  console.log(`Savano Cine API em http://127.0.0.1:${port}`)
})

function refreshSourceStatuses() {
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

    const fallbackVolume = existsSync(source.root_path) ? getVolumeInfoForPath(source.root_path) : null
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

  if (request.headers.range) {
    return send(response, 416, {
      error: 'Range não está disponível para o stream transcodificado.',
      available: true,
    })
  }

  const executable = getRuntimeExecutable('CINE_FFMPEG_PATH', 'ffmpeg.exe')
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  const audioStream = parseStreamIndex(requestUrl.searchParams.get('audioStream'))
  const subtitleStream = parseStreamIndex(requestUrl.searchParams.get('subtitleStream'))
  const transcoder = spawn(executable, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
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
      '-show_entries', 'stream=index,codec_type,codec_name:stream_tags=language,title',
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
    return send(response, 200, {
      available: true,
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
  const items = database.prepare(`
    SELECT id, title, year, overview, genres_json, extension, tags_json, relative_path AS relativePath,
      p.position_seconds AS progressPosition, p.duration_seconds AS progressDuration,
      (SELECT 1 FROM artwork a WHERE a.movie_id = media_items.id AND a.artwork_type = 'poster' AND a.source = 'local' LIMIT 1) AS hasPoster
    FROM media_items
    LEFT JOIN watch_progress p ON p.media_item_id = media_items.id AND p.profile_id = ?
    WHERE kind = 'movie'
      AND classification_status IN ('auto', 'approved')
      AND deleted_at IS NULL
    ORDER BY title COLLATE NOCASE
    LIMIT 500
  `).all(profileId).map((item) => ({
    id: item.id,
    title: item.title,
    kind: 'Filme',
    meta: item.extension.toUpperCase(),
    detail: item.relativePath,
    year: item.year,
    overview: item.overview,
    genres: JSON.parse(item.genres_json || item.tags_json || '[]'),
    posterClass: 'poster-default',
    mediaUrl: `/api/media/${item.id}`,
    subtitleUrl: `/api/media/${item.id}/subtitles`,
    mediaId: item.id,
    subtitles: getSubtitleTracks(item.id),
    tags: JSON.parse(item.tags_json || '[]'),
    artwork: { source: 'none', verified: false },
    ...(item.hasPoster ? { artwork: { source: 'local', posterUrl: `/api/artwork/movie/${item.id}/poster`, verified: true } } : {}),
    progress: item.progressDuration ? Math.round((item.progressPosition / item.progressDuration) * 100) : undefined,
  }))

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
          p.position_seconds AS progressPosition, p.duration_seconds AS progressDuration
        FROM episodes e
        JOIN media_items m ON m.id = e.media_item_id
        LEFT JOIN watch_progress p ON p.media_item_id = m.id AND p.profile_id = ?
        WHERE e.season_id = ? AND m.deleted_at IS NULL
        ORDER BY number
      `).all(profileId, season.id).map((episode) => ({
        id: episode.id,
        season: season.number,
        number: episode.number,
        title: episode.title,
        filename: episode.filename,
        duration: 'Duração não analisada',
        subtitles: getSubtitleTracks(episode.mediaId),
        mediaUrl: `/api/media/${episode.mediaId}`,
        subtitleUrl: `/api/media/${episode.mediaId}/subtitles`,
        mediaId: episode.mediaId,
        progress: episode.progressDuration ? Math.round((episode.progressPosition / episode.progressDuration) * 100) : undefined,
        position: episode.progressPosition ? `${Math.floor(episode.progressPosition / 60)} min` : undefined,
      })),
    }))

    const episodeCount = seasons.reduce((total, season) => total + season.episodes.length, 0)
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
      artwork: showArtworks[index].artwork,
      bannerUrl: showArtworks[index].bannerUrl,
      tags: showArtworks[index].tags,
      seasons,
    })
  }

  async function fetchShowArtwork(title) {
    try {
      const response = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`)
      if (!response.ok) throw new Error(`TVMaze ${response.status}`)
      const show = await response.json()
      const posterUrl = show.image?.original || show.image?.medium
      const tags = ['Série']
      if (show.type === 'Animation') tags.push('Animação')
      for (const genre of show.genres || []) tags.push(genre)
      const showId = `show-${slugify(title)}`
      const localArt = database.prepare(`
        SELECT artwork_type AS type
        FROM artwork
        WHERE show_id = ? AND source = 'local'
      `).all(showId)
      const hasPoster = localArt.some((art) => art.type === 'poster')
      const hasBanner = localArt.some((art) => art.type === 'banner')
      return {
        artwork: posterUrl
          ? { source: hasPoster ? 'local' : 'tvmaze', posterUrl: hasPoster ? `/api/artwork/${showId}/poster` : posterUrl, providerId: String(show.id), verified: true }
          : { source: 'none', verified: false },
        bannerUrl: hasBanner ? `/api/artwork/${showId}/banner` : posterUrl,
        tags,
      }
    } catch {
      return { artwork: { source: 'none', verified: false }, tags: ['Série'] }
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

function getSubtitleTracks(mediaId) {
  return database.prepare(`
    SELECT language, label, 1 AS available, provider
    FROM subtitle_tracks
    WHERE media_item_id = ?
    ORDER BY language, relative_path
  `).all(mediaId)
}

function send(response, status, body) {
  response.writeHead(status)
  response.end(JSON.stringify(body))
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
    const content = readFileSync(filePath, 'utf8')
    const body = extension === '.srt' ? srtToVtt(content) : content
    response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' })
    return response.end(body)
  } catch {
    return send(response, 404, { error: 'Legenda indisponível.' })
  }
}

function srtToVtt(content) {
  return `WEBVTT\n\n${content.replace(/\r?\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

function streamMedia(mediaId, request, response) {
  const media = database.prepare(`
    SELECT m.relative_path AS relativePath, m.extension, s.root_path AS rootPath
    FROM media_items m
    JOIN media_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(mediaId)

  if (!media) return send(response, 404, { error: 'Mídia não encontrada.' })

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
