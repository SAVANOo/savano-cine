import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  deleteStremioAddon,
  fetchAddonCatalog,
  fetchAddonMeta,
  installStremioAddon,
  listStremioAddons,
  normalizeManifestUrl,
  queryAddonStreams,
  queryAddonSubtitles,
  setStremioAddonEnabled,
} from '../../scripts/stremio-addons.mjs'
import { getTorrentStatus, isValidInfoHash } from '../../scripts/torrent-stream.mjs'

test('normalizeManifestUrl validates HTTP/HTTPS and appends manifest.json', () => {
  assert.throws(() => normalizeManifestUrl('file:///etc/passwd'))
  assert.throws(() => normalizeManifestUrl('not-a-url'))
  const normalized = normalizeManifestUrl('https://example.com/addon/')
  assert.equal(normalized.manifestUrl, 'https://example.com/addon/manifest.json')
  assert.equal(normalized.baseUrl, 'https://example.com/addon')
  const stremioProto = normalizeManifestUrl('stremio://v3-cinemeta.strem.io/manifest.json')
  assert.equal(stremioProto.manifestUrl, 'https://v3-cinemeta.strem.io/manifest.json')
})

test('isValidInfoHash and getTorrentStatus validate SHA-1/Base32 infoHashes', async () => {
  assert.equal(isValidInfoHash('0123456789abcdef0123456789abcdef01234567'), true)
  assert.equal(isValidInfoHash('../bad-hash'), false)
  const status = await getTorrentStatus('0123456789abcdef0123456789abcdef01234567')
  assert.equal(status?.active, false)
})

test('Stremio addon lifecycle: install, catalog, meta, streams, subtitles, toggle and delete', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/manifest.json') {
      res.end(
        JSON.stringify({
          id: 'org.savano.mock',
          name: 'Mock Stremio Addon',
          version: '1.2.3',
          description: 'Addon de teste local',
          types: ['movie', 'series'],
          resources: ['catalog', 'meta', 'stream', 'subtitles'],
          catalogs: [{ type: 'movie', id: 'top', name: 'Populares' }],
        }),
      )
      return
    }
    if (req.url === '/catalog/movie/top.json') {
      res.end(
        JSON.stringify({
          metas: [
            {
              id: 'tt0001',
              type: 'movie',
              name: 'Filme Teste',
              releaseInfo: '2025',
              genres: ['Ação'],
            },
          ],
        }),
      )
      return
    }
    if (req.url === '/meta/movie/tt0001.json') {
      res.end(
        JSON.stringify({
          meta: {
            id: 'tt0001',
            type: 'movie',
            name: 'Filme Teste',
            description: 'Sinopse em português',
          },
        }),
      )
      return
    }
    if (req.url === '/stream/movie/tt0001.json') {
      res.end(
        JSON.stringify({
          streams: [
            {
              name: '1080p MP4',
              title: 'Stream direto HTTP',
              url: 'https://cdn.example.com/filme.mp4',
            },
          ],
        }),
      )
      return
    }
    if (req.url === '/subtitles/movie/tt0001.json') {
      res.end(
        JSON.stringify({
          subtitles: [
            {
              id: 'pt-br',
              lang: 'por',
              url: 'https://cdn.example.com/filme.vtt',
            },
          ],
        }),
      )
      return
    }
    res.statusCode = 404
    res.end('{}')
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const db = new DatabaseSync(':memory:')

  try {
    const installed = await installStremioAddon(db, baseUrl)
    assert.equal(installed.id, 'org.savano.mock')
    assert.equal(listStremioAddons(db).length, 1)

    const catalog = await fetchAddonCatalog(db, 'org.savano.mock', { type: 'movie', catalogId: 'top' })
    assert.equal(catalog.metas.length, 1)
    assert.equal(catalog.metas[0].name, 'Filme Teste')

    const meta = await fetchAddonMeta(db, 'org.savano.mock', { type: 'movie', metaId: 'tt0001' })
    assert.equal(meta.description, 'Sinopse em português')

    const streams = await queryAddonStreams(db, { type: 'movie', id: 'tt0001' })
    assert.equal(streams.length, 1)
    assert.equal(streams[0].isDirectHttp, true)

    const subs = await queryAddonSubtitles(db, { type: 'movie', id: 'tt0001' })
    assert.equal(subs.length, 1)
    assert.equal(subs[0].lang, 'por')

    const disabled = setStremioAddonEnabled(db, 'org.savano.mock', false)
    assert.equal(disabled.enabled, false)
    assert.equal((await queryAddonStreams(db, { type: 'movie', id: 'tt0001' })).length, 0)

    assert.equal(deleteStremioAddon(db, 'org.savano.mock'), true)
    assert.equal(listStremioAddons(db).length, 0)
  } finally {
    db.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
