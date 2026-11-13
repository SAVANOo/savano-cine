import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { collectMediaFiles, classifyMedia } from './scan-media.mjs'

const sourceArg = process.argv[2]
const sourcePath = sourceArg ? path.resolve(sourceArg) : null
const databasePath = path.resolve('data/catalog.db')

if (!sourcePath) {
  console.error('Uso: npm run import -- <pasta>')
  process.exit(1)
}

await mkdir(path.dirname(databasePath), { recursive: true })

const database = new DatabaseSync(databasePath)
const schema = await readFile(path.resolve('database/schema.sql'), 'utf8')
database.exec(schema)
ensureColumn('media_items', 'tags_json', `TEXT NOT NULL DEFAULT '[]'`)
ensureColumn('media_items', 'deleted_at', 'TEXT')
database.exec(`
  CREATE TABLE IF NOT EXISTS media_item_title_history (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    old_title TEXT NOT NULL,
    new_title TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)
database.prepare(`
  INSERT INTO profiles (id, name, avatar_key)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`).run('profile-savio', 'Savio', 'cartman')

const sourceId = `source-${slugify(sourcePath)}`
const sourceName = `${path.basename(sourcePath) || sourcePath} (${sourcePath.slice(0, 2).toUpperCase()})`
const files = await collectMediaFiles(sourcePath)

database.prepare(`
  INSERT INTO media_sources (id, name, root_path, removable, status, last_scan_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(root_path) DO UPDATE SET
    name = excluded.name,
    status = excluded.status,
    last_scan_at = excluded.last_scan_at
`).run(sourceId, sourceName, sourcePath, /^[A-Z]:\\/i.test(sourcePath) && sourcePath[0].toUpperCase() !== 'C' ? 1 : 0, 'online')

const insertMovie = database.prepare(`
  INSERT INTO media_items (
    id, source_id, relative_path, title, kind, classification_status, classification_reason,
    tags_json, extension, exists_on_disk
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(source_id, relative_path) DO UPDATE SET
    title = excluded.title,
    kind = excluded.kind,
    classification_status = excluded.classification_status,
    classification_reason = excluded.classification_reason,
    tags_json = excluded.tags_json,
    extension = excluded.extension,
    exists_on_disk = 1,
    updated_at = CURRENT_TIMESTAMP
`)
const insertShow = database.prepare(`
  INSERT INTO shows (id, title, normalized_title)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, normalized_title = excluded.normalized_title
`)
const insertSeason = database.prepare(`
  INSERT INTO seasons (id, show_id, season_number)
  VALUES (?, ?, ?)
  ON CONFLICT(show_id, season_number) DO NOTHING
`)
const insertEpisode = database.prepare(`
  INSERT INTO episodes (id, season_id, media_item_id, episode_number, title)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(season_id, episode_number) DO NOTHING
`)
const deleteEpisodeForMediaItem = database.prepare(`
  DELETE FROM episodes WHERE media_item_id = ?
`)
const findExistingTitle = database.prepare('SELECT title FROM media_items WHERE id = ?')
const insertTitleHistory = database.prepare(`
  INSERT INTO media_item_title_history (id, media_item_id, old_title, new_title, reason)
  VALUES (?, ?, ?, ?, ?)
`)

let imported = 0
let episodes = 0
let movies = 0

database.exec('BEGIN')
try {
  for (const file of files) {
    const item = classifyMedia(file, sourcePath)
    const itemId = `media-${slugify(`${sourceId}-${item.caminho}`)}`
    const previous = findExistingTitle.get(itemId)
    if (previous && previous.title !== item.titulo) {
      insertTitleHistory.run(
        `title-${itemId}-${Date.now()}`,
        itemId,
        previous.title,
        item.titulo,
        'normalização automática do título',
      )
    }
    deleteEpisodeForMediaItem.run(itemId)
    const kind = item.tipo === 'serie' ? 'episode' : item.tipo === 'outro' ? 'other' : 'movie'
    const classificationStatus = item.tipo === 'outro' ? 'review' : 'auto'
    insertMovie.run(
      itemId,
      sourceId,
      item.caminho,
      item.titulo,
      kind,
      classificationStatus,
      item.motivo || null,
      JSON.stringify(buildTags(item)),
      path.extname(file).slice(1).toLowerCase(),
    )

    if (item.tipo === 'serie' && item.temporada > 0 && item.episodio > 0) {
      const showTitle = item.pastaSerie || path.basename(path.dirname(file))
      const showId = `show-${slugify(showTitle)}`
      const seasonId = `${showId}-season-${item.temporada}`
      insertShow.run(showId, showTitle, normalize(showTitle))
      insertSeason.run(seasonId, showId, item.temporada)
      insertEpisode.run(
        `${itemId}-episode`,
        seasonId,
        itemId,
        item.episodio,
        item.titulo,
      )
      episodes += 1
    } else {
      movies += 1
    }

    imported += 1
  }
  database.exec('COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

console.log(`Catálogo atualizado em ${databasePath}`)
console.log(`${imported} arquivos importados: ${movies} filmes e ${episodes} episódios.`)

function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
}

function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function ensureColumn(table, column, definition) {
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error
  }
}

function buildTags(item) {
  const tags = [item.tipo === 'serie' ? 'Série' : item.tipo === 'filme' ? 'Filme' : 'Revisão']
  const normalized = normalize(`${item.titulo} ${item.pastaSerie || ''} ${item.caminho || ''}`)
  if (/(anime|desenho|cartoon|ben 10|south park|gravity falls)/.test(normalized)) tags.push('Animação')
  if (/(terror|horror)/.test(normalized)) tags.push('Terror')
  if (/(suspense|thriller|misterio)/.test(normalized)) tags.push('Suspense')
  if (/(comedia|comedy)/.test(normalized)) tags.push('Comédia')
  return tags
}
