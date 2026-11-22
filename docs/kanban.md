# Kanban do Savano Cine

Este arquivo é o roteiro operacional do projeto. Cada mudança relevante deve mover um cartão
de coluna e terminar com um commit pequeno e verificável.

A auto-revisão do quadro acontece a cada 2 minutos e 30 segundos de trabalho contínuo,
com atualização do insight atual, riscos encontrados e próximo plano.

## Em andamento

| Prioridade | Cartão | Próxima verificação |
| --- | --- | --- |
| — | Nenhum cartão pendente no ciclo atual | Todos os itens do backlog foram implementados e verificados |

## Próximo ciclo

| Prioridade | Cartão | Resultado esperado |
| --- | --- | --- |
| P0 | **Segurança: Redirect-SSRF, DNS BlockList & CORS restrito** | `http-proxy`/`subtitle-proxy` validando cada hop (`redirect: 'manual'`), `net.BlockList` em IPs resolvidos e headers defensivos (`nosniff`, `Referrer-Policy`). |
| P0 | **Banco isolado para E2E (`CINE_DB_PATH`)** | Testes Playwright rodando contra cópia temporária de `catalog.db`, sem risco de poluir dados reais. |
| P1 | **Acessibilidade WCAG 2.2 (Modal Focus Trap + Seekbar + Smart TV)** | `Modal.tsx` com `aria-labelledby`, focus trap e restauração de foco; timeline `role="slider"` e cancelamento de auto-hide com `:focus-within`. |
| P1 | **Unificação de Fluxo Online (remover `AddonStreamModal.tsx`)** | `OnlineCatalogView` e `ShowDetailView` usando `AddonDetailView`, eliminando 522 linhas legadas duplicadas. |
| P2 | **UX: Remover do Continue Assistindo Local + Teclado em Dropdowns** | `DELETE /api/progress` + botão `×` no `MediaCarousel` local e navegação por setas no histórico de busca. |
| P2 | **Performance: ETag/304 em `/api/catalog` & HWAccel FFmpeg** | `304 Not Modified` por versão do catálogo e detecção automática de NVENC/QSV/AMF para transcode H.265. |
| P3 | **Features: Integração Debrid (Real-Debrid/TorBox) & Auto-Skip** | Token opcional no Admin para streaming instantâneo de torrents e preferência de áudio/legenda por perfil. |

> Detalhamento técnico completo em `docs/backlog-exploratorio.md`.

## Concluído

- **Otimização de Streaming Addons/Torrent & Isolamento de TV/Séries (`torrent-stream.mjs`, `stremio-addons.mjs`, `api-server.mjs`, `OnlineCatalogView`, `AddonDetailView`, `VideoPlayer`)**: isolamento estrito de peças + prioridade do `moov` atom, 18 trackers, `POST /api/addons/torrent-prepare`, FFmpeg low-latency, proxy HTTP/HLS (`http-proxy`) e transcode (`http-transcode`) com `proxyHeaders`/`notWebReady`, circuit breaker em legendas, isolamento de catálogos `tv` na aba **TV / Ao Vivo**, remoção de episódios soltos/sem capa nas séries, ordenação inteligente + botão **Assistir Melhor Fonte**, telemetria de loading + **Trocar fonte agora** e auto-fallback em cascata (8s 0-peer e erro HTTP/codec).
- **Avaliação/Indicação Direta nos Detalhes & Próximo Episódio Online (`SocialRecommendModal`, `AddonDetailView`)**: botão **Comentar / Indicar** dentro das páginas de detalhe local e online, selo **Preferido** por reputação de addon e avanço automático para o próximo episódio em séries dos addons.
- **Personalização de Legendas, Persistência de Conexões, UI WebTorrent & Importação CSV**: fundo customizável de legendas (`Limpo`/`Suave`/`Escuro`), tabela `client_connections` no SQLite, formulário visual de limites WebTorrent e importação/exportação CSV Letterboxd/Trakt + 18 testes E2E Playwright.
- **Watch Party ("Assistir Junto") (`realtime-routes.mjs` + `VideoPlayer`)**: criação e entrada em salas com código de 6 dígitos, sincronização de play/pause/timestamp via SSE e chat rápido dentro do player.
- **Controle Remoto pelo Celular via QR Code (`RemoteControlView` + `/api/remote/*`)**: QR Code no player que abre interface mobile (`/?remote=CODE`) para comandar Play/Pause, ±10s, Volume, Mudo e Próximo Episódio em tempo real.
- **Miniplayer Persistente & Pré-carregamento do Próximo Episódio (`VideoPlayer`)**: botão de minimizar para janela flutuante no canto inferior direito enquanto navega pelo catálogo, e pré-carregamento automático do próximo episódio aos 85%.
- **Modo Smart TV (10-foot UI) (`Sidebar` + `tokens.css`)**: alternador **Modo Smart TV** na barra lateral com escala tipográfica ampliada e anel de foco dourado de alto contraste para navegação por controle/D-Pad.
- **Deduplicação de Versões, Sagas Automáticas, Re-sync de Capas & Exportação Trakt/Letterboxd**: normalização de versões (720p/1080p/4K), estantes automáticas de sagas (*Nárnia*, *Homem-Aranha*, *Maze Runner*, *Guardiões da Galáxia*), botão **Re-sincronizar Capas** (`POST /api/admin/artwork/sync-ptbr`), registro de reputação de fontes por addon, exportação CSV para Letterboxd/Trakt e limites de banda/peers no WebTorrent.

