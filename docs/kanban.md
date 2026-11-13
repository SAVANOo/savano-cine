# Kanban do Savano Cine

Este arquivo é o roteiro operacional do projeto. Cada mudança relevante deve mover um cartão
de coluna e terminar com um commit pequeno e verificável.

A auto-revisão do quadro acontece a cada 2 minutos e 30 segundos de trabalho contínuo,
com atualização do insight atual, riscos encontrados e próximo plano.

## Em andamento

_Nenhuma tarefa bloqueante no momento._

## Próximo ciclo

| Prioridade | Cartão | Resultado esperado |
| --- | --- | --- |
| Alta | Arte e metadados de filmes | Buscar poster, banner, ano, sinopse e gêneros com fonte pública configurável, sem alterar o arquivo físico |
| Alta | Player compatível com o acervo | Detectar formatos não suportados pelo navegador e preparar conversão/transcodificação via FFmpeg/VLC |
| Alta | Progresso por perfil | Salvar posição, duração e assistido por perfil, com retomada real no botão Continuar |
| Média | Tela de revisão | Aprovar, corrigir, ignorar ou transformar itens classificados como `review` |

## Backlog

| Área | Cartão | Observação |
| --- | --- | --- |
| Catálogo | Tags pesquisáveis e filtros por gênero | Usar metadados confirmados; manter tags manuais possíveis |
| Catálogo | Histórico e restauração de alterações | Soft delete e títulos já possuem base no SQLite; falta uma tela operacional |
| Séries | Especiais e extras | Exibir `Curtas` dentro da série sem misturar com temporadas normais |
| Legendas | Scanner local e integração autorizada | Priorizar embutidas, arquivos próximos e depois provedores |
| Perfis | Rating de 0 a 10 por perfil | Persistir nota e comentário sem tornar rating global |
| Interface | Navegação completa por controle | Foco, seleção, voltar, busca e player |
| Fontes | Detecção automática de SSD offline/online | Identificar volume por ID, não apenas pela letra da unidade |
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
- Lint e build executados após as últimas alterações.

## Regras do quadro

1. Não mover, renomear ou apagar arquivos físicos automaticamente.
2. Toda alteração de catálogo deve preservar o caminho original e permitir reversão.
3. Episódios só aparecem dentro de séries; a biblioteca principal mostra filmes e séries.
4. Cada cartão deve ter um resultado observável e um teste ou verificação correspondente.
5. Ao terminar um cartão, registrar o commit e atualizar este arquivo.
