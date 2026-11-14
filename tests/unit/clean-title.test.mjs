import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanTitle } from '../../scripts/scan-media.mjs'

test('cleanTitle removes release groups, site tags, and trailing years', () => {
  assert.equal(cleanTitle('A Fuga Do Planeta Terra (2013) - AndreTPF'), 'A Fuga Do Planeta Terra')
  assert.equal(
    cleanTitle('A Serie Divergente Insurgente 2015 -WOLVERDONFILMES'),
    'A Serie Divergente Insurgente',
  )
  assert.equal(
    cleanTitle('Animais Fantásticos e Onde Habitam 2017 -TDF'),
    'Animais Fantásticos e Onde Habitam',
  )
  assert.equal(cleanTitle('zumbilandia(www.thepiratefilmes.com)'), 'zumbilandia')
  assert.equal(cleanTitle('A Casa Monstro (2006)'), 'A Casa Monstro')
  assert.equal(cleanTitle('X-Men.Fênix.Negra.2019.1080p.6CH.BLUDV.COM'), 'X-Men Fênix Negra')
})