- **Espaço Social & Avaliações (`SocialFeedView` + `/api/social/*`)**: aba **Comunidade** com feed compartilhado de notas (1–5★) e comentários de todos os perfis, seção **Indicados para você**, formulário de indicação entre perfis e resumo estatístico do perfil.
- **Player Avançado**: botão **Modo Noite** (compressor dinâmico para equilibrar falas e explosões), botão **Pular abertura (+85s)** em séries/episódios, probe de faixas de áudio (`GET /api/addons/torrent-info`) e seek real com `-ss` + troca de áudio em streams torrent.
- **Saúde & Circuit Breaker para Addons**: monitoramento de latência/falhas por addon em `stremio-addons.mjs` com cooldown de 60s para addons instáveis, timeout rápido de 4.5s e badge de saúde (`Saudável`, `Lento`, `Instável`) no painel de Addons.
- **Perfil Kids & Backup do Banco**: filtragem automática de conteúdo adulto/terror em perfis infantis e endpoint `POST /api/admin/backup` com rotação dos últimos 5 snapshots de `catalog.db`.
- **Tour Guiado Interativo Step-by-Step (`OnboardingTour`)**: tutorial com spotlight dourado circulando busca, navegação, Acervo Online, Me Surpreenda e perfis/temas, disparado automaticamente no primeiro acesso de cada perfil e reabrível pelo botão **Tutorial** na barra lateral.
- **Agrupamento de Fontes & Troca de Fonte dentro do Player**: fontes agrupadas por idioma (`Dublado / Português`, `Original / Inglês`, `Outras`) ou por addon com filtros rápidos (`Todas`, `🇧🇷 PT / Dublado`, `4K / 1080p`), além de seletor **Fontes (N)** dentro do `VideoPlayer` para trocar de stream mantendo o tempo atual.
- **Identidade Visual Noir Âmbar & PWA**: remoção global de tons vermelhos (inclusive no Tema Claro e cursores SVG), geração de `favicon.ico`, `apple-touch-icon.png` e ícones `192x192`/`512x512`, `SavanoLoader` cobra-para-play ao carregar títulos e iniciar reprodução.
- **Navegação, Busca & Home Unificados**: barra lateral retrátil com hover-to-open sem sobrepor a busca, carrosséis de addons com setas de navegação (`AddonCarouselRow`), abas **Filmes** e **Séries** com gêneros locais + addons, **Continue assistindo** local + online na Home e busca unificada por Filmes/Séries.
- **Player Addons, Idiomas & Metadados PT-BR**: preservação de `duration` em streams torrent, seleção preferencial de faixa de áudio em português (`ffprobe` + `ffmpeg`), layout 50/50 estilo Stremio com modal de legendas, bandeiras SVG de países e tradução em cache de sinopses/episódios para PT-BR.
- **PIN Global `4321`, Tema `Momolada` exclusivo da Mari, `Me Surpreenda` com busca online, correção de `Capitão América: Guerra Civil` / `COMANDO.TO` / capas duplicadas e melhorias no Servidor & Conexões** (botões copiar, QR Code clicável, telemetria de IP/dispositivo/perfil e badge "Já instalado" nos presets de addons).

