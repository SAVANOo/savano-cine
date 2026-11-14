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
| Média | Troca de faixa de áudio com FFmpeg/FFprobe no ambiente | Garantir FFmpeg e FFprobe configurados no sistema (`CINE_FFMPEG_PATH`/`CINE_FFPROBE_PATH`) para habilitar troca real de faixa de áudio em MKV/MP4 multi-áudio |
| Média | Polimento visual contínuo (tela de detalhe e player customizado) | Refinar cabeçalho de detalhe com backdrop panorâmico, controles customizados de player e estados vazios ilustrados |
| Baixa | Adapter HTTP/remoto de fontes autorizadas | Implementar adapter concreto baseado em `src/domain/sourceAdapter.ts` para servidores próprios |

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

## Regras do quadro

1. Não mover, renomear ou apagar arquivos físicos automaticamente.
2. Toda alteração de catálogo deve preservar o caminho original e permitir reversão.
3. Episódios só aparecem dentro de séries; a biblioteca principal mostra filmes e séries.
4. Cada cartão deve ter um resultado observável e um teste ou verificação correspondente.
5. Ao terminar um cartão, registrar o commit e atualizar este arquivo.
