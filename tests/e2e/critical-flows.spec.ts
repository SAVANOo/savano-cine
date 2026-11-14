import { expect, test } from '@playwright/test'

test.describe('Savano Cine - Fluxos Críticos E2E', () => {
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

    const infoButton = page.getByRole('button', { name: /Mais informações sobre/i }).first()
    await infoButton.click()
    await expect(page.getByRole('button', { name: /Voltar para biblioteca/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Você também pode gostar/i })).toBeVisible()

    await page.getByRole('button', { name: /Voltar para biblioteca/i }).click()

    const coverButton = page.locator('article button.sc-clickable-card').first()
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
})
