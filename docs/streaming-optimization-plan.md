# Diagnóstico Técnico & Plano de Otimização de Streaming (Addons + Torrent)

Data da análise: 2026-11-22  
Status: **Implementado** (Pilares A, B e C + isolamento de TV e séries)  
Objetivo: Eliminar o "loading infinito" e falhas ao reproduzir filmes e séries dos addons Stremio, alcançando reprodução fluida estilo Stremio/Real-Debrid mesmo em torrent puro ou HTTP direto.

---

## 1. Diagnóstico Real (Testes Executados nos Addons Instalados)

| Addon | Resultado do Teste (`Interestelar / tt0816692`) | Causa Raiz Identificada |
| --- | --- | --- |
| **FenixFlix** | `11` streams HTTP (`302` → `workers.dev`, `206 Partial Content`, `video/mp4`, `ACAO: *`, ~6.6 GB) | **Saudável** quando o navegador segue o `302`; se algum mirror bloquear `Referer`/CORS ou vier em MKV/H.265, precisa de proxy HTTP no backend. |
| **Hyper** | `4` streams HTTP (`480p/360p MP4 H.265`), retornou **HTTP 429 (`text/html`)** sem headers | Exige `behaviorHints.proxyHeaders.request` (`Referer: https://mzfi.me/`) e possui `notWebReady: true` (H.265). Passar a URL direta para `<video>` sempre falha. |
| **Mico-Leão Dublado 🇧🇷** | `8` streams (`infoHash`), teste em `56dd7a14...` deu **TIMEOUT 15s (0 peers)** | Torrents antigos/BR sem informação de `seeders` no JSON; muitos estão mortos (0 peers). O usuário clica no 1º dublado e fica preso em loading infinito por 25s. |
| **Torrentio** | `500` streams (`infoHash`), teste em `d8d05ebe...` obteve metadados em **6.5s** (`2 peers`, **13 arquivos**) | Metadados ok, mas sem `deselect` dos outros 12 arquivos, sem lista ampliada de trackers/DHT e sem buffer sequencial antes de abrir o `<video>`. |
| **TorrentsDB** | `165` streams (`infoHash` em maiúsculas) | Muitos releases são REMUX 4K HDR / Russian-first, pesados demais para streaming instantâneo no browser sem transcode/seleção de versão leve. |
| **Peerflix** | `23` streams (`infoHash`) | Funcional, depende de peers/trackers. |
| **Brazuca Torrents / TPB Catalog** | **HTTP 500** no `/stream/...` | Addons instáveis no servidor de origem. |
| **Iracemaflix / Absolute Cinema / Archive.org** | **TIMEOUT** no `/stream/...` | Servidores lentos ou offline. |

---

## 2. Por que hoje dá "Loading Infinito" ou Falha no Player?

1. **WebTorrent baixando todos os arquivos do torrent**:
   - Em `scripts/torrent-stream.mjs`, chamamos `file.select()` **sem** chamar `torrent.deselect(0, torrent.pieces.length - 1, false)` antes. Em pacotes com 13 arquivos ou temporadas de 20 episódios, a banda é desperdiçada baixando arquivos que não estão sendo assistidos.
2. **Apenas 4 trackers no magnet link + descarte dos `sources` do addon**:
   - `DEFAULT_TRACKERS` em `torrent-stream.mjs` tem apenas 4 trackers, e ignoramos o array `stream.sources` (`tracker:udp://...`) enviado por addons como Torrentio/TorrentsDB.
3. **Sem pré-buffer sequencial nem feedback de progresso real no Player**:
   - O `<video>` faz a requisição `/api/addons/torrent-stream`, que demora 6–15s só para conectar peers + baixar os primeiros MB + rodar `ffprobe` (2MB) antes de enviar o byte 0. O `<video>` do Chrome muitas vezes aborta ou estoura timeout antes de receber o cabeçalho.
4. **MP4 com `moov` atom no final + múltiplas requisições `Range` do Chrome**:
   - Ao abrir um `.mp4` via torrent, o Chrome lê os primeiros KB, **aborta** e pede `Range` do **final do arquivo** para ler o `moov` atom. Como o final do arquivo ainda não foi baixado, trava.
