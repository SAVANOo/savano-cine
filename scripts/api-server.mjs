import { existsSync } from 'node:fs'
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
    return send(response, 200, buildLibrary())
  }

  return send(response, 404, { error: 'Rota não encontrada' })
}).listen(port, '127.0.0.1', () => {
  console.log(`Savano Cine API em http://127.0.0.1:${port}`)
})

function buildLibrary() {
  const items = database.prepare(`
    SELECT id, title, extension, relative_path AS relativePath
    FROM media_items
    WHERE kind = 'movie'
      AND classification_status IN ('auto', 'approved')
    ORDER BY title COLLATE NOCASE
    LIMIT 500
  `).all().map((item) => ({
    id: item.id,
    title: item.title,
    kind: 'Filme',
    meta: item.extension.toUpperCase(),
    detail: item.relativePath,
    posterClass: 'poster-default',
    artwork: { source: 'none', verified: false },
  }))

  const shows = database.prepare(`
    SELECT id, title
    FROM shows
    WHERE EXISTS (
      SELECT 1
      FROM seasons s
      JOIN episodes e ON e.season_id = s.id
      WHERE s.show_id = shows.id
    )
    ORDER BY title COLLATE NOCASE
  `).all()

  for (const show of shows) {
    const seasons = database.prepare(`
      SELECT id, season_number AS number
      FROM seasons
      WHERE show_id = ?
      ORDER BY number
    `).all(show.id).map((season) => ({
      number: season.number,
      episodes: database.prepare(`
        SELECT e.id, e.episode_number AS number, e.title, m.relative_path AS filename
        FROM episodes e
        JOIN media_items m ON m.id = e.media_item_id
        WHERE e.season_id = ?
        ORDER BY number
      `).all(season.id).map((episode) => ({
        id: episode.id,
        season: season.number,
        number: episode.number,
        title: episode.title,
        filename: episode.filename,
        duration: 'Duração não analisada',
        subtitles: [{ language: 'pt-BR', label: 'Nenhuma faixa cadastrada', available: false }],
      })),
    }))

    const episodeCount = seasons.reduce((total, season) => total + season.episodes.length, 0)
    items.push({
      id: show.id,
      title: show.title,
      kind: 'Série',
      meta: `${seasons.length} temporadas`,
      detail: `${episodeCount} episódios catalogados`,
      posterClass: show.title.toLocaleLowerCase().includes('south park') ? 'poster-south-park' : 'poster-default',
      artwork: { source: 'none', verified: false },
      seasons,
    })
  }

  return items
}

function send(response, status, body) {
  response.writeHead(status)
  response.end(JSON.stringify(body))
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
