import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { collectMediaFiles, collectSubtitleTracks, classifyMedia } from './scan-media.mjs'
import { getRootRelativePath, getVolumeInfoForPath } from './volume-info.mjs'

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
ensureProfileProgressTable()
ensureColumn('media_items', 'tags_json', `TEXT NOT NULL DEFAULT '[]'`)
ensureColumn('media_items', 'deleted_at', 'TEXT')
ensureColumn('media_sources', 'root_relative_path', 'TEXT')
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
ensureProfileRatingsTable()

const volumeInfo = getVolumeInfoForPath(sourcePath)
const existingSource = volumeInfo?.volumeId
  ? database.prepare('SELECT id FROM media_sources WHERE volume_id = ?').get(volumeInfo.volumeId)
  : database.prepare('SELECT id FROM media_sources WHERE root_path = ?').get(sourcePath)
const sourceId = existingSource?.id || `source-${slugify(volumeInfo?.volumeId || sourcePath)}`
const sourceLabel = volumeInfo?.volumeLabel || path.basename(sourcePath) || sourcePath
const sourceDrive = volumeInfo?.driveLetter || sourcePath.slice(0, 2).toUpperCase()
const sourceName = `${sourceLabel} (${sourceDrive})`
const files = await collectMediaFiles(sourcePath)
const classifiedFiles = files.map((file) => ({ file, item: classifyMedia(file, sourcePath) }))
const specialNumbers = new Map()
const specialGroups = new Map()
for (const entry of classifiedFiles) {
  if (entry.item.tipo !== 'especial') continue
  const key = normalize(entry.item.pastaSerie || path.basename(path.dirname(entry.file)))
  const group = specialGroups.get(key) || []
  group.push(entry)
  specialGroups.set(key, group)
}
for (const group of specialGroups.values()) {
  group.sort((left, right) => left.item.caminho.localeCompare(right.item.caminho))
  group.forEach((entry, index) => specialNumbers.set(entry.file, index + 1))
}

const upsertSource = database.prepare(`
  INSERT INTO media_sources (
    id, name, root_path, root_relative_path, volume_id, volume_label, removable, status, last_scan_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(root_path) DO UPDATE SET
    name = excluded.name,
    root_relative_path = excluded.root_relative_path,
    volume_id = excluded.volume_id,
    volume_label = excluded.volume_label,
    removable = excluded.removable,
    status = excluded.status,
    last_scan_at = excluded.last_scan_at
`)
if (existingSource) {
  database.prepare(`
    UPDATE media_sources
    SET name = ?, root_path = ?, root_relative_path = ?, volume_id = ?, volume_label = ?,
      removable = ?, status = 'online', last_scan_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    sourceName,
    sourcePath,
    volumeInfo?.rootRelativePath || getRootRelativePath(sourcePath),
    volumeInfo?.volumeId || null,
    volumeInfo?.volumeLabel || null,
    volumeInfo?.removable ? 1 : /^[A-Z]:\\/i.test(sourcePath) && sourcePath[0].toUpperCase() !== 'C' ? 1 : 0,
    sourceId,
  )
} else {
  upsertSource.run(
    sourceId,
    sourceName,
    sourcePath,
    volumeInfo?.rootRelativePath || getRootRelativePath(sourcePath),
    volumeInfo?.volumeId || null,
    volumeInfo?.volumeLabel || null,
    volumeInfo?.removable ? 1 : /^[A-Z]:\\/i.test(sourcePath) && sourcePath[0].toUpperCase() !== 'C' ? 1 : 0,
    'online',
  )
}

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
const deleteSubtitleTracks = database.prepare('DELETE FROM subtitle_tracks WHERE media_item_id = ?')
const insertSubtitleTrack = database.prepare(`
  INSERT INTO subtitle_tracks (id, media_item_id, language, label, provider, relative_path, embedded)
  VALUES (?, ?, ?, ?, 'manual', ?, 0)
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
  for (const { file, item } of classifiedFiles) {
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
    const kind = item.tipo === 'serie' || item.tipo === 'especial' ? 'episode' : item.tipo === 'outro' ? 'other' : 'movie'
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
    deleteSubtitleTracks.run(itemId)
    for (const subtitle of await collectSubtitleTracks(file)) {
      insertSubtitleTrack.run(
        `subtitle-${slugify(`${itemId}-${subtitle.filename}`)}`,
        itemId,
        subtitle.language,
        subtitle.label,
        subtitle.filename,
      )
    }

    if (['serie', 'especial'].includes(item.tipo)) {
      const showTitle = item.pastaSerie || path.basename(path.dirname(file))
      const showId = `show-${slugify(showTitle)}`
      const seasonNumber = item.tipo === 'especial' ? 0 : item.temporada
      const episodeNumber = item.tipo === 'especial' ? specialNumbers.get(file) : item.episodio
      const seasonId = `${showId}-season-${seasonNumber}`
      insertShow.run(showId, showTitle, normalize(showTitle))
      insertSeason.run(seasonId, showId, seasonNumber)
      insertEpisode.run(
        `${itemId}-episode`,
        seasonId,
        itemId,
        episodeNumber,
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

function ensureProfileProgressTable() {
  const columns = database.prepare('PRAGMA table_info(watch_progress)').all().map((column) => column.name)
  if (!columns.length || columns.includes('profile_id')) return

  database.exec(`
    ALTER TABLE watch_progress RENAME TO watch_progress_legacy;
    CREATE TABLE watch_progress (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
      duration_seconds INTEGER,
      watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (profile_id, media_item_id)
    );
    INSERT INTO watch_progress (profile_id, media_item_id, position_seconds, duration_seconds, watched, updated_at)
    SELECT 'profile-savio', media_item_id, position_seconds, duration_seconds, watched, updated_at
    FROM watch_progress_legacy;
    DROP TABLE watch_progress_legacy;
  `)
}

function ensureProfileRatingsTable() {
  const columns = database.prepare('PRAGMA table_info(ratings)').all().map((column) => column.name)
  if (!columns.length || columns.includes('profile_id')) return

  database.exec(`
    ALTER TABLE ratings RENAME TO ratings_legacy;
    CREATE TABLE ratings (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      media_item_id TEXT REFERENCES media_items(id) ON DELETE CASCADE,
      show_id TEXT REFERENCES shows(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
      review TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((media_item_id IS NULL) != (show_id IS NULL)),
      UNIQUE(profile_id, media_item_id),
      UNIQUE(profile_id, show_id)
    );
    INSERT INTO ratings (id, profile_id, media_item_id, show_id, score, review, updated_at)
    SELECT id, 'profile-savio', media_item_id, show_id, score, review, updated_at
    FROM ratings_legacy;
    DROP TABLE ratings_legacy;
  `)
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
