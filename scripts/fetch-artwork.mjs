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
  let overviewPt = null
  if (tmdbApiKey) {
    const tmdbShow = await fetchTmdbShowArtwork(show.title, show.id)
    if (tmdbShow?.overview) overviewPt = tmdbShow.overview
    if (tmdbShow?.backdropUrl) {
      await downloadShowArtwork(show, 'banner', tmdbShow.backdropUrl, 'tmdb', String(tmdbShow.id))
    }
  }
  if (!overviewPt) {
    overviewPt = await fetchPtShowSummary(show.title)
  }
  updateShow.run(
    metadata.premiered ? Number(metadata.premiered.slice(0, 4)) : null,
    overviewPt || stripHtml(metadata.summary || ''),
    JSON.stringify([...(metadata.type === 'Animation' ? ['Animação'] : []), ...(metadata.genres || [])]),
    show.id,
  )
  const posterUrl = metadata.image?.original || metadata.image?.medium
  if (!posterUrl) continue

  await downloadShowArtwork(show, 'poster', posterUrl, 'tvmaze', String(metadata.id))
  if (!hasLocalShowArtwork(show.id, 'banner')) {
    const tvmazeBg = await fetchTvmazeBackground(metadata.id)
    await downloadShowArtwork(show, 'banner', tvmazeBg || posterUrl, 'tvmaze', String(metadata.id))
  }
  downloaded += 1
}

const artworkRows = database.prepare('SELECT id, remote_url FROM artwork').all()
const deleteBadArtwork = database.prepare('DELETE FROM artwork WHERE id = ?')
for (const row of artworkRows) {
  if (row.remote_url && isPlaceholderImage(row.remote_url)) {
    deleteBadArtwork.run(row.id)
  }
}

const movies = database.prepare(`
  SELECT id, title, year, tags_json FROM media_items
  WHERE kind = 'movie'
    AND classification_status IN ('auto', 'approved')
    AND deleted_at IS NULL
    AND (
      overview IS NULL OR overview = ''
      OR genres_json IS NULL OR genres_json = '[]'
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
  SET year = COALESCE(?, year),
      overview = COALESCE(NULLIF(?, ''), overview),
      genres_json = CASE WHEN genres_json = '[]' OR genres_json IS NULL THEN ? ELSE genres_json END
  WHERE id = ?
`)
let moviePostersDownloaded = 0
let movieMetadataUpdated = 0
for (const movie of movies) {
  let imdbData = null
  if (!hasLocalArtwork(movie.id, 'poster')) {
    imdbData = await fetchImdbSuggestion(movie.title, movie.year)
    if (imdbData?.posterUrl) {
      updateMovie.run(imdbData.year, null, JSON.stringify([]), movie.id)
      const ok = await downloadMovieArtwork(movie, 'poster', imdbData.posterUrl, 'imdb', imdbData.id)
      if (ok) moviePostersDownloaded += 1
    }
  }
  const metadata = await fetchWikipedia(movie.title, movie.id, movie.year)
  const inferredGenres = inferGenresFromText(
    `${movie.title} ${metadata?.overview || ''}`,
    JSON.parse(movie.tags_json || '[]'),
  )
  if (metadata || inferredGenres.length > 0) {
    updateMovie.run(
      metadata?.year ?? imdbData?.year ?? null,
      metadata?.overview ?? null,
      JSON.stringify(inferredGenres),
      movie.id,
    )
    movieMetadataUpdated += 1
    if (metadata?.imageUrl && !isPlaceholderImage(metadata.imageUrl) && !hasLocalArtwork(movie.id, 'poster')) {
      const ok = await downloadMovieArtwork(movie, 'poster', metadata.imageUrl, 'wikipedia', String(metadata.pageId))
      if (ok) moviePostersDownloaded += 1
    }
  }
  if (tmdbApiKey) {
    const tmdb = await fetchTmdbArtwork(movie.title, movie.id)
    if (tmdb?.overview) {
      database.prepare('UPDATE media_items SET overview = ? WHERE id = ?').run(tmdb.overview, movie.id)
    }
    if (tmdb?.backdropUrl && !hasLocalArtwork(movie.id, 'banner')) {
      await downloadMovieArtwork(movie, 'banner', tmdb.backdropUrl, 'tmdb', String(tmdb.id))
    }
  }
}

console.log(`Arte baixada para ${downloaded} séries e ${moviePostersDownloaded} filmes; metadados atualizados para ${movieMetadataUpdated} filmes (IMDb/Wikipedia${tmdbApiKey ? ' + TMDB' : ''}) em ${artworkRoot}`)

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

function summarizeOverview(text, maxLength = 420) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  const cut = clean.slice(0, maxLength)
  const lastPeriod = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return lastPeriod > 120 ? cut.slice(0, lastPeriod + 1).trim() : `${cut.trim()}...`
}

function isFilmPageTitle(candidateTitle, movieTitle) {
  const stripped = String(candidateTitle || '').replace(/\s*\((?:filme|film)(?:\s+de\s+\d{4}|\s+\d{4})?\)\s*$/i, '')
  return normalizeTitle(stripped) === normalizeTitle(movieTitle)
}

