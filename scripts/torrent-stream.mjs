import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const INFO_HASH_RE = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mkv|avi|mov)$/i
const TRANSCODE_EXT_RE = /\.(mkv|avi|mov|flv|wmv)$/i
const TORRENT_TMP_ROOT = path.join(os.tmpdir(), 'savano-cine-torrents')
const IDLE_CLEANUP_MS = 10 * 60 * 1000

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.dump.cl:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://retracker01-msk-virt.corbina.net:80/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.gbitt.info:80/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
]

let clientPromise = null
const activeTorrents = new Map()
let torrentLimits = { maxConns: 55, downloadLimitKbps: 0, uploadLimitKbps: 0 }

export function getTorrentLimits() {
  return { ...torrentLimits }
}

export async function setTorrentLimits({ maxConns, downloadLimitKbps, uploadLimitKbps }) {
  if (Number.isFinite(Number(maxConns)) && Number(maxConns) >= 5) {
    torrentLimits.maxConns = Math.min(200, Math.floor(Number(maxConns)))
  }
  if (Number.isFinite(Number(downloadLimitKbps)) && Number(downloadLimitKbps) >= 0) {
    torrentLimits.downloadLimitKbps = Math.floor(Number(downloadLimitKbps))
  }
  if (Number.isFinite(Number(uploadLimitKbps)) && Number(uploadLimitKbps) >= 0) {
    torrentLimits.uploadLimitKbps = Math.floor(Number(uploadLimitKbps))
  }
  if (clientPromise) {
    try {
      const client = await clientPromise
      if (typeof client.throttleDownload === 'function') {
        client.throttleDownload(torrentLimits.downloadLimitKbps > 0 ? torrentLimits.downloadLimitKbps * 1024 : -1)
      }
      if (typeof client.throttleUpload === 'function') {
        client.throttleUpload(torrentLimits.uploadLimitKbps > 0 ? torrentLimits.uploadLimitKbps * 1024 : -1)
      }
    } catch {
      // ignore if client not ready
    }
  }
  return getTorrentLimits()
}

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

/** Deselects all other files in multi-file torrents so bandwidth focuses exclusively on the active video. */
function selectExclusiveTorrentFile(torrent, file) {
  try {
    if (Array.isArray(torrent.pieces) && torrent.pieces.length > 0) {
      torrent.deselect(0, torrent.pieces.length - 1, false)
    }
    file.select(1)
    // For MP4 files, prioritize the tail (~1MB) too so the moov atom loads without stalling seeks
    if (/\.mp4$/i.test(file.name) && file.length > 4 * 1024 * 1024) {
      const tailStream = file.createReadStream({ start: file.length - 1024 * 1024, end: file.length - 1 })
      tailStream.on('data', () => undefined)
      tailStream.on('error', () => undefined)
      setTimeout(() => tailStream.destroy(), 4000).unref?.()
    }
  } catch {
    file.select()
  }
}

export async function prepareTorrentStream(infoHash, fileIdx = null) {
  const torrent = await ensureTorrent(infoHash)
  const file = pickTorrentFile(torrent, fileIdx)
  if (!file) return { ok: false, peers: torrent.numPeers || 0, downloaded: 0 }
  selectExclusiveTorrentFile(torrent, file)
  touchTorrent(infoHash.trim().toLowerCase())
  return {
    ok: true,
    name: file.name,
    length: file.length,
    peers: torrent.numPeers || 0,
    downloaded: file.downloaded || 0,
    downloadSpeed: torrent.downloadSpeed || 0,
  }
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.webm') return 'video/webm'
  return 'video/mp4'
}

/** Probes the first 2MB of a torrent video file to return duration, audio tracks and preferred audio map. */
async function probeTorrentFileMetadata(file) {
  return await new Promise((resolve) => {
    const fallback = { duration: 0, audio: [], preferredAudioMap: '0:a:0?' }
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
    }, 2000)
    timer.unref?.()

    const maxBytes = Math.min(Math.max(file.length - 1, 0), 2 * 1024 * 1024)
    const probeStream = file.createReadStream({ start: 0, end: maxBytes })
    probeStream.on('error', () => undefined)
    const ffprobeProc = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=index,codec_type:stream_tags=language,title',
        '-of',
        'json',
        '-i',
        'pipe:0',
      ],
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
        const dur = Number(parsed?.format?.duration)
        const duration = Number.isFinite(dur) && dur > 0 ? dur : 0
        const audioStreams = (parsed.streams || []).filter((s) => s.codec_type === 'audio')
        if (audioStreams.length === 0) return finish({ duration, audio: [], preferredAudioMap: '0:a:0?' })
        const scoreStream = (s) => {
          const lang = String(s.tags?.language || '').toLowerCase()
          const title = String(s.tags?.title || '').toLowerCase()
          if (/^(por|pt|pt-br|pob|bra)$/.test(lang) || /portugu|brasil|brazil|dublado/.test(title)) return 3
          if (/^(eng|en)$/.test(lang) || /english|ingl/.test(title)) return 2
          if (/^(rus|ru)$/.test(lang) || /russ/.test(title)) return 0
          return 1
        }
        const best = [...audioStreams].sort((a, b) => scoreStream(b) - scoreStream(a))[0]
        const audio = audioStreams.map((s) => ({
          index: s.index,
          language: String(s.tags?.language || 'und'),
          title: String(s.tags?.title || s.tags?.language || `Faixa ${s.index}`),
        }))
        finish({
          duration,
          audio,
          preferredAudioMap: best && Number.isInteger(best.index) ? `0:${best.index}` : '0:a:0?',
        })
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

export async function probeTorrentInfo(infoHash, fileIdx = null) {
  const torrent = await ensureTorrent(infoHash)
  const file = pickTorrentFile(torrent, fileIdx)
  if (!file) return null
  const info = await probeTorrentFileMetadata(file)
  return { duration: info.duration, audio: info.audio, subtitles: [] }
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

export async function serveTorrentStream(
  request,
  response,
  { infoHash, fileIdx = null, raw = false, audioStream = null, startSec = 0 },
) {
  const torrent = await ensureTorrent(infoHash)
  const file = pickTorrentFile(torrent, fileIdx)
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'Nenhum arquivo de vídeo encontrado no torrent.' }))
    return
  }

  selectExclusiveTorrentFile(torrent, file)
  touchTorrent(infoHash.trim().toLowerCase())

  const needsTranscode = !raw && TRANSCODE_EXT_RE.test(file.name)
  if (needsTranscode) {
    const requestedAudio =
      audioStream !== null && /^\d{1,2}$/.test(String(audioStream))
        ? `0:${Number(audioStream)}`
        : (await probeTorrentFileMetadata(file)).preferredAudioMap
    const startOffset = Number.isFinite(Number(startSec)) && Number(startSec) > 1 ? Math.floor(Number(startSec)) : 0
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
    })
    const input = file.createReadStream()
    const ffArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-probesize',
      '500000',
      '-analyzeduration',
      '1000000',
      '-fflags',
      '+genpts',
      '-i',
      'pipe:0',
    ]
    if (startOffset > 0) {
      ffArgs.push('-ss', String(startOffset))
    }
    ffArgs.push(
      '-map',
      '0:v:0',
      '-map',
      requestedAudio,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    )
    const ff = spawn('ffmpeg', ffArgs, { windowsHide: true })
    input.on('error', () => undefined)
    ff.stdin.on('error', () => undefined)
    ff.stdout.on('error', () => undefined)
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
    stream.on('error', () => undefined)
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
  stream.on('error', () => undefined)
  stream.pipe(response)
  request.on('close', () => stream.destroy())
}
