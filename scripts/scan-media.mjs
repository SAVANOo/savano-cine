import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const mediaExtensions = new Set(['.avi', '.mkv', '.mp4', '.mov', '.rm', '.rmvb', '.webm'])
export { collectMediaFiles, collectSubtitleTracks, classifyMedia, cleanTitle }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , sourceArg, ...flags] = process.argv
  const source = sourceArg ? path.resolve(sourceArg) : process.cwd()
  const limitFlagIndex = flags.indexOf('--limit')
  const limit = limitFlagIndex >= 0 ? Number(flags[limitFlagIndex + 1]) : Infinity

  if (!sourceArg) {
    console.error('Uso: npm run scan -- <pasta> [--limit <quantidade>]')
    process.exitCode = 1
  } else {
    const files = await collectMediaFiles(source)
    const catalog = await Promise.all(files.slice(0, Number.isFinite(limit) ? limit : undefined).map(async (file) => ({
      ...classifyMedia(file, source),
      legendas: await collectSubtitleTracks(file),
    })))

    console.table(catalog)
    console.log(`\n${catalog.length} item(ns) exibido(s) de ${files.length} arquivo(s) de mídia encontrado(s).`)
  }
}

const skippedDirectories = new Set([
  'cine-local',
  'node_modules',
  '.git',
  '.venv',
  '$recycle.bin',
  'system volume information',
])

