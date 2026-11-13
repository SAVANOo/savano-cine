import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = path.resolve('data/catalog.db')
const artworkRoot = path.resolve('data/artwork')
const database = new DatabaseSync(databasePath)

await mkdir(path.join(artworkRoot, 'shows'), { recursive: true })
ensureColumn('artwork', 'artwork_type', `TEXT NOT NULL DEFAULT 'poster'`)
ensureColumn('shows', 'genres_json', `TEXT NOT NULL DEFAULT '[]'`)
ensureColumn('media_items', 'overview', 'TEXT')
ensureColumn('media_items', 'genres_json', `TEXT NOT NULL DEFAULT '[]'`)

const shows = database.prepare('SELECT id, title FROM shows ORDER BY title').all()
const updateShow = database.prepare(`
  UPDATE shows
  SET year = ?, overview = ?, genres_json = ?
  WHERE id = ?
`)
const upsertArtwork = database.prepare(`
  INSERT INTO artwork (id, show_id, local_path, remote_url, provider, provider_id, source, verified, artwork_type)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  ON CONFLICT(id) DO UPDATE SET
    local_path = excluded.local_path,
    remote_url = excluded.remote_url,
    provider = excluded.provider,
    provider_id = excluded.provider_id,
    source = excluded.source,
    verified = excluded.verified,
    artwork_type = excluded.artwork_type
`)

let downloaded = 0
for (const show of shows) {
  const response = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(show.title)}`)
  if (!response.ok) continue
  const metadata = await response.json()
  updateShow.run(
    metadata.premiered ? Number(metadata.premiered.slice(0, 4)) : null,
    stripHtml(metadata.summary || ''),
    JSON.stringify([...(metadata.type === 'Animation' ? ['Animação'] : []), ...(metadata.genres || [])]),
    show.id,
  )
  const posterUrl = metadata.image?.original || metadata.image?.medium
  if (!posterUrl) continue

  const image = await fetch(posterUrl)
  if (!image.ok) continue
  const extension = image.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
  const filename = `${slugify(show.title)}-poster.${extension}`
  const relativePath = path.join('data', 'artwork', 'shows', filename)
  await writeFile(path.resolve(relativePath), Buffer.from(await image.arrayBuffer()))

  upsertArtwork.run(
    `art-${show.id}-poster`,
    show.id,
    relativePath,
    posterUrl,
    'tvmaze',
    String(metadata.id),
    'local',
    'poster',
  )
  upsertArtwork.run(
    `art-${show.id}-banner`,
    show.id,
    relativePath,
    posterUrl,
    'tvmaze',
    String(metadata.id),
    'local',
    'banner',
  )
  downloaded += 1
}

const movies = database.prepare(`
  SELECT id, title FROM media_items
  WHERE kind = 'movie'
    AND (
      overview IS NULL OR overview = ''
      OR NOT EXISTS (
        SELECT 1 FROM artwork
        WHERE artwork.movie_id = media_items.id AND artwork.artwork_type = 'poster'
      )
    )
  ORDER BY title
`).all()
const updateMovie = database.prepare(`
  UPDATE media_items
  SET year = COALESCE(?, year), overview = ?, genres_json = ?
  WHERE id = ?
`)
const upsertMovieArtwork = database.prepare(`
  INSERT INTO artwork (id, movie_id, local_path, remote_url, provider, provider_id, source, verified, artwork_type)
  VALUES (?, ?, ?, ?, ?, ?, 'local', 1, 'poster')
  ON CONFLICT(id) DO UPDATE SET
    local_path = excluded.local_path,
    remote_url = excluded.remote_url,
    provider = excluded.provider,
    provider_id = excluded.provider_id,
    source = excluded.source,
    verified = excluded.verified
`)

for (const movie of movies) {
  const metadata = await fetchWikipedia(movie.title)
  if (!metadata) continue
  updateMovie.run(metadata.year, metadata.overview, JSON.stringify([]), movie.id)
  if (metadata.imageUrl) {
    const image = await fetch(metadata.imageUrl)
    if (image.ok) {
      const extension = image.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
      const filename = `${slugify(movie.title)}-poster.${extension}`
      const relativePath = path.join('data', 'artwork', 'movies', filename)
      await mkdir(path.dirname(path.resolve(relativePath)), { recursive: true })
      await writeFile(path.resolve(relativePath), Buffer.from(await image.arrayBuffer()))
      upsertMovieArtwork.run(`art-${movie.id}-poster`, movie.id, relativePath, metadata.imageUrl, 'wikipedia', String(metadata.pageId))
    }
  }
}

console.log(`Arte baixada para ${downloaded} séries em ${artworkRoot}`)

function ensureColumn(table, column, definition) {
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error
  }
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchWikipedia(title) {
  const search = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`)
  if (!search.ok) return null
  const result = await search.json()
  const page = result.query?.search?.[0]
  if (!page) return null

  const details = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&piprop=original&exintro=1&explaintext=1&pageids=${page.pageid}&format=json&origin=*`)
  if (!details.ok) return null
  const data = await details.json()
  const overview = data.query?.pages?.[page.pageid]?.extract?.trim()
  if (!overview) return null
  return {
    overview,
    pageId: page.pageid,
    imageUrl: data.query?.pages?.[page.pageid]?.original?.source,
    year: title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ? Number(title.match(/\b(19\d{2}|20\d{2})\b/)[1]) : null,
  }
}
