import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const INFO_HASH_RE = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mkv|avi|mov)$/i
const TRANSCODE_EXT_RE = /\.(mkv|avi|mov|flv|wmv)$/i
const TORRENT_TMP_ROOT = path.join(os.tmpdir(), 'savano-cine-torrents')
const IDLE_CLEANUP_MS = 5 * 60 * 1000

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'wss://tracker.openwebtorrent.com',
]

let clientPromise = null
const activeTorrents = new Map()

export function isValidInfoHash(infoHash) {
  return typeof infoHash === 'string' && INFO_HASH_RE.test(infoHash.trim())
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('webtorrent').then(({ default: WebTorrent }) => {
      mkdirSync(TORRENT_TMP_ROOT, { recursive: true })
      const client = new WebTorrent()
      client.on('error', () => {
        // prevent unhandled client error crashes
      })
      return client
    })
  }
  return clientPromise
}

function touchTorrent(key) {
  const entry = activeTorrents.get(key)
  if (!entry) return
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entry.idleTimer = setTimeout(() => {
    void stopTorrentStream(key)
  }, IDLE_CLEANUP_MS)
  entry.idleTimer.unref?.()
}

async function ensureTorrent(infoHash) {
  const key = infoHash.trim().toLowerCase()
  if (!isValidInfoHash(key)) {
    throw new Error('infoHash inválido.')
  }
  const existing = activeTorrents.get(key)
  if (existing) {
    touchTorrent(key)
    return existing.readyPromise
  }

  const client = await getClient()
  const downloadPath = path.join(TORRENT_TMP_ROOT, key)
  mkdirSync(downloadPath, { recursive: true })

  const magnet = `magnet:?xt=urn:btih:${key}&${DEFAULT_TRACKERS.map((tr) => `tr=${encodeURIComponent(tr)}`).join('&')}`

  const entry = {
    torrent: null,
    downloadPath,
    idleTimer: null,
    readyPromise: null,
  }

  entry.readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Tempo esgotado aguardando metadados do torrent (sem peers disponíveis).'))
    }, 25000)

    const torrent = client.add(magnet, { path: downloadPath }, (readyTorrent) => {
      clearTimeout(timeout)
      resolve(readyTorrent)
    })
    entry.torrent = torrent
    torrent.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  activeTorrents.set(key, entry)
  touchTorrent(key)

  try {
    return await entry.readyPromise
  } catch (err) {
    await stopTorrentStream(key)
    throw err
  }
}

function pickTorrentFile(torrent, fileIdx) {
  const files = torrent.files || []
  if (files.length === 0) return null
  if (Number.isInteger(fileIdx) && fileIdx >= 0 && fileIdx < files.length) {
    return files[fileIdx]
  }
  const videoFiles = files.filter((file) => VIDEO_EXT_RE.test(file.name))
  const pool = videoFiles.length > 0 ? videoFiles : files
  return [...pool].sort((a, b) => b.length - a.length)[0]
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.webm') return 'video/webm'
  return 'video/mp4'
}

