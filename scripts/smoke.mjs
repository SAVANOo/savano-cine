const baseUrl = (process.env.CINE_API_URL || 'http://127.0.0.1:4174').replace(/\/+$/, '')
const checks = []
let pinCookie = ''

async function ensurePinCookie() {
  if (pinCookie) return
  const res = await fetch(`${baseUrl}/api/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: process.env.CINE_ACCESS_PIN || '4321' }),
    signal: AbortSignal.timeout(5000),
  })
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/sc_pin_ok=[^;]+/)
  if (match) pinCookie = match[0]
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`
  try {
    await ensurePinCookie()
    const headers = {
      ...(options.headers || {}),
      ...(pinCookie ? { Cookie: pinCookie } : {}),
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...options, headers })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { response, body }
  } catch (error) {
    const reason = error?.cause?.code || error?.code || error?.message || String(error)
    throw new Error(`API indisponível em ${baseUrl}: ${reason}`)
  }
}

async function check(name, path, assertion) {
  try {
    const result = await request(path)
    assertion(result)
    checks.push(`PASS ${name}`)
    return result.body
  } catch (error) {
    checks.push(`FAIL ${name}: ${error.message}`)
    throw error
  }
}

function expectStatus(result, status) {
  if (result.response.status !== status) {
    throw new Error(`esperado HTTP ${status}, recebido HTTP ${result.response.status}`)
  }
}

function expectJson(result) {
  if (result.body === null || typeof result.body !== 'object') {
    throw new Error('resposta não é JSON')
  }
}

function expectNoAbsolutePath(value) {
  const serialized = JSON.stringify(value)
  if (/(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\/(?:Users|home|mnt)\//i.test(serialized)) {
    throw new Error('resposta expõe caminho físico')
  }
}

function expectArray(result) {
  expectStatus(result, 200)
  if (!Array.isArray(result.body)) throw new Error('resposta não é uma lista')
}

try {
  await check('health', '/api/health', (result) => {
    expectStatus(result, 200)
    if (result.body?.status !== 'ok') throw new Error('status não é ok')
  })

  await check('capabilities', '/api/player/capabilities', (result) => {
    expectStatus(result, 200)
    expectJson(result)
    for (const key of ['browser', 'ffmpeg', 'transcoding', 'ffprobe', 'vlc']) {
      if (typeof result.body[key] !== 'boolean') throw new Error(`${key} não é booleano`)
    }
    expectNoAbsolutePath(result.body)
  })

  await check('sources', '/api/sources', expectArray)
  const profiles = await check('profiles', '/api/profiles', expectArray)
  const profileId = profiles[0]?.id || 'smoke-profile'
  const library = await check(`library (${profileId})`, `/api/library?profileId=${encodeURIComponent(profileId)}`, expectArray)
  const mediaId = library.find((item) => typeof item.mediaId === 'string')?.mediaId || 'missing-media'

  await check('review', '/api/review', expectArray)
  await check('artwork candidates', '/api/artwork/candidates', (result) => {
    expectArray(result)
    expectNoAbsolutePath(result.body)
  })
  await check('catalog history', '/api/catalog/history', (result) => {
    expectStatus(result, 200)
    if (!Array.isArray(result.body?.archived) || !Array.isArray(result.body?.titleChanges)) {
      throw new Error('histórico sem archived/titleChanges')
    }
    expectNoAbsolutePath(result.body)
  })

  await check('progress leitura', `/api/progress?profileId=${encodeURIComponent(profileId)}&mediaId=${encodeURIComponent(mediaId)}`, (result) => {
    expectStatus(result, 200)
    if (result.body !== null && typeof result.body !== 'object') throw new Error('progresso inválido')
  })

  await check('rating leitura', `/api/rating?profileId=${encodeURIComponent(profileId)}&mediaId=${encodeURIComponent(mediaId)}`, (result) => {
    expectStatus(result, 200)
    if (result.body !== null && typeof result.body !== 'object') throw new Error('rating inválido')
  })

  if (mediaId !== 'missing-media') {
    await check('streams sem caminho físico', `/api/media/${encodeURIComponent(mediaId)}/streams`, (result) => {
      expectStatus(result, 200)
      expectJson(result)
      expectNoAbsolutePath(result.body)
    })
    await check('legendas sem caminho físico', `/api/media/${encodeURIComponent(mediaId)}/subtitles`, (result) => {
      expectStatus(result, 200)
      expectArray(result)
      expectNoAbsolutePath(result.body)
    })
  }

  await check('mídia inexistente bloqueada', '/api/media/smoke-invalid-media', (result) => {
    expectStatus(result, 404)
  })
  await check('token de legenda inválido bloqueado', '/api/subtitle/smoke-invalid-token', (result) => {
    expectStatus(result, 400)
  })

  const traversalToken = Buffer.from(JSON.stringify({
    mediaId,
    name: '../outside.srt',
  })).toString('base64url')
  await check('travessia de legenda bloqueada', `/api/subtitle/${encodeURIComponent(traversalToken)}`, (result) => {
    expectStatus(result, 400)
  })

  console.log(`Smoke API OK: ${checks.length} verificações`)
  for (const checkResult of checks) console.log(checkResult)
} catch (error) {
  console.error(`Smoke API FALHOU: ${error.message}`)
  for (const checkResult of checks) console.error(checkResult)
  process.exitCode = 1
}
