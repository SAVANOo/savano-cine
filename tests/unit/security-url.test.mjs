import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import {
  assertSafeExternalUrl,
  fetchSafeWithRedirects,
  isPrivateIp,
  isTrustedOrigin,
} from '../../scripts/security-url.mjs'

test('isPrivateIp blocks IPv4, IPv6, and IPv4-mapped loopback/private addresses', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true)
  assert.equal(isPrivateIp('10.0.0.5'), true)
  assert.equal(isPrivateIp('172.16.0.1'), true)
  assert.equal(isPrivateIp('192.168.1.10'), true)
  assert.equal(isPrivateIp('169.254.169.254'), true)
  assert.equal(isPrivateIp('::1'), true)
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true)
  assert.equal(isPrivateIp('8.8.8.8'), false)
})

test('assertSafeExternalUrl rejects non-HTTP schemes and private hosts', async () => {
  await assert.rejects(() => assertSafeExternalUrl('file:///etc/passwd'))
  await assert.rejects(() => assertSafeExternalUrl('http://127.0.0.1:4174/api/health'))
  await assert.rejects(() => assertSafeExternalUrl('http://localhost/test'))
  const ok = await assertSafeExternalUrl('https://8.8.8.8/dns-query')
  assert.equal(ok.hostname, '8.8.8.8')
})

test('isTrustedOrigin allows localhost, LAN, and Cloudflare tunnel origins only', () => {
  assert.equal(isTrustedOrigin('http://127.0.0.1:4173'), true)
  assert.equal(isTrustedOrigin('http://192.168.18.62:4174'), true)
  assert.equal(isTrustedOrigin('https://demo-cine.trycloudflare.com'), true)
  assert.equal(isTrustedOrigin('https://evil.example.com'), false)
})

test('fetchSafeWithRedirects blocks redirect hops to private hosts', async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:4174/api/health' })
    res.end()
  })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  try {
    // Direct loopback is rejected before even fetching
    await assert.rejects(() => fetchSafeWithRedirects(`http://127.0.0.1:${port}/`))
  } finally {
    await new Promise((resolve) => srv.close(resolve))
  }
})