function inferGenresFromText(text, existingTags = []) {
  const source = `${text || ''} ${(existingTags || []).join(' ')}`.toLowerCase()
  const rules = [
    ['Animação', /\b(anima[çc][aã]o|animated|animation|anime|casa monstro|chapeuzinho|kung fu panda|rio|lucas|guardi[õo]es|fuga do planeta|ben 10)\b/i],
    ['Ação', /\b(a[çc][aã]o|action|super-?her[óo]i|superhero|marvel|dc|vingadores|avengers|vingador|capit[ãa]o am[ée]rica|captain america|capit[ãa] marvel|homem de ferro|iron man|doutor estranho|eternos|batman|cavaleiro das trevas|sociedade da justi[çc]a|superman|homem-aranha|homem aranha|homem-formiga|pantera negra|vi[úu]va negra|deadpool|thor|x-men|hellboy|hulk|liga da justi[çc]a|kick-ass|morbius|trem-bala|logan|watchmen|constantine|mulher maravilha|guerra mundial z)\b/i],
    ['Aventura', /\b(aventura|adventure|n[áa]rnia|maze runner|animais fant[áa]sticos|jumper|quarteto fant[áa]stico)\b/i],
    ['Comédia', /\b(com[ée]dia|comedy|todo mundo em p[âa]nico|porta dos fundos|par[óo]dia|super her[óo]i)\b/i],
    ['Drama', /\b(drama|biografia|biogr[áa]fico|marighella|pijama listrado|oppenheimer|lunar)\b/i],
    ['Fantasia', /\b(fantasia|fantasy|magia|brux|guardi[õo]es|animais fant[áa]sticos|n[áa]rnia)\b/i],
    ['Ficção Científica', /\b(fic[çc][aã]o cient[íi]fica|sci-fi|science fiction|divergente|almanaque|espacial|planeta|jumper)\b/i],
    ['Terror', /\b(terror|horror|sobrenatural|exorcista|longlegs|corra|boa noite mam[ãa]e|it a coisa|zumbil[âa]ndia|n[óo]s)\b/i],
    ['Suspense', /\b(suspense|thriller|mist[ée]rio|mystery|ilha do medo)\b/i],
    ['Documentário', /\b(document[áa]rio|documentary|making of)\b/i],
    ['Família', /\b(fam[íi]lia|family|infantil|natal|christmas)\b/i],
  ]
  const detected = []
  for (const [label, regex] of rules) {
    if (regex.test(source) && !detected.includes(label)) {
      detected.push(label)
    }
  }
  return detected.slice(0, 4)
}

