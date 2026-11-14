# Guia Operacional — Cine Local (Savano Cine)

Este guia complementa [`architecture.md`](architecture.md) e [`kanban.md`](kanban.md) com os comandos de operação, variáveis de ambiente, fluxos de revisão e pontos de verificação do projeto.

## 1. Execução em desenvolvimento

A interface (`vite`) e a API local (`scripts/api-server.mjs`) rodam em processos separados:

```bash
# Terminal 1: API local (padrão http://127.0.0.1:4174)
npm run api

# Terminal 2: Interface web (Vite)
npm run dev
```

## 2. Importação e coleta de metadados

Todos os scripts abaixo preservam os arquivos físicos originais (nenhum vídeo é movido, renomeado ou apagado):

- **Pré-visualização do scanner (sem gravar no banco):**
  ```bash
  npm run scan -- "D:\\Filmes" --limit 20
  ```
- **Importação idempotente para o SQLite (`data/catalog.db`):**
  ```bash
  npm run import -- "D:\\Filmes"
  ```
  Também é possível disparar a atualização controlada pela própria interface, no botão **Atualizar catálogo** da barra lateral (com bloqueio de execuções concorrentes).
- **Coleta de artes e sinopses:**
  ```bash
  npm run artwork
  ```
  - Séries usam TVMaze (`singlesearch/shows`); se não houver correspondência direta, candidatos são salvos para revisão.
  - Filmes usam Wikipedia (com fallback de idioma) e, opcionalmente, TMDB para *backdrops*.
  - Correspondências exatas únicas são aplicadas automaticamente; correspondências ambíguas são armazenadas em `artwork_candidates` com status `pending`.

## 3. Fluxos de revisão na interface

A barra lateral oferece três painéis operacionais que atuam somente sobre o catálogo SQLite:

1. **⚑ Revisão (`ReviewPanel`):** resolve itens classificados como `review` com três ações explícitas: *Corrigir como filme*, *Aprovar como especial/outro* ou *Ignorar*.
2. **🖼 Arte (`ArtworkReviewPanel`):** exibe candidatos ambíguos de pôster/backdrop/sinopse agrupados por filme ou série, permitindo **Confirmar e aplicar** (baixa a arte localmente em `data/artwork/` e marca como verificada) ou **Descartar**.
3. **↶ Histórico (`CatalogHistoryPanel`):** lista itens arquivados (*soft delete*) e alterações de título, permitindo restauração lógica.

## 4. Variáveis de ambiente suportadas

| Variável | Uso | Padrão |
| --- | --- | --- |
| `CINE_API_PORT` | Porta HTTP da API local | `4174` |
| `CINE_API_URL` | URL base usada por `smoke.mjs` e `verify-features.mjs` | `http://127.0.0.1:4174` |
| `CINE_WIKIPEDIA_LANG` | Idioma preferido para busca na Wikipedia (fallback `pt`, `en`) | `pt` |
| `TMDB_API_KEY` | Chave opcional do TMDB para *backdrops* e candidatos de filmes | não definida |
| `OPENSUBTITLES_API_KEY` | Chave opcional para busca e download com confirmação de legendas no OpenSubtitles | não definida |
| `OPENSUBTITLES_USER_AGENT` | User-Agent enviado nas requisições ao OpenSubtitles | `SavanoCine v1.0` |
| `CINE_FFMPEG_PATH` | Caminho explícito para `ffmpeg` (transcoding MP4 sob demanda) | busca no `PATH` |
| `CINE_FFPROBE_PATH` | Caminho explícito para `ffprobe` (inspeção de faixas de áudio/legenda) | busca no `PATH` |
| `CINE_VLC_PATH` | Caminho explícito para `vlc` (diagnóstico de runtime externo) | busca no `PATH` |

> Nunca registre chaves de API ou segredos no repositório ou nos arquivos de documentação.

## 5. Verificação e diagnóstico

- **Diagnóstico do ambiente (`0` OK, `1` avisos, `2` falha bloqueante):**
  ```bash
  npm run doctor
  ```
- **Lint e build:**
  ```bash
  npm run lint
  npm run build
  ```
- **Smoke test da API local (somente leitura, com a API em execução):**
  ```bash
  npm run smoke
  ```
- **Verificação funcional de perfis/ratings, tags e revisão de arte (com a API em execução):**
  ```bash
  node scripts/verify-features.mjs
  ```

## 6. Comportamento quando runtimes externos estão ausentes

Se `ffmpeg`, `ffprobe` ou `vlc` não estiverem instalados ou configurados:
- O player web continua reproduzindo diretamente via streaming HTTP com suporte a `Range` (`/api/media/:id`) e legendas locais `.srt`/`.vtt` próximas ao vídeo.
- O endpoint `/api/player/capabilities` informa explicitamente a indisponibilidade de cada runtime, e a seleção de faixas alternativas com transcoding MP4 fica desabilitada sem quebrar a interface.
