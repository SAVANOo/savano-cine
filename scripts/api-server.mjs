import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.CINE_API_PORT || 4174)
const root = path.dirname(fileURLToPath(import.meta.url))
const databasePath = path.resolve(root, '..', 'data', 'catalog.db')

if (!existsSync(databasePath)) {
  console.error(`Catálogo não encontrado: ${databasePath}`)
  console.error('Execute primeiro: npm run import -- "E:\\Filmes"')
  process.exit(1)
}

const database = new DatabaseSync(databasePath)

createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`)
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (requestUrl.pathname === '/api/health') {
    return send(response, 200, { status: 'ok' })
  }

  if (requestUrl.pathname === '/api/sources') {
    const sources = database.prepare(`
      SELECT id, name, root_path AS path, status, removable, volume_label AS volumeLabel,
        (SELECT COUNT(*) FROM media_items WHERE source_id = media_sources.id) AS itemCount
      FROM media_sources
      ORDER BY name
    `).all()

    return send(response, 200, sources)
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
    return send(response, 200, await buildLibrary())
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

async function buildLibrary() {
  const items = database.prepare(`
    SELECT id, title, year, overview, genres_json, extension, tags_json, relative_path AS relativePath,
      (SELECT 1 FROM artwork a WHERE a.movie_id = media_items.id AND a.artwork_type = 'poster' AND a.source = 'local' LIMIT 1) AS hasPoster
    FROM media_items
    WHERE kind = 'movie'
      AND classification_status IN ('auto', 'approved')
      AND deleted_at IS NULL
    ORDER BY title COLLATE NOCASE
    LIMIT 500
  `).all().map((item) => ({
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
    tags: JSON.parse(item.tags_json || '[]'),
    artwork: { source: 'none', verified: false },
    ...(item.hasPoster ? { artwork: { source: 'local', posterUrl: `/api/artwork/movie/${item.id}/poster`, verified: true } } : {}),
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
      episodes: database.prepare(`
        SELECT e.id, e.episode_number AS number, e.title, m.id AS mediaId, m.relative_path AS filename
        FROM episodes e
        JOIN media_items m ON m.id = e.media_item_id
        WHERE e.season_id = ? AND m.deleted_at IS NULL
        ORDER BY number
      `).all(season.id).map((episode) => ({
        id: episode.id,
        season: season.number,
        number: episode.number,
        title: episode.title,
        filename: episode.filename,
        duration: 'Duração não analisada',
        subtitles: [{ language: 'pt-BR', label: 'Nenhuma faixa cadastrada', available: false }],
        mediaUrl: `/api/media/${episode.mediaId}`,
        subtitleUrl: `/api/media/${episode.mediaId}/subtitles`,
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
  `).get(showId, artworkType)
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
  const basename = path.basename(media.relativePath, path.extname(media.relativePath)).toLowerCase()
  let names
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }

  return names
    .filter((name) => /\.(srt|vtt)$/i.test(name) && name.toLowerCase().startsWith(basename))
    .map((name) => ({
      label: name.match(/\.([a-z]{2}(?:-[a-z]{2})?)\./i)?.[1]?.toUpperCase() || 'Original',
      url: `/api/subtitle/${encodeURIComponent(Buffer.from(JSON.stringify({ mediaId, name })).toString('base64url'))}`,
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
  if (!filePath.startsWith(`${directory}${path.sep}`)) return send(response, 400, { error: 'Legenda inválida.' })
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