5. **FFmpeg em `.mkv`/`.avi` sem flags de baixa latência + queda ao dar seek**:
   - Faltam flags como `-probesize 500000 -analyzeduration 1000000 -fflags +genpts` no `ffmpeg` para emitir o primeiro fragmento MP4 (`frag_keyframe+empty_moov+default_base_moof`) em ~1s em vez de esperar vários MBs.
6. **Streams HTTP diretos com `proxyHeaders` / H.265 (`Hyper`, etc.) sem proxy**:
   - O frontend joga `stream.url` direto no `<video>`, ignorando `behaviorHints.proxyHeaders` (`Referer`, `User-Agent`) e `notWebReady`.
7. **Torrents mortos (0 seeds) indistinguíveis na UI + sem fallback automático**:
   - Addons como Mico-Leão não informam `seeders`. O player fica 25s travado num torrent morto em vez de detectar `0 peers` em 6–8s e pular automaticamente para a próxima fonte saudável!

---

## 3. Plano de Otimização Técnica (Para Revisão)

### Pilar A — Motor Torrent de Baixa Latência (`scripts/torrent-stream.mjs`)
1. **Isolamento estrito de peças**:
   - Ao abrir `file`, executar `torrent.deselect(0, torrent.pieces.length - 1, false)` e selecionar **apenas** o intervalo de peças de `file` (priorizando os primeiros ~5% e últimos ~2% do arquivo em `.mp4` para entregar o `moov` atom instantaneamente!).
2. **Lista robusta de 20+ Trackers + `sources` do Addon + WebSeeds**:
   - Expandir `DEFAULT_TRACKERS` (UDP + HTTP + WSS) e aceitar `sources` via query/API vindo do stream do addon.
3. **Pré-aquecimento (`POST /api/addons/torrent-prepare`) + Barra de Buffer real**:
   - Antes ou junto de abrir o player, iniciar o torrent e exibir na tela de loading (`SavanoLoader`): *"Conectando peers (12) · Buffer 1.8 MB / 4 MB · 850 KB/s"* e só montar o `<video>` quando os primeiros ~1.5 MB iniciais estiverem em disco/RAM!
4. **FFmpeg Low-Latency + Remux Inteligente (`frag_keyframe+empty_moov+default_base_moof`)**:
   - Usar `-probesize 500000 -analyzeduration 1000000` e, para `.mp4` com `notWebReady` ou áudio AC3/DTS/EAC3, transcodificar apenas o áudio para AAC mantendo o vídeo em `copy` (muito mais leve que re-encodar vídeo!).
   - Se o navegador reportar codec não suportado (`H.265` / `HEVC` no Chrome sem hardware), fallback opcional para transcode H.264 `ultrafast`.

### Pilar B — Proxy HTTP Seguro para Streams com `Referer` / CORS (`scripts/api-server.mjs`)
1. **Endpoint `/api/addons/http-proxy`**:
   - Para streams com `behaviorHints.proxyHeaders` (como **Hyper**) ou que bloqueiem CORS/hotlink, o backend faz o fetch com os headers exigidos (`Referer`, `User-Agent`) repassando `Range` / `206 Partial Content` para o `<video>`.
2. **Suporte completo a HLS (`.m3u8`) via proxy**:
   - Reescrever segmentos relativos do `.m3u8` quando necessário para o `hls.js` reproduzir sem erro de CORS (fundamental também para TV ao Vivo / FenixFlix / Iracemaflix).

### Pilar C — Experiência Fluida & Fallback Automático (`AddonDetailView.tsx` + `VideoPlayer.tsx`)
1. **Detecção rápida de torrent morto + Auto-Fallback ("Tentando próxima fonte...")**:
   - Se em **8 segundos** um torrent tiver `0 peers` e `0 bytes/s` (ou se um stream HTTP der `403`/`429`/`404`), o `VideoPlayer` avisa *"Fonte sem resposta — tentando próxima fonte disponível..."* e troca automaticamente para o próximo item de `alternativeSources`!
