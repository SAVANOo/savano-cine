# Mapeamento Exploratório Exaustivo — Savano Cine

Data do levantamento: 2026-11-22  
Objetivo: Consolidar achados técnicos reais da base de código e referências de mercado (OWASP, WCAG 2.2, 10-Foot TV UI, Jellyfin/Plex/Stremio) para orientar os próximos ciclos de evolução.

---

## 1. Segurança (Hardening & Defesa em Profundidade)

| Item | Situação Atual Observada | Risco / Impacto | Ação Recomendada |
| --- | --- | --- | --- |
| **Redirect-SSRF em Proxies** | `scripts/api-server.mjs` (`http-proxy` L887, `subtitle-proxy`) usa `fetch(..., { redirect: 'follow' })` após validar apenas a URL inicial. | Um host externo pode responder `302 Location: http://127.0.0.1:4174/...` ou rede local, contornando `isPrivateHostname`. | Usar `redirect: 'manual'`, validar cada hop (`301/302/307/308`, máx. 5 hops) com `isPrivateHostname` + `net.BlockList`. |
| **DNS Rebinding em `isPrivateHostname`** | `isPrivateHostname` valida apenas a string do hostname (`localhost`, `192.168.*`), sem resolver DNS. | Domínio externo resolvendo para IP privado (`127.0.0.1` / `10.0.0.1`) passa na checagem. | Validar IP resolvido via `dns.lookup` contra `net.BlockList` (IPv4 + IPv6 mapeado `::ffff:`). |
| **CORS & Headers Defensivos** | `api-server.mjs:283` define `Access-Control-Allow-Origin: *` globalmente junto a endpoints que usam cookies (`sc_pin_ok`, `sc_profile_session`). | Superfície desnecessária se exposto via túnel público. | Refletir `Origin` apenas para allowlist (localhost / LAN / túnel ativo) e adicionar `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` e `X-Frame-Options: SAMEORIGIN`. |
| **Isolamento de Banco para Testes (`CINE_DB_PATH`)** | `api-server.mjs:51` e scripts apontam fixamente para `data/catalog.db`. | Testes ou scripts concorrentes escrevem no banco de produção local. | Suportar `process.env.CINE_DB_PATH` em `api-server.mjs` e nos scripts para rodar E2E em cópia temporária isolada. |

---

## 2. Acessibilidade (WCAG 2.2 & 10-Foot Smart TV UI)

| Item | Situação Atual Observada | Impacto | Ação Recomendada |
| --- | --- | --- | --- |
| **Focus Trap & ARIA em Modais** | `src/components/ui/Modal.tsx` tem `role="dialog"` e `aria-modal="true"`, mas não possui `aria-labelledby`, focus trap (`Tab`/`Shift+Tab`), `Escape` interno nem restauração de foco ao fechar. | Usuários de teclado/leitor de tela ou controle de TV escapam do modal para o fundo invisível. | Implementar focus trap, `aria-labelledby` ligado ao `<h2>`, fechamento por `Escape` e restauração de `document.activeElement` ao desmontar. |
| **Seekbar Semântica no Player** | `VideoPlayer.tsx` usa barra de progresso customizada sem `role="slider"`, `aria-valuemin`, `aria-valuemax` e `aria-valuenow`. | Leitores de tela (TalkBack/NVDA) não anunciam posição/duração nem permitem scrub acessível. | Adicionar `role="slider"`, atributos `aria-value*` e setas `ArrowLeft`/`ArrowRight` focáveis na timeline. |
| **Auto-Hide durante Foco por Teclado/TV** | Timer de `2800ms` oculta controles quando o mouse para, sem checar se o foco de teclado/D-pad está dentro dos controles. | Controles somem enquanto o usuário navega no Modo Smart TV. | Cancelar/pausar o timer sempre que `:focus-within` estiver ativo na barra de controles ou menus abertos. |
| **Ações ocultas apenas no `:hover`** | Botão `×` de remover em `AddonCarouselRow` usa `opacity-0 group-hover:opacity-100`. | Inacessível em dispositivos touch (celular/tablet) e navegação por foco. | Adicionar `group-focus-within:opacity-100` e visibilidade discreta em dispositivos touch (`pointer: coarse`), garantindo alvo mínimo `>= 24x24px` (WCAG 2.5.8). |

