import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { findMountedSource } from './volume-info.mjs'

const databasePath = path.resolve('data/catalog.db')
const expectedSchema = {
  schema_migrations: ['version', 'applied_at'],
  media_sources: ['id', 'name', 'root_path', 'root_relative_path', 'volume_id', 'volume_label', 'removable', 'status', 'last_scan_at'],
  media_items: ['id', 'source_id', 'relative_path', 'title', 'kind', 'classification_status', 'deleted_at', 'extension', 'exists_on_disk'],
  shows: ['id', 'title', 'normalized_title'],
  seasons: ['id', 'show_id', 'season_number'],
  episodes: ['id', 'season_id', 'media_item_id', 'episode_number', 'title'],
  artwork: ['id', 'movie_id', 'show_id', 'artwork_type', 'local_path', 'source'],
  subtitle_tracks: ['id', 'media_item_id', 'language', 'label', 'provider', 'relative_path', 'embedded'],
  profiles: ['id', 'name', 'avatar_key'],
  ratings: ['id', 'profile_id', 'score', 'review'],
  import_jobs: ['id', 'source_id', 'status', 'input_path'],
}

const issues = []
const warnings = []
let database

console.log('Savano Cine — diagnóstico operacional')
console.log('====================================')
console.log('Modo somente leitura: nenhum dado ou arquivo físico será alterado.')

if (!existsSync(databasePath)) {
  fail('SQLite', 'banco não encontrado')
} else {
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    checkSchema(database)
    if (!issues.length) ok('SQLite', 'banco encontrado e schema compatível')
  } catch {
    fail('SQLite', 'banco ilegível ou schema inválido')
  }
}

if (database && !issues.length) {
  checkSources(database)
  checkCatalog(database)
  checkArtwork(database)
  checkSubtitles(database)
}

checkRuntimes()

if (database) database.close()

console.log('')
if (issues.length) {
  console.log(`Resultado: FALHA (${issues.length} problema(s) bloqueante(s)).`)
  process.exitCode = 2
} else if (warnings.length) {
  console.log(`Resultado: ATENÇÃO (${warnings.length} aviso(s)); o catálogo está acessível.`)
  process.exitCode = 1
} else {
  console.log('Resultado: OK.')
  process.exitCode = 0
}

function checkSchema(db) {
  const tables = new Set(db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name))

  for (const [table, columns] of Object.entries(expectedSchema)) {
    if (!tables.has(table)) {
      issues.push(`tabela ausente: ${table}`)
      continue
    }
    const actualColumns = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name))
    for (const column of columns) {
      if (!actualColumns.has(column)) issues.push(`coluna ausente: ${table}.${column}`)
    }
  }
}

function checkSources(db) {
  const sources = db.prepare(`
    SELECT id, name, root_path, root_relative_path, volume_id, status
    FROM media_sources
    ORDER BY name
  `).all()

  if (!sources.length) {
    warn('Fontes', 'nenhuma fonte cadastrada')
    return
  }

  let online = 0
  for (const source of sources) {
    const mounted = source.volume_id && source.root_relative_path
      ? findMountedSource(source)
      : null
    const isOnline = Boolean((mounted && existsSync(mounted.rootPath)) || existsSync(source.root_path))
    if (isOnline) online += 1
    const status = isOnline ? 'online' : 'offline'
    console.log(`  • ${source.name}: ${status}`)
  }
  if (online === sources.length) ok('Fontes', `${sources.length} cadastrada(s), todas online`)
  else warn('Fontes', `${sources.length} cadastrada(s): ${online} online, ${sources.length - online} offline`)
}

function checkCatalog(db) {
  const count = (query) => db.prepare(query).get().count
  const movies = count(`
    SELECT COUNT(*) AS count FROM media_items
    WHERE kind = 'movie' AND deleted_at IS NULL AND classification_status != 'ignored'
  `)
  const series = count(`
    SELECT COUNT(*) AS count FROM shows
    WHERE EXISTS (
      SELECT 1 FROM episodes e
      JOIN media_items m ON m.id = e.media_item_id
      WHERE e.season_id IN (SELECT id FROM seasons WHERE seasons.show_id = shows.id)
        AND m.deleted_at IS NULL AND m.classification_status != 'ignored'
    )
  `)
  const review = count(`
    SELECT COUNT(*) AS count FROM media_items
    WHERE classification_status = 'review' AND deleted_at IS NULL
  `)
  ok('Catálogo', `${movies} filme(s), ${series} série(s), ${review} item(ns) em revisão`)
}

function checkArtwork(db) {
  const registered = db.prepare(`
    SELECT COUNT(*) AS count FROM artwork
    WHERE source = 'local' AND local_path IS NOT NULL
  `).get().count
  const available = db.prepare(`
    SELECT local_path FROM artwork
    WHERE source = 'local' AND local_path IS NOT NULL
  `).all().filter((row) => existsSync(path.resolve(row.local_path))).length
  if (registered === available) ok('Artes locais', `${available} registro(s) disponível(is)`)
  else warn('Artes locais', `${available} arquivo(s) disponível(is) de ${registered} registrado(s)`)
}

function checkSubtitles(db) {
  const registered = db.prepare('SELECT COUNT(*) AS count FROM subtitle_tracks').get().count
  const external = db.prepare(`
    SELECT media_item_id AS mediaId, relative_path FROM subtitle_tracks
    WHERE embedded = 0 AND relative_path IS NOT NULL
  `).all()
  const available = external.filter((row) => subtitleExists(db, row.mediaId, row.relative_path)).length
  const embedded = registered - external.length
  if (registered === 0) warn('Legendas', 'nenhuma faixa registrada')
  else if (available === external.length) ok('Legendas', `${registered} faixa(s) registrada(s), ${embedded} embutida(s)`)
  else warn('Legendas', `${available} arquivo(s) externo(s) disponível(is) de ${external.length}; ${embedded} embutida(s)`)
}

function subtitleExists(db, mediaId, relativePath) {
  const item = db.prepare(`
    SELECT m.relative_path, s.root_path
    FROM subtitle_tracks t
    JOIN media_items m ON m.id = t.media_item_id
    JOIN media_sources s ON s.id = m.source_id
    WHERE t.media_item_id = ? AND t.relative_path = ?
    LIMIT 1
  `).get(mediaId, relativePath)
  if (!item) return false
  return existsSync(path.join(item.root_path, path.dirname(item.relative_path), relativePath))
}

function checkRuntimes() {
  const runtimes = [
    ['FFmpeg', 'CINE_FFMPEG_PATH', 'ffmpeg.exe'],
    ['FFprobe', 'CINE_FFPROBE_PATH', 'ffprobe.exe'],
    ['VLC', 'CINE_VLC_PATH', 'vlc.exe'],
  ]
  for (const [label, environmentVariable, command] of runtimes) {
    const configured = process.env[environmentVariable]?.trim()
    const available = configured
      ? isFile(configured)
      : Boolean(spawnSync('where.exe', [command], { stdio: 'ignore', windowsHide: true }).status === 0)
    if (available) ok(label, configured ? 'disponível (configuração local)' : 'disponível no PATH')
    else warn(label, 'não encontrado')
  }
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function ok(label, message) {
  console.log(`✓ ${label}: ${message}`)
}

function warn(label, message) {
  warnings.push(`${label}: ${message}`)
  console.log(`! ${label}: ${message}`)
}

function fail(label, message) {
  issues.push(`${label}: ${message}`)
  console.log(`✗ ${label}: ${message}`)
}
