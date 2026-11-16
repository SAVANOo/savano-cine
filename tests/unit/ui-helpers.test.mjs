import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findNextEpisode,
  getRelatedItems,
  resolvePlayableMedia,
  translateGenre,
} from '../../src/domain/uiHelpers.ts'
import { extractStreamLanguages } from '../../src/domain/streamLanguages.ts'

test('translateGenre translates English genres to Portuguese', () => {
  assert.equal(translateGenre('Animation'), 'Animação')
  assert.equal(translateGenre('Science-Fiction'), 'Ficção Científica')
  assert.equal(translateGenre('Drama'), 'Drama')
})

test('resolvePlayableMedia and findNextEpisode resolve series sequentially', () => {
  const show = {
    id: 'show-test',
    title: 'Teste',
    kind: 'Série',
    meta: '1 temporada',
    detail: 'Teste',
    posterClass: 'poster-default',
    artwork: { source: 'none', verified: false },
    seasons: [
      {
        number: 1,
        episodes: [
          { id: 'e1', season: 1, number: 1, title: 'Ep 1', filename: 'e1.mp4', duration: '22m', subtitles: [], mediaId: 'm1', mediaUrl: '/api/media/m1' },
          { id: 'e2', season: 1, number: 2, title: 'Ep 2', filename: 'e2.mp4', duration: '22m', subtitles: [], mediaId: 'm2', mediaUrl: '/api/media/m2' },
        ],
      },
    ],
  }
  const first = resolvePlayableMedia(show)
  assert.equal(first?.mediaId, 'm1')
  assert.equal(first?.nextEpisode?.mediaId, 'm2')
  assert.equal(findNextEpisode(show, 'm2'), undefined)
})

test('getRelatedItems ranks shared genres higher', () => {
  const target = {
    id: 'a',
    title: 'A',
    kind: 'Filme',
    meta: 'MKV',
    detail: 'a.mkv',
    genres: ['Action', 'Comedy'],
    posterClass: 'poster-default',
    artwork: { source: 'none', verified: false },
  }
  const match = { ...target, id: 'b', title: 'B', genres: ['Action', 'Comedy'] }
  const partial = { ...target, id: 'c', title: 'C', genres: ['Drama'] }
  const related = getRelatedItems(target, [partial, match])
  assert.equal(related[0]?.id, 'b')
})

test('extractStreamLanguages detects PT-BR, Dublado, Dual Audio and foreign flags', () => {
  assert.deepEqual(
    extractStreamLanguages('Filme 1080p PT-BR Dublado Dual Audio'),
    ['🇧🇷 PT-BR', '🇧🇷 Dublado', '🔊 Dual Áudio'],
  )
  assert.deepEqual(
    extractStreamLanguages('Iron Man 2008 Rutracker ENG RUS'),
    ['🇺🇸 ENG', '🇷🇺 RUS'],
  )
})
