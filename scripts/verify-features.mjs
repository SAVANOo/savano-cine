import assert from 'node:assert/strict'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { SelfHostedSourceAdapter } from './source-adapters.mjs'

const baseUrl = (process.env.CINE_API_URL || 'http://127.0.0.1:4174').replace(/\/+$/, '')
const root = path.dirname(fileURLToPath(import.meta.url))
const databasePath = path.resolve(root, '..', 'data', 'catalog.db')
const database = new DatabaseSync(databasePath)

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    signal: AbortSignal.timeout(5000),
    ...options,
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  return { status: response.status, body }
}

const tempIds = {
  profiles: ['profile-verify-a', 'profile-verify-b'],
  candidateId: 'cand-verify-temp-1',
}

try {
  // 1. Verificar perfis e persistência de rating por dois perfis
  const libraryRes = await api('/api/library')
  assert.equal(libraryRes.status, 200)
  assert.ok(Array.isArray(libraryRes.body) && libraryRes.body.length > 0, 'Biblioteca vazia para verificação')

  const sampleMovie = libraryRes.body.find((item) => item.mediaId)
  assert.ok(sampleMovie?.mediaId, 'Nenhum filme com mediaId encontrado na biblioteca')

  for (const [index, profileId] of tempIds.profiles.entries()) {
    const createProfile = await api('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: profileId,
        name: `Verificação ${index + 1}`,
        avatarKey: 'amber',
      }),
    })
    assert.equal(createProfile.status, 200)
  }

  const postA = await api('/api/rating', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: tempIds.profiles[0],
      mediaId: sampleMovie.mediaId,
      score: 9,
      review: 'Excelente no perfil A',
    }),
  })
  assert.equal(postA.status, 200)

  const postB = await api('/api/rating', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: tempIds.profiles[1],
      mediaId: sampleMovie.mediaId,
      score: 4,
      review: 'Regular no perfil B',
    }),
  })
  assert.equal(postB.status, 200)

  const getA = await api(`/api/rating?profileId=${encodeURIComponent(tempIds.profiles[0])}&mediaId=${encodeURIComponent(sampleMovie.mediaId)}`)
  const getB = await api(`/api/rating?profileId=${encodeURIComponent(tempIds.profiles[1])}&mediaId=${encodeURIComponent(sampleMovie.mediaId)}`)
  assert.equal(getA.body?.score, 9)
  assert.equal(getA.body?.review, 'Excelente no perfil A')
  assert.equal(getB.body?.score, 4)
  assert.equal(getB.body?.review, 'Regular no perfil B')
  console.log('PASS rating por dois perfis isolado e persistido')

  // 2. Verificar tags e gêneros no catálogo
  const itemsWithMetadata = libraryRes.body.filter((item) => Array.isArray(item.genres) && Array.isArray(item.tags))
  assert.equal(itemsWithMetadata.length, libraryRes.body.length, 'Todos os itens devem expor arrays genres e tags')
  const totalTagsOrGenres = libraryRes.body.reduce((sum, item) => sum + item.genres.length + item.tags.length, 0)
  assert.ok(totalTagsOrGenres > 0, 'Catálogo deve possuir gêneros ou tags derivadas')
  console.log(`PASS tags e gêneros (${totalTagsOrGenres} marcações no catálogo)`)

  // 3. Verificar fluxo de revisão de correspondências de arte
  database.prepare(`
    INSERT INTO artwork_candidates (id, movie_id, provider, provider_id, title, year, overview, language, status)
    VALUES (?, ?, 'wikipedia', 'verify-001', ?, 2020, 'Sinopse de teste', 'pt', 'pending')
    ON CONFLICT(id) DO UPDATE SET status = 'pending'
  `).run(tempIds.candidateId, sampleMovie.mediaId, sampleMovie.title)

  const candidatesBefore = await api('/api/artwork/candidates')
  assert.equal(candidatesBefore.status, 200)
  assert.ok(
    candidatesBefore.body.some((group) => group.candidates.some((c) => c.id === tempIds.candidateId)),
    'Candidato pendente deve aparecer em GET /api/artwork/candidates',
  )

  const rejectRes = await api(`/api/artwork/candidates/${encodeURIComponent(tempIds.candidateId)}/reject`, {
    method: 'POST',
  })
  assert.equal(rejectRes.status, 200)
  assert.equal(rejectRes.body?.status, 'rejected')

  const candidatesAfter = await api('/api/artwork/candidates')
  assert.equal(candidatesAfter.status, 200)
  assert.ok(
    !candidatesAfter.body.some((group) => group.candidates.some((c) => c.id === tempIds.candidateId)),
    'Candidato rejeitado não deve mais aparecer como pendente',
  )
  console.log('PASS revisão de correspondências de arte (listagem e descarte)')

  // 4. Verificar busca de legendas OpenSubtitles (sem alterar arquivos) e endpoint de legenda embutida
  const subSearch = await api(`/api/media/${encodeURIComponent(sampleMovie.mediaId)}/subtitles/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sampleMovie.title }),
  })
  assert.equal(subSearch.status, 200)
  assert.equal(subSearch.body?.provider, 'opensubtitles')
  assert.ok(Array.isArray(subSearch.body?.results), 'Busca de legendas deve retornar array results')
  console.log(`PASS busca OpenSubtitles (configured=${Boolean(subSearch.body?.configured)})`)

  const embeddedInvalid = await api(`/api/media/${encodeURIComponent(sampleMovie.mediaId)}/subtitles/embedded/invalid`)
  assert.equal(embeddedInvalid.status, 404)
  console.log('PASS rota de legenda embutida rejeita índice não numérico')

  // 5. Verificar validação de POST /api/sources e edição reversível via PATCH /api/catalog/:id
  const badSource = await api('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\PastaQueNaoExisteParaTeste123' }),
  })
  assert.equal(badSource.status, 400)
  console.log('PASS cadastro de fonte rejeita pasta inexistente')

  const originalTitle = sampleMovie.title
  const patchRes = await api(`/api/catalog/${encodeURIComponent(sampleMovie.mediaId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `${originalTitle} (Teste)` }),
  })
  assert.equal(patchRes.status, 200)
  assert.equal(patchRes.body?.title, `${originalTitle} (Teste)`)

  const latestHistory = database.prepare(`
    SELECT id FROM media_item_title_history
    WHERE media_item_id = ? AND reason = 'edição manual na interface'
    ORDER BY created_at DESC LIMIT 1
  `).get(sampleMovie.mediaId)
  assert.ok(latestHistory?.id, 'Edição de título deve registrar histórico')
  const restoreTitle = await api(`/api/catalog/title-history/${encodeURIComponent(latestHistory.id)}/restore`, { method: 'POST' })
  assert.equal(restoreTitle.status, 200)
  assert.equal(restoreTitle.body?.title, originalTitle)
  database.prepare('DELETE FROM media_item_title_history WHERE media_item_id = ? AND (reason = ? OR reason = ?)').run(
    sampleMovie.mediaId,
    'edição manual na interface',
    'restauração manual do título',
  )
  console.log('PASS edição de metadados e restauração reversível de título')

  // 6. Verificar protocolo e resolução do adapter HTTP/remoto
  const remoteAdapter = new SelfHostedSourceAdapter()
  assert.equal(remoteAdapter.isSupportedUrl('https://media.local:4174'), true)
  assert.equal(remoteAdapter.isSupportedUrl('ftp://media.local/files'), false)
  assert.equal(
    remoteAdapter.resolveStream('https://media.local:4174/', '/api/media/abc')?.url,
    'https://media.local:4174/api/media/abc',
  )
  console.log('PASS adapter HTTP/remoto valida protocolo e resolve stream')

  // 7. Verificar endpoint de logs de erro e ausência de vídeos promocionais na biblioteca
  const logsRes = await api('/api/logs/errors')
  assert.equal(logsRes.status, 200)
  assert.ok(Array.isArray(logsRes.body), 'GET /api/logs/errors deve retornar um array')
  console.log(`PASS endpoint de monitoria de erros (/api/logs/errors, ${logsRes.body.length} registros)`)

  const promoHits = libraryRes.body.filter((item) => {
    const text = `${item.title || ''} ${item.filePath || ''}`.toLowerCase()
    return text.includes('1xbet') || text.includes('dinheiro livre') || text.includes('dinheiro_livre')
  })
  assert.equal(promoHits.length, 0, 'Biblioteca não deve expor vídeos promocionais/anúncios (1XBET)')
  console.log('PASS biblioteca livre de vídeos promocionais (1XBET/anúncios)')

  // 8. Verificar toggle de Minha Lista por perfil
  const toggleOn = await api('/api/watchlist/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: tempIds.profiles[0],
      targetType: sampleMovie.kind === 'Série' ? 'show' : 'movie',
      targetId: sampleMovie.id,
    }),
  })
  assert.equal(toggleOn.status, 200)
  assert.equal(toggleOn.body?.inWatchlist, true)

  const toggleOff = await api('/api/watchlist/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: tempIds.profiles[0],
      targetType: sampleMovie.kind === 'Série' ? 'show' : 'movie',
      targetId: sampleMovie.id,
    }),
  })
  assert.equal(toggleOff.status, 200)
  assert.equal(toggleOff.body?.inWatchlist, false)
  console.log('PASS toggle de Minha Lista por perfil persistido')
} finally {
  database.prepare('DELETE FROM artwork_candidates WHERE id = ?').run(tempIds.candidateId)
  for (const profileId of tempIds.profiles) {
    database.prepare('DELETE FROM watchlist WHERE profile_id = ?').run(profileId)
    database.prepare('DELETE FROM ratings WHERE profile_id = ?').run(profileId)
    database.prepare('DELETE FROM profiles WHERE id = ?').run(profileId)
  }
}
