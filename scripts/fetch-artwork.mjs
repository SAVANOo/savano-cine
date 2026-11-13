import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const databasePath = path.resolve('data/catalog.db')
const artworkRoot = path.resolve('data/artwork')
const database = new DatabaseSync(databasePath)

await mkdir(path.join(artworkRoot, 'shows'), { recursive: true })
ensureColumn('artwork', 'artwork_type', `TEXT NOT NULL DEFAULT 'poster'`)

const shows = database.prepare('SELECT id, title FROM shows ORDER BY title').all()
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