- Motor de streaming Torrent sob demanda (`scripts/torrent-stream.mjs` com `webtorrent`, suporte HTTP Range, transcode FFmpeg para `.mkv`/`.avi` e limpeza automática de cache temporário) + suporte HLS (`.m3u8`) via `hls.js` no `VideoPlayer` e busca unificada (acervo local + addons Stremio) na Home.
- Conector de Addons compatível com protocolo Stremio (`manifest.json` via HTTP/HTTPS): tabela `stremio_addons`, endpoints `/api/addons*` (`scripts/stremio-addons.mjs`), aba **Addons (Stremio)** com atalho na Sidebar, explorador de catálogos/episódios, busca de streams e legendas e reprodução direta no `VideoPlayer`.
- Sinopses em PT-BR (TMDB `pt-BR` + fallback Wikipedia PT para séries) e banners widescreen (`background` do TVMaze + `w1280` TMDB) em `scripts/fetch-artwork.mjs`.
- Exclusão de perfil (`DELETE /api/profiles/:id`) e tela *"Quem está assistindo?"* (`ProfileGate`) com cookie `sc_profile_session` (TTL 24h), além de organização dos 32 avatares em subpastas por coleção (`public/avatars/<colecao>/`).
- Estrutura React/TypeScript/Vite com SQLite local.
- Importação idempotente de `D:\Filmes` e `E:\Filmes`.
- Fontes removíveis identificadas na interface.
- Classificação de filmes, séries, temporadas, episódios, cursos e promocionais.
- Correções para South Park, Ben 10 e Gravity Falls.
- Perfis com criação, edição, avatar e persistência.
- Player local com streaming HTTP e suporte a Range.
- URLs próprias para páginas de séries e título da aba contextual.
- Títulos exibidos normalizados sem codecs, release tags e distribuidores.
- Tags iniciais, histórico de títulos e soft delete no banco.
- Download local de capas de filmes e séries (IMDb/Wikipedia/TVMaze) sem duplicação por episódio e filtro contra imagens placeholder.
- Troca de faixas de áudio durante transcoding mantendo posição real na timeline (`start=` + duração total via FFprobe) e busca funcional na barra.
- Reconciliação de episódios de South Park classificados como filme, limpeza de títulos e remoção lógica de clipes promocionais de release.
- Retomada automática de séries/filmes no último ponto assistido (e avanço ao próximo episódio após conclusão) + altura uniforme nos `MediaCard`.
- Boost de volume até 300% via Web Audio API (`GainNode` + `DynamicsCompressorNode`), velocidade de reprodução (`0.75x`–`2x`), PiP e preferências persistidas por perfil.
- Miniaturas de preview na timeline do player (`/api/media/:id/thumbnail` com cache em memória).
- Agrupamento de filmes duplicados com seletor de versões disponíveis, ordenação (`A–Z`, `Mais recentes`) e filtro `Não assistidos`.
- Diagnóstico automático de lacunas (`/api/catalog/gaps`) na aba **Arte & Metadados** do Admin com contadores em tempo real e botão **Copiar prompt de correção** para novas sessões.
- Progresso de reprodução persistido por perfil, com retomada e marcação de assistido.
- Scanner local de legendas SRT/VTT próximas, com idioma inferido pelo nome e validação de caminho no streaming.
- Endpoint seguro de análise de faixas com FFprobe, sem shell injection ou exposição de caminhos absolutos; fallback explícito quando o runtime está ausente.
- Endpoint de transcoding MP4 sob demanda com `spawn` sem shell, stream por `stdout`, validação de mídia/confinamento e fallback explícito sem FFmpeg.
- Navegação por controle com eixos horizontal/vertical, foco inicial previsível, seleção, voltar/fechar e exclusão de elementos invisíveis, preservando teclado.
- Fontes removíveis com volume/ID persistido e atualização online/offline independente da letra da unidade,
  usando consulta nativa segura do Windows quando disponível e fallback para o caminho conhecido.
