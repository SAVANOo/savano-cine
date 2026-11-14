import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = path.resolve('data/catalog.db')
const artworkRoot = path.resolve('data/artwork')
const database = new DatabaseSync(databasePath)
const tmdbApiKey = process.env.TMDB_API_KEY?.trim()
const configuredWikipediaLanguage = process.env.CINE_WIKIPEDIA_LANG?.trim().toLowerCase()
const preferredWikipediaLanguage = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(configuredWikipediaLanguage || '')
  ? configuredWikipediaLanguage
  : 'pt'
const wikipediaLanguages = [...new Set([preferredWikipediaLanguage, 'pt', 'en'])]

await mkdir(path.join(artworkRoot, 'shows'), { recursive: true })
await mkdir(path.join(artworkRoot, 'movies'), { recursive: true })
ensureColumn('artwork', 'artwork_type', `TEXT NOT NULL DEFAULT 'poster'`)
ensureColumn('shows', 'genres_json', `TEXT NOT NULL DEFAULT '[]'`)
ensureColumn('media_items', 'overview', 'TEXT')
ensureColumn('media_items', 'genres_json', `TEXT NOT NULL DEFAULT '[]'`)
ensureArtworkCandidatesTable()

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
  if (!response.ok) {
    await collectShowCandidates(show)
    continue
  }
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
      OR (? = 1 AND NOT EXISTS (
        SELECT 1 FROM artwork
        WHERE artwork.movie_id = media_items.id AND artwork.artwork_type = 'banner'
      ))
    )
  ORDER BY title
`).all(tmdbApiKey ? 1 : 0)
const updateMovie = database.prepare(`
  UPDATE media_items
  SET year = COALESCE(?, year), overview = ?, genres_json = ?
  WHERE id = ?
`)
for (const movie of movies) {
  const metadata = await fetchWikipedia(movie.title, movie.id)
  if (metadata) {
    updateMovie.run(metadata.year, metadata.overview, JSON.stringify([]), movie.id)
    if (metadata.imageUrl && !hasLocalArtwork(movie.id, 'poster')) {
      await downloadMovieArtwork(movie, 'poster', metadata.imageUrl, 'wikipedia', String(metadata.pageId))
    }
  }
  if (tmdbApiKey) {
    const tmdb = await fetchTmdbArtwork(movie.title, movie.id)
    if (tmdb?.backdropUrl && !hasLocalArtwork(movie.id, 'banner')) {
      await downloadMovieArtwork(movie, 'banner', tmdb.backdropUrl, 'tmdb', String(tmdb.id))
    }
  }
}

console.log(`Arte baixada para ${downloaded} séries; filmes via Wikipedia${tmdbApiKey ? ' + TMDB para backdrops' : ''} em ${artworkRoot}`)

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

function saveArtworkCandidate({
  movieId = null,
  showId = null,
  provider,
  providerId,
  title,
  year = null,
  overview = null,
  posterUrl = null,
  backdropUrl = null,
  language = null,
}) {
  const targetKey = movieId || showId
  if (!targetKey || !provider || !providerId) return
  const id = `cand-${targetKey}-${provider}-${providerId}`
  database.prepare(`
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
      language = COALESCE(excluded.language, artwork_candidates.language)
  `).run(id, movieId, showId, provider, String(providerId), title, year, overview, posterUrl, backdropUrl, language)
}

async function collectShowCandidates(show) {
  try {
    const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(show.title)}`)
    if (!response.ok) return
    const results = (await response.json()) || []
    for (const entry of results.slice(0, 5)) {
      const candidate = entry?.show
      if (!candidate?.id) continue
      const posterUrl = candidate.image?.original || candidate.image?.medium || null
      saveArtworkCandidate({
        showId: show.id,
        provider: 'tvmaze',
        providerId: String(candidate.id),
        title: candidate.name || show.title,
        year: candidate.premiered ? Number(candidate.premiered.slice(0, 4)) : null,
        overview: candidate.summary ? stripHtml(candidate.summary) : null,
        posterUrl,
        backdropUrl: posterUrl,
        language: candidate.language || null,
      })
    }
  } catch {
    // Ignora falhas de rede ao coletar candidatos de série
  }
}

