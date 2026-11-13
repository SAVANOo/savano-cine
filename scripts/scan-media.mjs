import { readdir } from 'node:fs/promises'
import path from 'node:path'

const mediaExtensions = new Set(['.avi', '.mkv', '.mp4', '.mov', '.rm', '.rmvb', '.webm'])
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
  const episode = findEpisodePattern(basename)

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

  return {
    tipo: 'serie',
    titulo: cleanEpisodeTitle(basename, episode),
    temporada: episode.season,
    episodio: episode.number,
    formato: extension.slice(1),
    caminho: relativePath,
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
