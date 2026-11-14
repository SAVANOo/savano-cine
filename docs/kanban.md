# Kanban do Savano Cine

Este arquivo é o roteiro operacional do projeto. Cada mudança relevante deve mover um cartão
de coluna e terminar com um commit pequeno e verificável.

A auto-revisão do quadro acontece a cada 2 minutos e 30 segundos de trabalho contínuo,
com atualização do insight atual, riscos encontrados e próximo plano.

## Em andamento

| Prioridade | Cartão | Próxima verificação |
| --- | --- | --- |
| Alta | Player compatível com o acervo | Modal integrado a `/streams`; seleção de faixas usa transcoding MP4 quando FFprobe/FFmpeg estão disponíveis; ambiente atual informa indisponibilidade |
| Média | Tela de revisão | Listagem e ações locais implementadas; falta validar com itens reais `review` |
| Média | Rating por perfil | API, migração compatível e controle na página de detalhe implementados; falta validar persistência por dois perfis |
| Média | Tags e filtros pesquisáveis | Filtros de gênero e tags derivados do catálogo adicionados; falta testar com metadados ampliados |
| Média | Arte e metadados de filmes | Wikipedia configurável com fallback pt/en; backdrops TMDB opcionais por correspondência exata, com fallback para poster |
| Média | Histórico e restauração de alterações | Tela operacional lista arquivados e títulos alterados; restauração lógica validada por API |

## Próximo ciclo

| Prioridade | Cartão | Resultado esperado |
| --- | --- | --- |
| Alta | Revisão de correspondências de arte | Exibir candidatos e permitir confirmação antes de aplicar metadados ambíguos; TMDB só aceita candidato único exato |

## Backlog

| Área | Cartão | Observação |
| --- | --- | --- |
| Legendas | Scanner local e integração autorizada | Scanner de SRT/VTT próximos concluído; embutidas e provedores continuam futuras |
| Integrações | Adapters de fontes autorizadas | Protocolo extensível para acervo local, servidores próprios e provedores licenciados |

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
- Especiais em pastas `Curtas` agrupados dentro da série, sem cards independentes na biblioteca.
- Lint e build executados após as últimas alterações.

## Regras do quadro

1. Não mover, renomear ou apagar arquivos físicos automaticamente.
2. Toda alteração de catálogo deve preservar o caminho original e permitir reversão.
3. Episódios só aparecem dentro de séries; a biblioteca principal mostra filmes e séries.
4. Cada cartão deve ter um resultado observável e um teste ou verificação correspondente.
5. Ao terminar um cartão, registrar o commit e atualizar este arquivo.
