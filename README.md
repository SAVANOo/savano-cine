# Savano Cine (`cine-local`)

Media center local + streaming via addons Stremio, com perfis isolados, player customizado (HLS, transcodificação FFmpeg, legendas agrupadas por idioma, download offline), console administrativo e túnel público opcional.

## Requisitos
- **Node.js 22+** (usa `node:sqlite` nativo para o banco `data/catalog.db`)
- **Opcional**:
  - `ffmpeg` / `ffprobe` (transcodificação de MKV/AVI/RMVB e extração de legendas embutidas)
  - `cloudflared` (túnel HTTPS público para celular/4G)
  - `qBittorrent` com WebUI na porta `8080` (se ativo, downloads torrent são encaminhados para ele; caso contrário usa WebTorrent integrado em `<fonte>/Downloads`)

## Primeiro Uso (First-Run)
1. Instale as dependências:
   ```powershell
   npm install
   ```
2. Inicie pelo launcher (sobe API `4174`, Web `5173`, túnel opcional e abre diretamente `/?tab=server` para o admin):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/launch-cine-local.ps1
   ```
3. **Perfis & Permissões**:
   - Na inicialização do banco, o perfil administrador padrão (`Admin`, `is_admin = 1`) é criado automaticamente.
   - Perfis secundários (`is_admin = 0`) podem assistir, gerenciar **Minha Lista**, avaliar e buscar legendas/streams, mas **não** têm acesso ao painel Admin (`/?tab=server`, addons, fontes, logs ou edição de catálogo) e recebem `403` nas rotas protegidas da API.
   - Opcionalmente defina `CINE_ACCESS_PIN` no ambiente antes de iniciar a API para exigir PIN global na entrada.

## Scripts de Desenvolvimento & Testes
- `npm run lint`: validação estática com `oxlint` (0 warnings / 0 errors)
- `npm run test:unit`: testes unitários (`node --test tests/unit/*.test.mjs`)
- `npm run build`: verificação TypeScript (`tsc -b`) + bundle `vite build`
- `npm run smoke`: 15 checagens rápidas da API local
- `npm run verify`: 13 testes de integração ponta a ponta na API
- `npx playwright test`: suíte E2E no navegador (exige preview/web ativo na porta `4173`)