async function fetchWikipedia(title, movieId, movieYear = null) {
  const candidatePages = []
  const targetNorm = normalizeTitle(title)
  for (const language of wikipediaLanguages) {
    const api = `https://${language}.wikipedia.org/w/api.php`
    const queries = [title, `${title} ${language === 'pt' ? 'filme' : 'film'}`]
    for (const query of queries) {
      const search = await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=6&format=json&origin=*`, {
        headers: { 'User-Agent': 'SavanoCine/1.0 (https://localhost; local-catalog)' },
        signal: AbortSignal.timeout(8000),
      })
      if (!search.ok) continue
      const result = await search.json()
      const pages = result.query?.search || []
      const page =
        pages.find((candidate) => /\((?:filme|film)/i.test(candidate.title) && isFilmPageTitle(candidate.title, title)) ??
        pages.find((candidate) => isFilmPageTitle(candidate.title, title)) ??
        pages.find((candidate) => {
          const candNorm = normalizeTitle(candidate.title)
          return candNorm.includes(targetNorm) && /filme|film|movie|cinema/i.test(candidate.snippet || candidate.title)
        }) ??
        (query !== title && pages[0] && /filme|film|anima[çc][aã]o|directed|dirigido/i.test(pages[0].snippet || '') ? pages[0] : null)
      if (!page) {
        for (const candidate of pages.slice(0, 2)) {
          candidatePages.push({ language, api, page: candidate })
        }
        continue
      }

      const details = await fetch(`${api}?action=query&prop=extracts|pageimages&piprop=original&exintro=1&explaintext=1&pageids=${page.pageid}&format=json&origin=*`, {
        headers: { 'User-Agent': 'SavanoCine/1.0 (https://localhost; local-catalog)' },
        signal: AbortSignal.timeout(8000),
      })
      if (!details.ok) continue
      const data = await details.json()
      const rawOverview = data.query?.pages?.[page.pageid]?.extract?.trim()
      if (!rawOverview || /pode referir-se a|may refer to/i.test(rawOverview.slice(0, 140))) continue
      if (
        !/\((?:filme|film)\b/i.test(page.title) &&
        !/\b(filme|anima[çc][aã]o|longa-metragem|dirigido|dire[çc][aã]o|cinema|film|animated|directed by)\b/i.test(
          rawOverview.slice(0, 400),
        )
      ) {
        continue
      }
      return {
        overview: summarizeOverview(rawOverview),
        pageId: page.pageid,
        imageUrl: data.query?.pages?.[page.pageid]?.original?.source,
        year: movieYear || (title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ? Number(title.match(/\b(19\d{2}|20\d{2})\b/)[1]) : null),
      }
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

function isPlaceholderImage(url) {
  const lower = String(url || '').toLowerCase()
  return (
    !lower ||
    lower.endsWith('.svg') ||
    lower.includes('nenhuma_imagem') ||
    lower.includes('image_missing') ||
    lower.includes('no_image') ||
    lower.includes('question_book') ||
    lower.includes('ambox')
  )
}

async function fetchImdbSuggestion(title, movieYear = null) {
  const base = title.replace(/\s+/g, ' ').trim()
  const candidates = [base]
  if (base.includes(' - ')) {
    const suffix = base.split(/\s+-\s+/).slice(1).join(' ').trim()
    if (suffix && suffix.length >= 4) candidates.push(suffix)
  }
  candidates.push(`Um ${base}`)
  for (const clean of candidates) {
    try {
      const response = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(clean)}.json`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000),
        },
      )
      if (!response.ok) continue
      const payload = await response.json()
      const items = Array.isArray(payload?.d) ? payload.d : []
      const withImage = items.filter((entry) => entry?.i?.imageUrl && !isPlaceholderImage(entry.i.imageUrl))
      const isMovieLike = (entry) =>
        entry.q === 'feature' || entry.q === 'video' || entry.q === 'TV movie' || entry.q === 'TV special'
      const best =
        (typeof movieYear === 'number' ? withImage.find((entry) => isMovieLike(entry) && entry.y === movieYear) : null) ??
        withImage.find(isMovieLike) ??
        withImage[0]
      if (!best?.i?.imageUrl) continue
      const resized = String(best.i.imageUrl).replace(/\._V1_.*\.jpg$/i, '._V1_UX500_.jpg')
      return {
        id: String(best.id || slugify(clean)),
        year: typeof best.y === 'number' ? best.y : null,
        posterUrl: resized,
      }
    } catch {
      // try next candidate
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
    const exact = results.filter((candidate) => normalizeTitle(candidate.title || candidate.original_title || '') === normalized)
    if (exact.length === 1) {
      return {
        id: exact[0].id,
        overview: exact[0].overview || null,
        backdropUrl: exact[0].backdrop_path ? `https://image.tmdb.org/t/p/w1280${exact[0].backdrop_path}` : null,
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

async function fetchTmdbShowArtwork(title, showId) {
  try {
    const search = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(tmdbApiKey)}&query=${encodeURIComponent(title)}&include_adult=false&language=pt-BR`)
    if (!search.ok) return null
    const results = (await search.json()).results || []
    const normalized = normalizeTitle(title)
    const exact = results.filter((candidate) => normalizeTitle(candidate.name || candidate.original_name || '') === normalized)
    if (exact.length === 1) {
      return {
        id: exact[0].id,
        overview: exact[0].overview || null,
        backdropUrl: exact[0].backdrop_path ? `https://image.tmdb.org/t/p/w1280${exact[0].backdrop_path}` : null,
      }
    }
    for (const candidate of results.slice(0, 5)) {
      if (!candidate.id || (!candidate.poster_path && !candidate.backdrop_path && !candidate.overview)) continue
      saveArtworkCandidate({
        showId,
        provider: 'tmdb',
        providerId: String(candidate.id),
        title: candidate.name || candidate.original_name || title,
        year: candidate.first_air_date ? Number(candidate.first_air_date.slice(0, 4)) : null,
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

function hasLocalShowArtwork(showId, artworkType) {
  return Boolean(database.prepare(`
    SELECT 1 FROM artwork
    WHERE show_id = ? AND artwork_type = ? AND source = 'local'
    LIMIT 1
  `).get(showId, artworkType))
}

async function downloadShowArtwork(show, artworkType, imageUrl, provider, providerId) {
  try {
    const image = await fetch(imageUrl)
    if (!image.ok) return false
    const extension = image.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
    const filename = `${slugify(show.title)}-${artworkType}.${extension}`
    const relativePath = path.join('data', 'artwork', 'shows', filename)
    await writeFile(path.resolve(relativePath), Buffer.from(await image.arrayBuffer()))
    upsertArtwork.run(
      `art-${show.id}-${artworkType}`,
      show.id,
      relativePath,
      imageUrl,
      provider,
      providerId,
      'local',
      artworkType,
    )
    return true
  } catch {
    return false
  }
}

async function fetchTvmazeBackground(tvmazeId) {
  try {
    const response = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/images`, {
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return null
    const images = (await response.json()) || []
    const bg = images.find((img) => img.type === 'background' && img.resolutions?.original?.url)
    return bg?.resolutions?.original?.url || null
  } catch {
    return null
  }
}

async function fetchPtShowSummary(title) {
  try {
    const response = await fetch(
      `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      {
        headers: { 'User-Agent': 'SavanoCine/1.0 (https://localhost; local-catalog)' },
        signal: AbortSignal.timeout(6000),
      },
    )
    if (!response.ok) return null
    const data = await response.json()
    if (data?.type === 'disambiguation' || !data?.extract) return null
    return data.extract.trim() || null
  } catch {
    return null
  }
}
