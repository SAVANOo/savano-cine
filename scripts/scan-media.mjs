import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const mediaExtensions = new Set(['.avi', '.mkv', '.mp4', '.mov', '.rm', '.rmvb', '.webm'])
export { collectMediaFiles, classifyMedia }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , sourceArg, ...flags] = process.argv
  const source = sourceArg ? path.resolve(sourceArg) : process.cwd()
  const limitFlagIndex = flags.indexOf('--limit')
  const limit = limitFlagIndex >= 0 ? Number(flags[limitFlagIndex + 1]) : Infinity

  if (!sourceArg) {
    console.error('Uso: npm run scan -- <pasta> [--limit <quantidade>]')
    process.exitCode = 1
  } else {
    const files = await collectMediaFiles(source)
    const catalog = files.slice(0, Number.isFinite(limit) ? limit : undefined).map((file) => classifyMedia(file, source))

    console.table(catalog)
    console.log(`\n${catalog.length} item(ns) exibido(s) de ${files.length} arquivo(s) de mídia encontrado(s).`)
  }
}

async function collectMediaFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectMediaFiles(entryPath)))
      continue
    }

    if (mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

function classifyMedia(filePath, sourceRoot) {
  const relativePath = path.relative(sourceRoot, filePath)
  const extension = path.extname(filePath).toLowerCase()
  const basename = path.basename(filePath, extension)
  const specialClassification = classifySpecialMedia(basename, relativePath)

  if (specialClassification) return specialClassification

  const episode = findEpisodePattern(basename) ?? findEpisodeFromSeasonFolder(basename, relativePath)

  if (!episode) {
    return {
      tipo: 'filme',
      titulo: cleanTitle(basename),
      temporada: '',
      episodio: '',
      formato: extension.slice(1),
      caminho: relativePath,
    }
  }

  function classifySpecialMedia(filename, relativePath) {
    const normalizedPath = normalizeSegment(relativePath)
    const normalizedFilename = normalizeSegment(filename)

    if (/(^|[\\/])(a energia do homem|curso|modulo|módulo)([\\/]|$)/i.test(normalizedPath)) {
      return {
        tipo: 'outro',
        titulo: cleanTitle(filename),
        formato: path.extname(filename).slice(1).toLowerCase(),
        caminho: relativePath,
        motivo: 'collection',
      }
    }

    if (/^(1xbet|bludv|comando|trailer|lucas firmo|www\.)/i.test(normalizedFilename)) {
      return {
        tipo: 'outro',
        titulo: cleanTitle(filename),
        formato: path.extname(filename).slice(1).toLowerCase(),
        caminho: relativePath,
        motivo: 'promotional',
      }
    }

    return null
  }

  return {
    tipo: 'serie',
    titulo: cleanEpisodeTitle(basename, episode),
    temporada: episode.season,
    episodio: episode.number,
    formato: extension.slice(1),
    caminho: relativePath,
    pastaSerie: inferSeriesFolder(relativePath),
  }
}

function findEpisodePattern(filename) {
  const patterns = [
    { regex: /(?:^|[\s._-])S(\d{1,2})E(\d{1,3})(?:[\s._-]|$)/i, offset: 0 },
    { regex: /(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?:[\s._-]|$)/i, offset: 0 },
    { regex: /(?:^|[\s_-])(\d{1,2})\.(\d{1,3})(?:\s*[-:]|\s+)/, offset: 0 },
  ]

  for (const pattern of patterns) {
    const match = pattern.regex.exec(filename)
    if (match) {
      return {
        season: Number(match[1]),
        number: Number(match[2]),
        index: match.index + match[0].length,
        prefixEnd: match.index,
      }
    }
  }

  return null
}

function findEpisodeFromSeasonFolder(filename, relativePath) {
  const seasonMatch = relativePath.match(/(?:^|[\\/])[^\\/]*?(\d{1,2})[ªº°]?[.\s_-]*Temporada[^\\/]*(?:[\\/]|$)/i)
    ?? relativePath.match(/(?:^|[\\/])[^\\/]*?Season[\s._-]*(\d{1,2})[^\\/]*(?:[\\/]|$)/i)
  const episodeMatch = /^(\d{1,3})[\s._-]+/.exec(filename)

  if (!seasonMatch || !episodeMatch) return null

  return {
    season: Number(seasonMatch[1]),
    number: Number(episodeMatch[1]),
    index: episodeMatch[0].length,
    prefixEnd: 0,
  }
}

function inferSeriesFolder(relativePath) {
  const segments = relativePath.split(path.sep)
  const seasonIndex = segments.findIndex((segment) => /(?:\d{1,2}[ªº°]?\s*Temporada|Season[\s._-]*\d{1,2})/i.test(segment))

  if (seasonIndex > 0) {
    const categoryNames = new Set(['animações', 'animacoes', 'filmes', 'series', 'séries'])
    const candidateIndex = categoryNames.has(normalizeSegment(segments[0])) ? 1 : 0
    return segments[candidateIndex] || segments[seasonIndex - 1]
  }

  return segments[0]
}

function normalizeSegment(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function cleanTitle(value) {
  return value
    .replace(/\b(720p|1080p|2160p|WEB[- ]?DL|BluRay|Dublado|Dual|NACIONAL)\b/gi, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-\s]+$/, '')
    .trim()
}

function cleanEpisodeTitle(filename, episode) {
  const prefix = cleanTitle(filename.slice(0, episode.prefixEnd))
  const suffix = cleanTitle(filename.slice(episode.index))

  return prefix || suffix
}