2. **Botão Principal "▶ Assistir Melhor Fonte" (1 Clique) + Ocultar Streams Sem Vídeo**:
   - Filtrar/rebaixar streams sem `url` e sem `infoHash` (como `🔒 [DASH]` do Hyper ou banners de doação `LivePix` do ZinTV BR) para não poluir a lista.
   - Destacar um botão **▶ Assistir Melhor Fonte** que escolhe automaticamente HTTP direto saudável (ex.: *FenixFlix 1080p Dublado*) ou Torrent leve com mais seeds (`<= 4 GB`), com fallback em cascata.
3. **Suporte a `externalUrl` (Rede Canais TV) & Diagnóstico Transparente no Loading**:
   - Exibir botão **Abrir no Navegador** quando o stream retornar `externalUrl` (ex.: `Rede Canais TV`).
   - Durante o loading do player, mostrar a etapa real (*"1/3 Conectando peers (N)..."*, *"2/3 Lendo áudio e duração..."*, *"3/3 Iniciando vídeo..."*) + botão **"Trocar fonte agora"** visível imediatamente durante o carregamento.
4. **Priorização inteligente & Aviso de Arquivo Pesado**:
   - Classificar no topo fontes **HTTP diretas funcionais** (ex: `FenixFlix`) e **Torrents com `>= 10 seeds` e tamanho `<= 4 GB`** antes de torrents sem seeds conhecidos ou REMUXes/AV1/DTS-HD de 20–75 GB.
   - Marcar streams acima de `15 GB` com badge *"Arquivo pesado (melhor baixar)"*.
5. **Cache LRU de Torrents Recentes & Fallback Transcode para H.265/MKV HTTP**:
   - Não apagar chunks de torrent imediatamente ao pausar/trocar de fonte (manter cache LRU curto para retomada instantânea).
   - Se um stream HTTP direto (ex.: `Hyper` H.265 ou `.mkv`) disparar erro de codec no Chrome, acionar fallback automático para `/api/addons/http-transcode` via FFmpeg.
6. **Circuit Breaker também para Legendas (`queryAddonSubtitles`)**:
   - Aplicar o mesmo timeout curto (4,5s) e cooldown de 60s em `queryAddonSubtitles` para que addons de legenda lentos (`LegendasBR` em timeout) não atrasem o `OpenSubtitles v3`.
7. **Integração opcional com Serviços de Debrid / qBittorrent Sequencial**:
   - **Real-Debrid / AllDebrid / TorBox** (se o usuário tiver chave no futuro): transforma qualquer torrent (inclusive os com 0 seeds ou 4K de 60 GB) em streaming HTTP instantâneo em <1s.
   - **qBittorrent Sequential Download**: opção de usar o qBittorrent local (se ativo) em modo sequencial para torrents grandes.

---

## 4. Descobertas Adicionais (Séries, TV ao Vivo & Legendas)

- **Séries (`Gravity Falls S01E01`)**:
  - **FenixFlix** retornou `5` streams **HTTP diretos em 1080p Dublado PT-BR** (muito mais rápido que torrent pack).
  - **Torrentio / TorrentsDB** retornaram packs de **20 a 40+ episódios** (`fileIdx: 2`, `fileIdx: 20`) com codecs como **AV1 + DTS-HD MA 5.1**, reforçando a necessidade crítica de `torrent.deselect(...)` nos outros arquivos e transcode de áudio para AAC.
  - **Hyper** retornou streams bloqueados (`🔒 [DASH]`) sem `url` nem `infoHash`.
- **TV ao Vivo (`Rede Canais TV`, `Absolute Cinema`, `ZinTV BR`)**:
  - **Rede Canais TV** (`142` canais) retorna `externalUrl` (player web próprio) em vez de `.m3u8`.
  - **Absolute Cinema** retorna `.m3u8` HLS direto.
  - **ZinTV BR** mistura item de doação (`LivePix` `externalUrl`) no primeiro catálogo.
- **Legendas**:
  - **OpenSubtitles v3** retornou `98` legendas (`HTTP 200 UTF-8 .srt`).
  - **LegendasBR** deu timeout — precisa entrar no circuit breaker de legendas.
