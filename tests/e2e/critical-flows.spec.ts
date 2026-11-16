import { expect, test } from '@playwright/test'

test.describe('Savano Cine - Fluxos Críticos E2E', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: 'sc_profile_session',
        value: 'profile-savio',
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
    await expect(page.getByText(/Novo volume/i)).toBeVisible()

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
    await page.getByRole('button', { name: /^Admin/i }).click()
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
    await expect(page.getByText(/Novo volume/i)).toBeVisible()
    await page.getByRole('button', { name: /Assistir|Retomar/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTitle('Velocidade de reprodução')).toHaveText('1x')
    const volumeSlider = dialog.getByLabel('Volume')
    await expect(volumeSlider).toHaveAttribute('max', '3')
  })

  test('Gate Quem está assistindo aparece sem cookie e entra ao escolher perfil', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/')
    const gate = page.getByRole('dialog', { name: 'Quem está assistindo?' })
    await expect(gate).toBeVisible()
    await gate.getByRole('button', { name: /Savio/i }).first().click()
    await expect(gate).toBeHidden()
    await expect(page.getByRole('button', { name: /Savano Cine/i })).toBeVisible()
  })

  test('Navbar Filmes e Séries filtram o catálogo ao clicar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Novo volume/i)).toBeVisible()
    await page.getByRole('navigation').getByRole('button', { name: 'Filmes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Filmes', exact: true })).toBeVisible()
    await page.getByRole('navigation').getByRole('button', { name: 'Séries', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Séries', exact: true })).toBeVisible()
  })

  test('Alternador de temas aplica Escuro, Claro e Momolada', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Momolada', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'momolada')
    await page.getByRole('button', { name: 'Claro', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Escuro', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
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
    request,
  }) => {
    await page.goto('/?tab=server')
    await expect(page.getByRole('heading', { name: /Painel do Catálogo/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Servidor & Conexões/i })).toBeVisible()

    const profilesRes = await request.get('/api/profiles')
    const profiles = (await profilesRes.json()) as Array<{ id: string; isAdmin?: boolean }>
    const nonAdmin = profiles.find((p) => !p.isAdmin)
    if (nonAdmin) {
      await context.clearCookies()
      await context.addCookies([
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
      ] as const) {
        const res = await request.fetch(url, {
          method,
          headers: { Cookie: `sc_profile_session=${encodeURIComponent(nonAdmin.id)}` },
        })
        expect(res.status()).toBe(403)
      }
    }
  })

  test('Progresso online persiste e aparece em Continuar assistindo', async ({ page, request }) => {
    const uniqueKey = `addon:test-${Date.now()}`
    const saveRes = await request.post('/api/addons/progress', {
      data: {
        profileId: 'profile-savio',
        mediaKey: uniqueKey,
        title: 'Teste Online E2E — T1:E2',
        poster: 'https://image.tmdb.org/t/p/w500/example.jpg',
        positionSec: 120,
        durationSec: 600,
      },
    })
    expect(saveRes.ok()).toBeTruthy()

    const listRes = await request.get('/api/addons/progress?profileId=profile-savio')
    expect(listRes.ok()).toBeTruthy()
    const rows = (await listRes.json()) as Array<{ mediaKey: string; contentKey: string; type: string }>
    const found = rows.find((r) => r.mediaKey === uniqueKey)
    expect(found?.contentKey).toBe(uniqueKey)
    expect(found?.type).toBe('series')

    await page.goto('/')
    await page.getByRole('navigation').getByRole('button', { name: 'Continuar assistindo', exact: true }).click()
    await expect(page.getByText('Continuar assistindo (Online · Addons)')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Teste Online E2E — T1:E2').first()).toBeVisible()
  })
})