- Status das fontes atualizado automaticamente ao iniciar a API e ao consultar `/api/sources`, sem
  remover registros offline ou alterar arquivos físicos.
- Interface atualiza `/api/sources` a cada 30 segundos, sem recarregar a página ou duplicar timers,
  preservando o fallback e limpando a consulta ao desmontar; avisos e contagens refletem o estado atual.
- Especiais em pastas `Curtas` agrupados dentro da série, sem cards independentes na biblioteca.
- Lint e build executados após as últimas alterações.
- Diagnóstico operacional em português com códigos de saída `0` (OK), `1` (avisos) e `2` (falha bloqueante),
  sem exposição de segredos e sem escrita no catálogo ou no acervo.
- Atualização controlada do catálogo pela sidebar, reutilizando o importador somente leitura,
  com status via API e bloqueio de execuções concorrentes.
- Smoke test somente de leitura para health, capabilities, fontes, biblioteca, revisão/histórico,
  progresso/rating e segurança básica de mídia/legenda; API indisponível gera falha explícita.
- Tela de revisão validada com 66 itens reais: ação de filme, especial/outro e ignorar têm destinos
  distintos, erro `404` é retornado e exibido, e o caminho físico permanece inalterado.
- Persistência isolada de `ratings` validada entre dois perfis distintos e presença de gêneros/tags verificada no catálogo (`scripts/verify-features.mjs`).
- Revisão de correspondências de arte implementada: tabela `artwork_candidates`, coleta de candidatos ambíguos em `scripts/fetch-artwork.mjs` (mantendo TMDB automático apenas para candidato único exato), endpoints `/api/artwork/candidates*` em `scripts/api-server.mjs` e painel `ArtworkReviewPanel` na interface.
- Guia operacional criado em `docs/operacao.md` documentando comandos, variáveis de ambiente e fluxos de revisão.
- Integração de legendas embutidas e provedores: endpoint `/api/media/:id/subtitles/embedded/:streamIndex` (extração WebVTT via FFmpeg quando disponível), busca/download com confirmação para OpenSubtitles (`/api/media/:id/subtitles/search` e `/download`) e botão **Buscar arte/metadados** na página de detalhe.
- Protocolo extensível de adapters de fontes autorizadas definido em `src/domain/sourceAdapter.ts`.
- Adapters concretos (`LocalSourceAdapter` e `SelfHostedSourceAdapter`) em `scripts/source-adapters.mjs`, cadastro de fontes via `POST /api/sources` na sidebar e edição reversível de metadados (`PATCH /api/catalog/:id`) + arquivamento na página de detalhe.
- Correção de acentuação em legendas `.srt`/`.vtt` com decodificação UTF-8 e fallback automático para Windows-1252/Latin-1, além de exibição permanente dos seletores de legenda e faixa de áudio no player.
- Primeira etapa de polimento visual do frontend: pôsteres tipográficos com título/ano para itens sem capa, badge `CC` para legendas disponíveis, fallback de poster no hero e bordas/sombras cinematográficas nos cards e hero.
- Cabeçalho panorâmico com backdrop na página de detalhe, barra de controles do player com acabamento translúcido e estados vazios estilizados.
- `SelfHostedSourceAdapter` integrado ao refresh do catálogo e ao streaming remoto (`302 Location`), validado em `scripts/verify-features.mjs`.
- `FFmpeg` e `FFprobe` (`Gyan.FFmpeg 9.0.2`) instalados e disponíveis no `PATH`, validados via `npm run doctor` e `/api/player/capabilities`.
- Handler centralizado de erros na API (`scripts/api-server.mjs`) com log estruturado em JSONL (`data/logs/api-errors.log`) e endpoint `GET /api/logs/errors` para monitoria.
- Filtro automático de vídeos promocionais/anúncios (`1XBET`, `dinheiro_livre`, `promo`, etc.) no scanner (`scripts/scan-media.mjs`) e saneamento automático na inicialização da API (`ignorePromotionalAds`), mantendo o catálogo livre de anúncios sem alterar arquivos físicos.
- Correção do transcode ao trocar faixa de áudio (`transcodeMedia` em `scripts/api-server.mjs`): remoção do bloqueio `416` para requisições com header `Range: bytes=0-` do `<video>` e suporte a seek via `?start=<segundos>`.
- Redesign do player estilo Netflix (`VideoPlayer` em `src/App.tsx` e `src/App.css`): controles embutidos com auto-hide por inatividade do mouse, overlay de pausa após 2,2s ("Você está assistindo a..." / "Pausado") e popover flutuante em duas colunas **Idioma | Legendas**.
- Redesign da página de detalhes estilo Netflix (`ShowHeader`): hero com backdrop, título em destaque e botão **▶ Assistir** proeminente, com detalhes técnicos, legendas locais e avaliação em bloco lateral secundário.
- Avaliação por 5 estrelas (`RatingControl`, mapeando `1..5` estrelas para `2..10` no SQLite) e ajuste de overflow em `.card-detail` para evitar texto vazando dos cards.
- Editor de perfil estilo Netflix com grupos de avatares temáticos por série (`Os Clássicos`, `South Park`, `Ben 10`, `Gravity Falls` em `src/domain/uiHelpers.ts`), transição com fade ao trocar de perfil, cursor temático nos cards clicáveis, filtros compactos com dropdown e gêneros traduzidos para PT-BR, correção do botão fechar `×` do modal de revisão de arte e marca **Savano Cine** clicável na sidebar (recolhendo para apenas o ícone `S` em telas menores).
- Adoção de Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react` e Design System padronizado (`src/styles/tokens.css`, `src/index.css` e primitivos em `src/components/ui/`: `Button`, `Badge`, `Modal`, `StarRating`), além da modularização completa do frontend em `src/components/`.
- Experiência de Home e navegação estilo Netflix / HBO Max / Prime Video: `HeroCarousel` rotativo com **▶ Assistir / Retome** + **ⓘ Mais informações**, carrosséis horizontais (`Continue assistindo` em 16:9 com barra de progresso, `Recomendados`, `Filmes`, `Séries` e gêneros), cards com clique na capa para reprodução direta e clique em `ⓘ` para detalhes, e `ShowDetailView` com abas **Você também pode gostar** e **Detalhes / Episódios** + botão **Reiniciar**.
- Suíte de testes automatizados: testes unitários em `node --test` (`tests/unit/clean-title.test.mjs`) e testes E2E com Playwright (`tests/e2e/critical-flows.spec.ts`) cobrindo Home, clique duplo nos cards (play vs detalhes), Painel Admin, Editor de Perfil e deep-link `/series/show-south-park`.
- Limpeza automática de títulos (`cleanTitle` + `sanitizeExistingTitles`) removendo tags de release (`AndreTPF`, `WOLVERDONFILMES`, `TDF`, `thepiratefilmes`, `BLUDV`) e anos no final do título, Painel Admin dedicado (`AdminView`) com botão `Buscar capas faltantes` (`POST /api/artwork/fetch`), cursor temático global, cache `sessionStorage` na Home, marcador de episódio ativo (`Assistindo agora`) e suporte a deep-links `/series/:id`.
- Atalhos de teclado no player (`Espaço`/`K` para play/pause, `Setas` para ±10s, `F` para tela cheia), cache de 60s em `refreshSourceStatuses` no `GET /api/sources` e limpeza de warnings do `oxlint`.
- Coleta de capas locais via `npm run artwork` (`data/artwork`), **Minha lista** por perfil (`POST /api/watchlist/toggle` + tabela `watchlist` + carrossel na Home + botão no Hero, Cards e Detalhes), avanço automático para o **Próximo episódio em 5s** no `VideoPlayer` e testes unitários de `uiHelpers.ts`.
- Barra de controles 100% customizada no `VideoPlayer` (timeline scrubber, volume/mute, `-10s/+10s`, `Idioma e legendas`, tela cheia) e painel de busca/download de legendas OpenSubtitles integrado no `ShowDetailView`.

## Regras do quadro

1. Não mover, renomear ou apagar arquivos físicos automaticamente.
2. Toda alteração de catálogo deve preservar o caminho original e permitir reversão.
3. Episódios só aparecem dentro de séries; a biblioteca principal mostra filmes e séries.
4. Cada cartão deve ter um resultado observável e um teste ou verificação correspondente.
5. Ao terminar um cartão, registrar o commit e atualizar este arquivo.
