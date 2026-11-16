import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const RECENT_CONNECTIONS = new Map()
let activeTunnelChild = null

/** Records recent client IP / User-Agent activity for the admin Server & Connections tab. */
export function trackClientConnection(request, getClientIp) {
  const ip = getClientIp(request)
  const ua = String(request.headers['user-agent'] || '').slice(0, 120)
  const key = `${ip}::${ua}`
  RECENT_CONNECTIONS.set(key, {
    ip,
    userAgent: ua || 'Desconhecido',
    lastPath: String(request.url || '/').split('?')[0],
    lastSeen: new Date().toISOString(),
  })
  if (RECENT_CONNECTIONS.size > 30) {
    const oldest = RECENT_CONNECTIONS.keys().next().value
    if (oldest) RECENT_CONNECTIONS.delete(oldest)
  }
}

/** Handles /api/admin/* endpoints (connections tracking and Cloudflare tunnel control). */
export async function handleAdminRoutes({ request, response, requestUrl, root, port, send }) {
  if (requestUrl.pathname === '/api/admin/connections' && request.method === 'GET') {
    send(response, 200, Array.from(RECENT_CONNECTIONS.values()).reverse())
    return true
  }

  if (requestUrl.pathname === '/api/admin/tunnel/start' && request.method === 'POST') {
    const cloudflaredExe = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
    if (!existsSync(cloudflaredExe)) {
      send(response, 404, { error: 'cloudflared não instalado neste computador.' })
      return true
    }
    const tunnelFile = path.resolve(root, '..', 'data', 'tunnel-url.txt')
    if (activeTunnelChild && !activeTunnelChild.killed) {
      const existingUrl = existsSync(tunnelFile) ? readFileSync(tunnelFile, 'utf8').trim() : ''
      send(response, 200, { running: true, tunnelUrl: existingUrl })
      return true
    }
    const child = spawn(cloudflaredExe, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    activeTunnelChild = child
    const onChunk = (chunk) => {
      const text = chunk.toString('utf8')
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m) {
        try {
          mkdirSync(path.dirname(tunnelFile), { recursive: true })
          writeFile(tunnelFile, m[0], 'utf8').catch(() => undefined)
        } catch {
          // ignore
        }
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('exit', () => {
      if (activeTunnelChild === child) activeTunnelChild = null
    })
    await new Promise((r) => setTimeout(r, 2500))
    const tunnelUrl = existsSync(tunnelFile) ? readFileSync(tunnelFile, 'utf8').trim() : ''
    send(response, 200, { running: true, tunnelUrl })
    return true
  }

  if (requestUrl.pathname === '/api/admin/tunnel/stop' && request.method === 'POST') {
    if (activeTunnelChild && !activeTunnelChild.killed) {
      activeTunnelChild.kill()
      activeTunnelChild = null
    }
    send(response, 200, { running: false })
    return true
  }

  return false
}