async function fetchWikipedia(title, movieId) {
  const candidatePages = []
  for (const language of wikipediaLanguages) {
    const api = `https://${language}.wikipedia.org/w/api.php`
    const search = await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=5&format=json&origin=*`)
    if (!search.ok) continue
    const result = await search.json()
    const pages = result.query?.search || []
    const page = pages.find((candidate) => normalizeTitle(candidate.title) === normalizeTitle(title))
    if (!page) {
      for (const candidate of pages.slice(0, 3)) {
        candidatePages.push({ language, api, page: candidate })
      }
      continue
    }

    const details = await fetch(`${api}?action=query&prop=extracts|pageimages&piprop=original&exintro=1&explaintext=1&pageids=${page.pageid}&format=json&origin=*`)
    if (!details.ok) continue
    const data = await details.json()
    const overview = data.query?.pages?.[page.pageid]?.extract?.trim()
    if (!overview) continue
    return {
      overview,
      pageId: page.pageid,
      imageUrl: data.query?.pages?.[page.pageid]?.original?.source,
      year: title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ? Number(title.match(/\b(19\d{2}|20\d{2})\b/)[1]) : null,
    }
  }

  for (const entry of candidatePages.slice(0, 5)) {
    try {
      const details = await fetch(`${entry.api}?action=query&prop=extracts|pageimages&piprop=original&exintro=1&explaintext=1&pageids=${entry.page.pageid}&format=json&origin=*`)
      if (!details.ok) continue
      const data = await details.json()
      const pageData = data.query?.pages?.[entry.page.pageid]
      const overview = pageData?.extract?.trim() || null
      const imageUrl = pageData?.original?.source || null
      if (!overview && !imageUrl) continue
      saveArtworkCandidate({
        movieId,
        provider: 'wikipedia',
        providerId: `${entry.language}:${entry.page.pageid}`,
        title: entry.page.title,
        overview,
        posterUrl: imageUrl,
        language: entry.language,
      })
    } catch {
      // Ignora erro individual de candidato
    }
  }
  return null
}

function normalizeTitle(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(19\d{2}|20\d{2})\b/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
}

function hasLocalArtwork(movieId, artworkType) {
  return Boolean(database.prepare(`
    SELECT 1 FROM artwork
    WHERE movie_id = ? AND artwork_type = ? AND source = 'local'
    LIMIT 1
  `).get(movieId, artworkType))
}

async function downloadMovieArtwork(movie, artworkType, imageUrl, provider, providerId) {
  const image = await fetch(imageUrl)
  if (!image.ok) return false
  const extension = image.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
  const filename = `${slugify(movie.title)}-${artworkType}.${extension}`
  const relativePath = path.join('data', 'artwork', 'movies', filename)
  await writeFile(path.resolve(relativePath), Buffer.from(await image.arrayBuffer()))
  database.prepare(`
    INSERT INTO artwork (id, movie_id, local_path, remote_url, provider, provider_id, source, verified, artwork_type)
    VALUES (?, ?, ?, ?, ?, ?, 'local', 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      local_path = excluded.local_path,
      remote_url = excluded.remote_url,
      provider = excluded.provider,
      provider_id = excluded.provider_id,
      source = excluded.source,
      verified = excluded.verified,
      artwork_type = excluded.artwork_type
  `).run(`art-${movie.id}-${artworkType}`, movie.id, relativePath, imageUrl, provider, providerId, artworkType)
  return true
}

async function fetchTmdbArtwork(title, movieId) {
  try {
    const search = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdbApiKey)}&query=${encodeURIComponent(title)}&include_adult=false&language=pt-BR`)
    if (!search.ok) return null
    const results = (await search.json()).results || []
    const normalized = normalizeTitle(title)
    const exact = results.filter((candidate) => normalizeTitle(candidate.title || '') === normalized)
    if (exact.length === 1 && exact[0].backdrop_path) {
      return {
        id: exact[0].id,
        backdropUrl: `https://image.tmdb.org/t/p/w1280${exact[0].backdrop_path}`,
      }
    }
    for (const candidate of results.slice(0, 5)) {
      if (!candidate.id || (!candidate.poster_path && !candidate.backdrop_path && !candidate.overview)) continue
      saveArtworkCandidate({
        movieId,
        provider: 'tmdb',
        providerId: String(candidate.id),
        title: candidate.title || candidate.original_title || title,
        year: candidate.release_date ? Number(candidate.release_date.slice(0, 4)) : null,
        overview: candidate.overview || null,
        posterUrl: candidate.poster_path ? `https://image.tmdb.org/t/p/w500${candidate.poster_path}` : null,
        backdropUrl: candidate.backdrop_path ? `https://image.tmdb.org/t/p/w1280${candidate.backdrop_path}` : null,
        language: 'pt-BR',
      })
    }
    return null
  } catch {
    return null
  }
}
