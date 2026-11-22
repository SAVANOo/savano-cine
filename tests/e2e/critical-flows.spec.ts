import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

const DEFAULT_PIN_TOKEN = createHash('sha256').update('savano-cine:4321').digest('hex')

test.describe('Savano Cine - Fluxos Críticos E2E', () => {
  let adminProfileId = 'profile-admin'

  test.beforeEach(async ({ context, request }) => {
    const res = await request.get('/api/profiles').catch(() => null)
    const profiles = res && res.ok() ? ((await res.json().catch(() => [])) as Array<{ id: string; isAdmin?: boolean }>) : []
    adminProfileId = profiles.find((p) => p.isAdmin)?.id || profiles[0]?.id || 'profile-admin'
    await context.addCookies([
      {
        name: 'sc_pin_ok',
        value: DEFAULT_PIN_TOKEN,
        url: 'http://127.0.0.1:4173',
      },
      {
        name: 'sc_profile_session',
        value: adminProfileId,
        url: 'http://127.0.0.1:4173',
      },
    ])
  })

  test('Home exibe Hero com Mais informações e carrosséis', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Savano Cine/i })).toBeVisible()
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /Mais informações/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Recomendados para você')).toBeVisible()
    await expect(page.getByRole('button', { name: /Mais informações sobre/i }).first()).toBeVisible()
  })

  test('Card: clicar em Mais informações abre detalhes e clicar na capa abre o player', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 10000 })

    const infoButton = page.getByRole('button', { name: /Mais informações sobre/i }).first()
    await infoButton.click()
    await expect(page.getByRole('button', { name: /Voltar para biblioteca/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Você também pode gostar/i })).toBeVisible()

    await page.getByRole('button', { name: /Voltar para biblioteca/i }).click()

    const coverButton = page.locator('article button[aria-label="Assistir South Park"]').first()
    await coverButton.click()
    await expect(
      page.getByRole('dialog').or(page.getByRole('button', { name: /Voltar para biblioteca/i })),
    ).toBeVisible()
  })

  test('Admin Console exibe abas de Revisão, Arte, Histórico e Logs de Erro', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation').getByRole('button', { name: /^Admin/i }).click()
    await expect(page.getByRole('heading', { name: 'Painel do Catálogo' })).toBeVisible()
    await page.getByRole('button', { name: /Arte & Metadados/i }).click()
    await expect(page.getByRole('button', { name: /Buscar capas faltantes/i })).toBeVisible()
    await page.getByRole('button', { name: /Logs de Erro/i }).click()
    await expect(page.getByText(/data\/logs\/api-errors\.log/i)).toBeVisible()
    await page.getByRole('button', { name: /Addons \(Stremio\)/i }).click()
    await expect(page.getByRole('heading', { name: /Adicionar & Gerenciar Addons/i })).toBeVisible()
  })

  test('Editor de perfil abre grupos de avatares estilo Netflix', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Trocar perfil/i }).click()
    await page.getByRole('button', { name: /Criar perfil/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Os Clássicos')).toBeVisible()
    await expect(dialog.getByText('South Park')).toBeVisible()
    await expect(dialog.getByText('Ben 10')).toBeVisible()
    await expect(dialog.getByText('Gravity Falls')).toBeVisible()
  })

  test('Deep-link /series/show-south-park nunca renderiza tela em branco', async ({ page }) => {
    await page.goto('/series/show-south-park')
    await expect(page.getByRole('button', { name: /Savano Cine/i })).toBeVisible()
  })

  test('Busca por South Park mostra a série e filtros de ordenação/não assistidos funcionam', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 15000 })
    const search = page.locator('#sc-search-input')
    await search.fill('South Park')
    await expect(page.locator('article h3', { hasText: /^South Park$/i }).first()).toBeVisible({ timeout: 10000 })

    await search.fill('')
    await page.getByLabel('Ordenar catálogo').selectOption('az')
    await page.getByRole('button', { name: /Não assistidos/i }).click()
    await expect(page.getByText(/título\(s\)/i)).toBeVisible()
  })

  test('Player exibe controle de velocidade e slider de volume até 300%', async ({ page }) => {
    await page.goto('/series/show-south-park')
    await expect(page.getByText(/Novo volume/i).first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /Assistir|Retomar/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTitle('Velocidade de reprodução')).toHaveText('1x')
    const volumeSlider = dialog.getByLabel('Volume')
    await expect(volumeSlider).toHaveAttribute('max', '3')
  })

  test('Gate Quem está assistindo aparece sem cookie e entra ao escolher perfil', async ({ page, context }) => {
    await context.clearCookies()
    await context.addCookies([
      {
        name: 'sc_pin_ok',
        value: DEFAULT_PIN_TOKEN,
        url: 'http://127.0.0.1:4173',
      },
    ])
    await page.goto('/')
    const gate = page.getByRole('dialog', { name: 'Quem está assistindo?' })
    await expect(gate).toBeVisible()
    await gate.locator('button').first().click()
    const unlockDialog = page.getByRole('dialog', { name: /Desbloquear perfil/i })
    await expect(unlockDialog.or(page.getByRole('button', { name: /Savano Cine/i }))).toBeVisible({ timeout: 5000 })
  })

  test('PinGate exige PIN 4321 sem cookie sc_pin_ok e libera acesso', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/')
    await expect(page.getByPlaceholder(/PIN/i).or(page.getByLabel(/PIN/i)).first()).toBeVisible({ timeout: 10000 })
    await page.locator('input[type="password"]').first().fill('4321')
    await page.getByRole('button', { name: /Entrar|Desbloquear/i }).first().click()
    await expect(page.getByRole('dialog', { name: 'Quem está assistindo?' })).toBeVisible({ timeout: 10000 })
  })

  test('Navbar Filmes e Séries filtram o catálogo ao clicar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 10000 })
    await page.getByRole('navigation').getByRole('button', { name: 'Filmes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Filmes', exact: true })).toBeVisible()
    await page.getByRole('navigation').getByRole('button', { name: 'Séries', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Séries', exact: true })).toBeVisible()
  })

  test('Alternador de temas aplica Escuro, Claro e Momolada exclusivo do perfil Convidado', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Momolada', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Claro', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Escuro', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await context.addCookies([
      {
        name: 'sc_profile_session',
        value: 'profile-family',
        url: 'http://127.0.0.1:4173',
      },
    ])
    await page.goto('/')
    await page.getByRole('button', { name: 'Momolada', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'momolada')
  })

  test('Acervo Online e Gerenciador de Addons abrem corretamente', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation').getByRole('button', { name: 'Acervo Online', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Acervo Online/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filmes', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: /Gerenciar \/ Adicionar Addons/i }).click()
    await expect(page.getByRole('heading', { name: /Adicionar & Gerenciar Addons/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /QR Code/i })).toBeVisible()
  })

  test('Aba Servidor & Conexões abre por ?tab=server para Admin e é bloqueada para perfil não-admin', async ({
    page,
    context,
  }) => {
    await page.goto('/?tab=server')
    await expect(page.getByRole('heading', { name: /Painel do Catálogo/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Servidor & Conexões/i })).toBeVisible()
    await expect(page.getByText(/Downloads para o Acervo Local/i)).toBeVisible()

    const profilesRes = await page.request.get('/api/profiles')
    const profiles = (await profilesRes.json()) as Array<{ id: string; isAdmin?: boolean }>
    const nonAdmin = profiles.find((p) => !p.isAdmin)
    if (nonAdmin) {
      await context.clearCookies()
      await context.addCookies([
        {
          name: 'sc_pin_ok',
          value: DEFAULT_PIN_TOKEN,
          url: 'http://127.0.0.1:4173',
        },
        {
          name: 'sc_profile_session',
          value: nonAdmin.id,
          url: 'http://127.0.0.1:4173',
        },
      ])
      await page.goto('/?tab=server')
      await expect(page.getByRole('heading', { name: /Painel do Catálogo/i })).toBeHidden()
      await expect(page.getByRole('button', { name: /^Admin/i })).toBeHidden()

      for (const [method, url] of [
        ['GET', '/api/admin/connections'],
        ['POST', '/api/admin/tunnel/start'],
        ['POST', '/api/admin/tunnel/stop'],
        ['GET', '/api/logs/errors'],
        ['POST', '/api/review'],
        ['POST', '/api/catalog/fake-id/archive'],
        ['POST', '/api/artwork/fetch'],
      ] as const) {
        const res = await page.request.fetch(url, {
          method,
          headers: {
            Cookie: `sc_pin_ok=${DEFAULT_PIN_TOKEN}; sc_profile_session=${encodeURIComponent(nonAdmin.id)}`,
          },
        })
        expect(res.status()).toBe(403)
      }
    }
  })

  test('Progresso online persiste e aparece em Continuar assistindo', async ({ page }) => {
    const uniqueKey = `addon:test-${Date.now()}`
    try {
      const saveRes = await page.request.post('/api/addons/progress', {
        data: {
          profileId: adminProfileId,
          mediaKey: uniqueKey,
          title: 'Teste Online E2E — T1:E2',
          poster: 'https://image.tmdb.org/t/p/w500/example.jpg',
          positionSec: 120,
          durationSec: 600,
        },
      })
      expect(saveRes.ok()).toBeTruthy()

      const listRes = await page.request.get(`/api/addons/progress?profileId=${encodeURIComponent(adminProfileId)}`)
      expect(listRes.ok()).toBeTruthy()
      const rows = (await listRes.json()) as Array<{ mediaKey: string; contentKey: string; type: string }>
      const found = rows.find((r) => r.mediaKey === uniqueKey)
      expect(found?.contentKey).toBe(uniqueKey)
      expect(found?.type).toBe('series')

      await page.goto('/')
      await page.getByRole('navigation').getByRole('button', { name: 'Continuar assistindo', exact: true }).click()
      await expect(page.getByText('Continuar assistindo (Online · Addons)')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Teste Online E2E — T1:E2').first()).toBeVisible()
    } finally {
      await page.request.delete(`/api/addons/progress?profileId=${encodeURIComponent(adminProfileId)}&mediaKey=${encodeURIComponent(uniqueKey)}`)
    }
  })

  test('Me Surpreenda abre pela navbar, escolhe clima e sorteia sugestão visual', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 10000 })
    await page.getByRole('navigation').getByRole('button', { name: 'Me Surpreenda', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Me Surpreenda/i })).toBeVisible()
    await page.getByRole('button', { name: /Para Dar Risada/i }).click()
    await page.getByRole('button', { name: /Sortear sugestão/i }).click()
    await expect(page.getByRole('button', { name: /Sortear outro/i }).first()).toBeVisible({ timeout: 5000 })
  })

  test('Comunidade (Espaço Social) exibe feed e publica nova avaliação', async ({ page }) => {
    const uniqueTitle = `Filme E2E ${Date.now()}`
    try {
      await page.goto('/')
      await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 10000 })
      await page.getByRole('navigation').getByRole('button', { name: 'Comunidade', exact: true }).click()
      await expect(page.getByRole('heading', { name: /Espaço Social/i })).toBeVisible()
      await page.getByPlaceholder(/Nome do filme ou série/i).fill(uniqueTitle)
      await page.getByPlaceholder(/O que você achou/i).fill('Excelente filme para testar!')
      await page.getByRole('button', { name: 'Publicar', exact: true }).click()
      await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 5000 })
    } finally {
      const feedRes = await page.request.get(`/api/social/feed?profileId=${encodeURIComponent(adminProfileId)}`).catch(() => null)
      const feedData = feedRes && feedRes.ok() ? ((await feedRes.json().catch(() => null)) as { reviews?: Array<{ id: string; title: string }> } | null) : null
      const created = feedData?.reviews?.find((r) => r.title === uniqueTitle)
      if (created?.id) {
        await page.request.delete(`/api/social/reviews/${encodeURIComponent(created.id)}`).catch(() => undefined)
      }
    }
  })

  test('Tutorial interativo abre pela barra lateral e avança passos', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Tutorial', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /Tutorial do Savano Cine/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Passo 1 de 5/i)).toBeVisible()
    await dialog.getByRole('button', { name: /Próximo/i }).click()
    await expect(dialog.getByText(/Passo 2 de 5/i)).toBeVisible()
    await dialog.getByRole('button', { name: /Pular tour/i }).click()
    await expect(dialog).toBeHidden()
  })

  test('Controle Remoto Mobile (/?remote=TEST99) renderiza controles de reprodução', async ({ page }) => {
    await page.goto('/?remote=TEST99')
    await expect(page.getByText(/Controle Remoto/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Play ou Pausar/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Voltar 10s/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Avançar 10s/i })).toBeVisible()
  })
})