async function collectMediaFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name.toLowerCase())) continue
      files.push(...(await collectMediaFiles(entryPath)))
      continue
    }

    if (mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function collectSubtitleTracks(mediaPath) {
  const directory = path.dirname(mediaPath)
  const mediaStem = path.basename(mediaPath, path.extname(mediaPath)).toLocaleLowerCase()
  let names
  try {
    names = await readdir(directory)
  } catch {
    return []
  }

  return names
    .filter((name) => /\.(srt|vtt)$/i.test(name))
    .filter((name) => isSubtitleForMedia(name, mediaStem))
    .map((name) => {
      const language = detectSubtitleLanguage(name, mediaStem)
      return {
        filename: name,
        language: language.code,
        label: language.label,
        format: path.extname(name).slice(1).toLowerCase(),
      }
    })
    .sort((left, right) => left.filename.localeCompare(right.filename))
}

function isSubtitleForMedia(filename, mediaStem) {
  const subtitleStem = path.basename(filename, path.extname(filename)).toLocaleLowerCase()
  return subtitleStem === mediaStem
    || subtitleStem.startsWith(`${mediaStem}.`)
    || subtitleStem.startsWith(`${mediaStem} `)
    || subtitleStem.startsWith(`${mediaStem}_`)
    || subtitleStem.startsWith(`${mediaStem}-`)
}

function detectSubtitleLanguage(filename, mediaStem) {
  const subtitleStem = path.basename(filename, path.extname(filename))
  const suffix = subtitleStem.slice(mediaStem.length).replace(/^[\s._-]+/, '')
  const token = suffix.split(/[._\s-]+/)[0]?.toLocaleLowerCase() || ''
  const normalized = normalizeSegment(token)
  const languages = {
    pt: ['pt', 'por', 'br', 'ptbr', 'portugues', 'portuguese'],
    en: ['en', 'eng', 'ingles', 'english'],
    es: ['es', 'spa', 'espanhol', 'espanol', 'spanish'],
    fr: ['fr', 'fra', 'frances', 'french'],
    de: ['de', 'deu', 'alemao', 'german'],
    it: ['it', 'ita', 'italiano', 'italian'],
  }
  for (const [code, aliases] of Object.entries(languages)) {
    if (aliases.includes(normalized)) {
      const regional = suffix.match(/^(?:pt|por)[._ -]?(?:br|pt)$/i)
      return { code: regional ? 'pt-BR' : code, label: code === 'pt' ? 'Português' : code === 'en' ? 'English' : code.toUpperCase() }
    }
  }
  return { code: 'und', label: 'Original' }
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

    if (/(^|[\\/])curtas([\\/]|$)/i.test(normalizedPath)) {
      return {
        tipo: 'especial',
        titulo: cleanTitle(filename),
        temporada: 0,
        episodio: 0,
        formato: extension.slice(1),
        caminho: relativePath,
        motivo: 'special',
        pastaSerie: inferSpecialSeriesFolder(relativePath),
      }
    }

    const moduleMatch = relativePath.match(/(?:^|[\\/])m[oó]dulo\s*(\d{1,2})/i)
    const lessonMatch = basename.match(/^(\d{1,3})(?:[\s._-]|$)/)
    if (moduleMatch && lessonMatch) {
      const segments = relativePath.split(/[\\/]/).filter(Boolean)
      const pastaSerie = segments[0] || 'Curso'
      return {
        tipo: 'serie',
        titulo: `Aula ${Number(lessonMatch[1])}`,
        temporada: Number(moduleMatch[1]),
        episodio: Number(lessonMatch[1]),
        formato: extension.slice(1),
        caminho: relativePath,
        pastaSerie,
      }
    }

    if (/(^|[\W_])(1xbet|dinheiro[_ ]livre)([\W_]|$)|^(trailer|promo[\W_])|^(?:www\.)?(?:comandotorrents|bludv|comando\.to)(?:\.com)?$/i.test(normalizedFilename)) {
      return {
        tipo: 'outro',
        titulo: cleanTitle(filename),
        formato: extension.slice(1),
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
    { regex: /(?:^|[\s._-])S(\d{1,2})E(?:P)?(\d{1,3})(?:[\s._-]|$)/i, offset: 0 },
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
  const segments = relativePath.split(path.sep)
  const seasonSegment = segments.find((segment) => parseSeasonNumber(segment) !== null)
  const episodeMatch = /^(\d{1,3})[\s._-]+/.exec(filename)

  const numericSeasonSegment = segments.find((segment) => /^\d{1,2}$/.test(segment))
  const compactEpisodeMatch = /^(\d{1,2})(\d{2,3})[\s._-]+/.exec(filename)
  if (numericSeasonSegment && compactEpisodeMatch && Number(compactEpisodeMatch[1]) === Number(numericSeasonSegment)) {
    return {
      season: Number(compactEpisodeMatch[1]),
      number: Number(compactEpisodeMatch[2]),
      index: compactEpisodeMatch[0].length,
      prefixEnd: 0,
    }
  }

  if (!seasonSegment || !episodeMatch) return null

  const season = parseSeasonNumber(seasonSegment)
  if (!season) return null

  return {
    season,
    number: Number(episodeMatch[1]),
    index: episodeMatch[0].length,
    prefixEnd: 0,
  }
}

function inferSeriesFolder(relativePath) {
  const segments = relativePath.split(path.sep)
  const seasonIndex = segments.findIndex((segment, index) =>
    parseSeasonNumber(segment) !== null || (index > 0 && /^\d{1,2}$/.test(segment)))

  if (seasonIndex > 0) {
    const categoryNames = new Set(['animações', 'animacoes', 'filmes', 'series', 'séries'])
    const candidateIndex = categoryNames.has(normalizeSegment(segments[0])) ? 1 : 0
    return segments[candidateIndex] || segments[seasonIndex - 1]
  }

  return segments[0]
}

function inferSpecialSeriesFolder(relativePath) {
  const segments = relativePath.split(path.sep)
  const specialIndex = segments.findIndex((segment) => normalizeSegment(segment) === 'curtas')
  if (specialIndex <= 0) return segments[0]

  const categoryNames = new Set(['animações', 'animacoes', 'filmes', 'series', 'séries'])
  const candidateIndex = categoryNames.has(normalizeSegment(segments[0])) ? 1 : 0
  return segments[candidateIndex] || segments[specialIndex - 1]
}

function parseSeasonNumber(segment) {
  const numeric = segment.match(/(\d{1,2})[ªº°]?[.\s_-]*Temporada/i)
    ?? segment.match(/Season[\s._-]*(\d{1,2})/i)
  if (numeric) return Number(numeric[1])

  const ordinal = {
    primeira: 1,
    segunda: 2,
    terceira: 3,
    quarta: 4,
    quinta: 5,
    sexta: 6,
    setima: 7,
    oitava: 8,
    nona: 9,
    decima: 10,
  }
  const word = segment.match(/(primeira|segunda|terceira|quarta|quinta|sexta|s[ée]tima|oitava|nona|d[ée]cima)\s+temporada/i)
  return word ? ordinal[normalizeSegment(word[1])] ?? null : null
}

function normalizeSegment(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function cleanTitle(value) {
  let cleaned = String(value || '')
    .replace(/\((?:www\.|https?:\/\/)[^)]*\)?/gi, '')
    .replace(/\(\s*www\b.*$/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/[-_.\s]*(?:www\.)?(?:bludv(?:com)?|thepiratefilmes|wolverdon[-_.\s]*filmes|comando(?:\.?to)?|comandotorrents|torrentdosfilmes|lapumia(?:filmes)?|andretpf|yts(?:br|\.mx)?|yify|galaxyrg|tgx|dozitos|tdf)(?:\.[a-z]{2,})?\b.*$/i, '')
    .replace(/[-_.\s]+\b(?:www|w|andretpf|wolverdon[-_.\s]*filmes|tdf|bludv(?:com)?|thepiratefilmes|comandotorrents|torrentdosfilmes|lapumia|210gji|johnl|alan[_\s]*680|mld|fb|dozitos|totti9|yify|repack)\b.*$/i, '')
    .replace(/\bby\s+luan\s+harper\b.*$/i, '')
    .replace(/\bby\s+lucas\s+firmo\b.*$/i, '')
    .replace(/\breencode\s+md[-_\s]*rickmaster\b.*$/i, '')
    .replace(/[-\s]+áudio\s*$/i, '')
    .replace(/\b(?:x26[45]|h26[45]|hevc|avc|aac\s*5[._\s]?1|dd\s*5[._\s]?1|ac3|dts|6ch|5[._ ]1|web[- ]?dl|web[- ]?rip|bdrip|dvdrip|brrip|blu[- ]?ray|remux|remastered|fullscreen|proper|repack|imax|amzn|uhd|1400mb|720p|1080p|2160p|dublado|dual|nacional)\b/gi, '')
    .replace(/[._]+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[-,\s]+$/, '')
    .trim()

  // Strip trailing year tokens like "(2016)" or "2016" repeatedly if exposed after tag removal
  for (let i = 0; i < 3; i += 1) {
    const next = cleaned
      .replace(/\s*\(\s*(?:19\d{2}|20\d{2})\s*\)\s*$/g, '')
      .replace(/[-\s!]*(?:19\d{2}|20\d{2})\s*$/g, (match) => (match.includes('!') ? '!' : ''))
      .replace(/\s*\(\s*\d{1,2}\s*\)\s*$/g, '')
      .replace(/[-,\s]+$/, '')
      .trim()
    if (next === cleaned) break
    cleaned = next
  }

  if (/^zumblandia$/i.test(cleaned)) {
    cleaned = 'Zumbilândia'
  }

  return cleaned || String(value || '').trim()
}

function cleanEpisodeTitle(filename, episode) {
  const prefix = cleanTitle(filename.slice(0, episode.prefixEnd))
  const suffix = cleanTitle(filename.slice(episode.index))

  return prefix || suffix
}
