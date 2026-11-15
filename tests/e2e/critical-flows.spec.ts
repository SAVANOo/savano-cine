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
    await expect(page.getByRole('button', { name: /Mais informações/i }).first()).toBeVisible()
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
    await expect(page.getByRole('heading', { name: /Conector de Addons \(Protocolo Stremio\)/i })).toBeVisible()
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
    await expect(page.getByText(/Novo volume/i)).toBeVisible()
    const search = page.locator('#sc-search-input')
    await search.fill('South Park')
    await expect(page.locator('article h3', { hasText: /^South Park$/i }).first()).toBeVisible()

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
})