/** Probes the first 2MB of a torrent video file to pick Portuguese > English > first audio stream. */
async function pickPreferredTorrentAudioMap(file) {
  return await new Promise((resolve) => {
    const fallback = '0:a:0?'
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        probeStream?.destroy()
        ffprobeProc?.kill('SIGTERM')
      } catch {
        // ignore
      }
      finish(fallback)
    }, 1800)
    timer.unref?.()

    const maxBytes = Math.min(Math.max(file.length - 1, 0), 2 * 1024 * 1024)
    const probeStream = file.createReadStream({ start: 0, end: maxBytes })
    const ffprobeProc = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=index,codec_type:stream_tags=language,title', '-of', 'json', '-i', 'pipe:0'],
      { windowsHide: true },
    )

    let stdout = ''
    ffprobeProc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    ffprobeProc.on('error', () => {
      clearTimeout(timer)
      probeStream.destroy()
      finish(fallback)
    })
    ffprobeProc.on('close', () => {
      clearTimeout(timer)
      probeStream.destroy()
      try {
        const parsed = JSON.parse(stdout)
        const audioStreams = (parsed.streams || []).filter((s) => s.codec_type === 'audio')
        if (audioStreams.length === 0) return finish(fallback)
        const scoreStream = (s) => {
          const lang = String(s.tags?.language || '').toLowerCase()
          const title = String(s.tags?.title || '').toLowerCase()
          if (/^(por|pt|pt-br|pob|bra)$/.test(lang) || /portugu|brasil|brazil|dublado/.test(title)) return 3
          if (/^(eng|en)$/.test(lang) || /english|ingl/.test(title)) return 2
          if (/^(rus|ru)$/.test(lang) || /russ/.test(title)) return 0
          return 1
        }
        const best = [...audioStreams].sort((a, b) => scoreStream(b) - scoreStream(a))[0]
        finish(best && Number.isInteger(best.index) ? `0:${best.index}` : fallback)
      } catch {
        finish(fallback)
      }
    })
    probeStream.on('error', () => {
      clearTimeout(timer)
      finish(fallback)
    })
    probeStream.pipe(ffprobeProc.stdin)
  })
}

export async function getTorrentStatus(infoHash) {
  const key = String(infoHash || '').trim().toLowerCase()
  if (!isValidInfoHash(key)) return null
  const entry = activeTorrents.get(key)
  if (!entry?.torrent) {
    return { infoHash: key, active: false, peers: 0, progress: 0, downloadSpeed: 0 }
  }
  const t = entry.torrent
  return {
    infoHash: key,
    active: true,
    name: t.name || key,
    peers: t.numPeers || 0,
    progress: Number((t.progress || 0).toFixed(4)),
    downloadSpeed: t.downloadSpeed || 0,
  }
}

export async function stopTorrentStream(infoHash) {
  const key = String(infoHash || '').trim().toLowerCase()
  const entry = activeTorrents.get(key)
  if (!entry) return false
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  activeTorrents.delete(key)
  try {
    if (entry.torrent && !entry.torrent.destroyed) {
      await new Promise((resolve) => entry.torrent.destroy({ destroyStore: true }, resolve))
    }
  } catch {
    // ignore cleanup errors
  }
  try {
    rmSync(entry.downloadPath, { recursive: true, force: true })
  } catch {
    // ignore temp removal errors
  }
  return true
}

export async function serveTorrentStream(request, response, { infoHash, fileIdx = null, raw = false }) {
  const torrent = await ensureTorrent(infoHash)
  const file = pickTorrentFile(torrent, fileIdx)
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'Nenhum arquivo de vídeo encontrado no torrent.' }))
    return
  }

  file.select()
  touchTorrent(infoHash.trim().toLowerCase())

  const needsTranscode = !raw && TRANSCODE_EXT_RE.test(file.name)
  if (needsTranscode) {
    const preferredAudioMap = await pickPreferredTorrentAudioMap(file)
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
    })
    const input = file.createReadStream()
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map',
        '0:v:0',
        '-map',
        preferredAudioMap,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-movflags',
        'frag_keyframe+empty_moov',
        '-f',
        'mp4',
        'pipe:1',
      ],
      { windowsHide: true },
    )
    input.pipe(ff.stdin)
    ff.stdout.pipe(response)
    const cleanup = () => {
      input.destroy()
      if (!ff.killed) ff.kill('SIGTERM')
    }
    request.on('close', cleanup)
    ff.on('error', () => {
      cleanup()
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: 'Falha ao transcodificar stream torrent.' }))
      }
    })
    return
  }

  const total = file.length
  const range = request.headers.range
  const mime = getMimeType(file.name)

  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(String(range))
    if (!match) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}` })
      response.end()
      return
    }
    const start = Number(match[1])
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
    if (start >= total || start > end) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}` })
      response.end()
      return
    }
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    })
    const stream = file.createReadStream({ start, end })
    stream.pipe(response)
    request.on('close', () => stream.destroy())
    return
  }

  response.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': total,
    'Content-Type': mime,
  })
  const stream = file.createReadStream()
  stream.pipe(response)
  request.on('close', () => stream.destroy())
}
