# Kanban do Savano Cine

Este arquivo é o roteiro operacional do projeto. Cada mudança relevante deve mover um cartão
de coluna e terminar com um commit pequeno e verificável.

A auto-revisão do quadro acontece a cada 2 minutos e 30 segundos de trabalho contínuo,
com atualização do insight atual, riscos encontrados e próximo plano.

## Em andamento

| Prioridade | Cartão | Próxima verificação |
| --- | --- | --- |
| Alta | Player compatível com o acervo | Modal integrado a `/streams`; seleção de faixas usa transcoding MP4 quando FFprobe/FFmpeg estão disponíveis; ambiente atual informa indisponibilidade |
| Média | Arte e metadados de filmes | Wikipedia configurável com fallback pt/en; backdrops TMDB opcionais por correspondência exata, com fallback para poster |
| Média | Histórico e restauração de alterações | Tela operacional lista arquivados e títulos alterados; restauração lógica validada por API |

## Próximo ciclo

| Prioridade | Cartão | Resultado esperado |
| --- | --- | --- |
| Média | Busca de legendas OpenSubtitles na interface | Botão no detalhe/player para acionar `/api/media/:id/subtitles/search` e baixar legendas faltantes |
| Baixa | Barra de controles 100% customizada no player | Substituir `<video controls>` nativo por timeline e volume integrados ao Design System |

## Backlog

| Área | Cartão | Observação |
| --- | --- | --- |
| Integrações | Adapters de fontes autorizadas | Protocolo base definido em `src/domain/sourceAdapter.ts`; adapters concretos para servidores próprios/licenciados ficam no backlog |

## Concluído

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
- Download local de capas de séries sem duplicação por episódio.
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

## Regras do quadro

1. Não mover, renomear ou apagar arquivos físicos automaticamente.
2. Toda alteração de catálogo deve preservar o caminho original e permitir reversão.
3. Episódios só aparecem dentro de séries; a biblioteca principal mostra filmes e séries.
4. Cada cartão deve ter um resultado observável e um teste ou verificação correspondente.
5. Ao terminar um cartão, registrar o commit e atualizar este arquivo.