---

## 3. Design, UX & Arquitetura de Frontend

| Item | Situação Atual Observada | Ação Recomendada |
| --- | --- | --- |
| **Unificação de Fluxo Online (`AddonStreamModal.tsx`)** | `AddonStreamModal.tsx` (522 linhas) ainda é usado em `OnlineCatalogView.tsx:410` e `ShowDetailView.tsx:632`, duplicando lógica antiga sem `scoreAddonStream`, `http-proxy` ou paginação. | Direcionar esses dois pontos para `AddonDetailView` e remover `AddonStreamModal.tsx` (mantendo apenas o tipo `AddonMetaSummary` em `domain/`). |
| **Remover do *Continue assistindo (Local)*** | Apenas *Continue assistindo (Online)* possui botão `×` para remover títulos abandonados. | Adicionar `DELETE /api/progress` na API e botão `×` discreto nos cards de *Continue assistindo* local. |
| **Decomposição de Arquivos Grandes** | `VideoPlayer.tsx` (2030 linhas), `App.tsx` (1954 linhas) e `AddonDetailView.tsx` (1176 linhas) concentram muitos sub-componentes. | Extrair `useSearchHistory`, `useUrlNavigation`, `PlayerOptionsMenu`, `PlayerRemotePopover` e `StreamSourceList` para melhorar legibilidade e manutenção. |
| **Navegação por Teclado em Dropdowns** | Dropdown de histórico de busca (`#sc-search-input`) e menu *Opções* do player dependem de clique. | Suportar `ArrowDown`/`ArrowUp`/`Enter`/`Escape` no histórico de busca e nos popovers do player. |

---

## 4. Performance & Otimização

| Item | Situação Atual Observada | Ação Recomendada |
| --- | --- | --- |
| **ETag / `304 Not Modified` em `/api/catalog`** | `/api/catalog` envia todo o JSON a cada troca de perfil ou F5 (mesmo comprimido com gzip). | Gerar ETag por `(profileId, catalogVersion)` e responder `304 Not Modified` quando inalterado. |
| **Transcode com Aceleração por Hardware** | `ffmpeg` em `torrent-stream.mjs` e `api-server.mjs` usa transcode por CPU (`libx264 ultrafast`). | Detectar GPU (`h264_nvenc`, `h264_qsv`, `h264_amf`) no startup (`/api/player/capabilities`) e usar quando disponível com fallback automático para CPU. |
| **Cache em Disco / Proxy de Capas Externas** | Capas externas dos addons vêm direto de CDNs terceiros (alguns lentos ou instáveis no 4G). | Cache opcional leve em disco (`data/artwork/cache/`) com TTL e `Cache-Control: public, max-age=86400`. |
| **Trickplay / Sprites na Timeline Online** | Miniaturas da timeline existem para mídia local, mas não para streams HTTP/Torrent. | Gerar sprite/thumbnail sob demanda quando houver seek em stream HTTP estável. |

---

## 5. Features & Streaming

| Item | Descrição & Valor |
| --- | --- |
| **Integração Opcional com Debrid (Real-Debrid / TorBox / AllDebrid)** | Campo de API Token opcional no Admin/Addons: converte qualquer `infoHash` (inclusive 0 seeds ou 4K 50GB) em link HTTP CDN direto com início em `< 1s`. |
| **Auto-Skip de Abertura & Auto-Play Próximo Episódio** | Preferência por perfil para pular abertura automaticamente ou avançar para o próximo episódio sem clique. |
| **Botão "Reproduzir em App Externo" (VLC / MX Player)** | Link/intent `vlc://` ou `intent://` no player mobile/desktop para streams H.265/AC3 pesados sem transcode. |
| **Perfis com Preferência de Áudio/Legenda Persistida** | Configuração explícita por perfil (*Dublado primeiro* vs *Legendado original + 2ª legenda de estudo*). |
