import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

const PRIVATE_BLOCKLIST = new BlockList()
PRIVATE_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4')
PRIVATE_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4')
PRIVATE_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4')
PRIVATE_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4')
PRIVATE_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4')
PRIVATE_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4')
PRIVATE_BLOCKLIST.addAddress('::1', 'ipv6')
PRIVATE_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6')
PRIVATE_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6')

export function isPrivateIp(ip) {
  const clean = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!clean) return true
  if (clean.startsWith('::ffff:')) {
    const v4 = clean.slice(7)
    if (isIP(v4) === 4) return PRIVATE_BLOCKLIST.check(v4, 'ipv4')
  }
  const family = isIP(clean)
  if (family === 4) return PRIVATE_BLOCKLIST.check(clean, 'ipv4')
  if (family === 6) return PRIVATE_BLOCKLIST.check(clean, 'ipv6')
  return false
}

export function isPrivateHostname(hostname) {
  const hostLower = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (
    !hostLower ||
    hostLower === 'localhost' ||
    hostLower === '0.0.0.0' ||
    hostLower === '::1' ||
    hostLower.endsWith('.local') ||
    hostLower.endsWith('.internal')
  ) {
    return true
  }
  if (isIP(hostLower)) {
    return isPrivateIp(hostLower)
  }
  return false
}

export async function assertSafeExternalUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || ''))
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Protocolo não permitido.')
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Host privado não permitido.')
  }
  if (!isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) {
    try {
      const records = await lookup(parsed.hostname, { all: true })
      if (records.some((r) => isPrivateIp(r.address))) {
        throw new Error('Destino resolve para IP privado.')
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('privado')) throw err
    }
  }
  return parsed
}

export async function fetchSafeWithRedirects(rawUrl, init = {}, maxHops = 5) {
  let currentUrl = (await assertSafeExternalUrl(rawUrl)).toString()
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const res = await fetch(currentUrl, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      const nextParsed = new URL(location, currentUrl)
      await assertSafeExternalUrl(nextParsed.toString())
      currentUrl = nextParsed.toString()
      continue
    }
    return res
  }
  throw new Error('Limite de redirecionamentos excedido.')
}

export function isTrustedOrigin(origin) {
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const h = parsed.hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
    if (h.endsWith('.trycloudflare.com')) return true
    if (/^192\.168\./.test(h) || /^10\./.test(h)) return true
    const m172 = h.match(/^172\.(\d+)\./)
    if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true
    return false
  } catch {
    return false
  }
}
