# Arquitetura do Cine Local

## Objetivo

Construir uma aplicação desktop local, simples de manter, que transforme uma ou mais pastas de mídia em uma biblioteca navegável sem modificar os arquivos originais.

## Limites de responsabilidade

### Domínio

Contém conceitos independentes da interface:

- `MediaItem`
- `Movie`
- `Show`
- `Season`
- `Episode`
- `MediaSource`
- progresso de reprodução

### Aplicação

Orquestra ações do usuário e do sistema:

- adicionar fonte de mídia;
- escanear uma fonte;
- interpretar nomes de arquivos;
- buscar títulos;
- salvar progresso;
- detectar arquivos ausentes.

### Infraestrutura

Implementa detalhes substituíveis:

- filesystem local;
- SQLite;
- integração com VLC/FFmpeg;
- TMDB ou outra fonte de metadados.

### Apresentação

React deverá consumir casos de uso e não acessar o filesystem diretamente. Isso permite trocar a interface sem reescrever a regra de catalogação.

## Fluxo planejado do scanner

```text
Fonte cadastrada
  -> varredura recursiva
  -> filtro de extensões suportadas
  -> classificação filme/série
  -> extração de temporada e episódio
  -> persistência por caminho estável
  -> enriquecimento opcional de metadados
```

O caminho original será preservado. Títulos, anos e episódios serão dados normalizados no banco, não uma exigência para os arquivos físicos.

O primeiro scanner determinístico está disponível em `scripts/scan-media.mjs`. Ele serve como etapa de pré-importação e pode ser executado antes da existência do banco:

```bash
npm run scan -- "E:\\Filmes" --limit 20
```

Além dos padrões `S01E01`, `1x01` e `01.01`, o scanner reconhece episódios numerados dentro de pastas como `1ª Temporada`, `1ª. Temporada` e `Season 01`. Isso cobre coleções antigas como Ben 10 sem exigir renomeação imediata.

## Contrato de classificação

O catálogo não tratará todo arquivo de vídeo como filme:

| Categoria | Regra inicial | Biblioteca principal |
| --- | --- | --- |
| Filme | arquivo isolado sem contexto de episódio | sim |
| Episódio | padrão de episódio ou número dentro de pasta de temporada | dentro da série |
| Coleção/curso | caminho com curso, módulo ou coleção conhecida | revisão |
| Promocional/outro | trailer, uploader, propaganda ou arquivo auxiliar | revisão |

Itens com baixa certeza não serão forçados para filme. Eles entram como `other` com `classification_status = review`, preservando o caminho para decisão manual ou sugestão da IA. Conteúdos em pastas `Curtas` seguem essa regra como especiais: ficam fora da biblioteca principal, mas continuam vinculados ao caminho original para uma futura tela de extras.

A tela de revisão oferece três decisões explícitas: **Corrigir como filme**, que aprova o item como `movie` e o inclui na biblioteca; **Aprovar como especial/outro**, que aprova como `other` e mantém o item fora da biblioteca principal; e **Ignorar**, que marca `classification_status = ignored`. Falhas da API são exibidas no próprio painel. Nenhuma decisão altera o arquivo físico.

O scanner aceita temporadas numéricas (`Season 01`, `1ª Temporada`) e ordinais em português (`Primeira Temporada`, `Segunda Temporada`). Também reconhece identificadores de episódio `S01E01`, `S1EP01`, `1x01` e `01.01`.

## Rating e controle remoto

Avaliações são pessoais e ficam separadas dos metadados externos, com nota de 0 a 10 e comentário opcional. O schema já possui a tabela `ratings` para filmes e séries.

A interface deve ser operável sem mouse: elementos importantes usam foco visível, `Escape` volta para a biblioteca, `/` leva à busca e a Gamepad API permite mover o foco e selecionar. O mapeamento será refinado junto com o player real, mantendo teclado como fallback confiável.

O schema inicial está em `database/schema.sql`. Ele separa a origem física (`media_sources`) do catálogo (`media_items`) e das relações de série (`shows`, `seasons`, `episodes`). Assim, remover o SSD altera o estado da fonte para `offline`, sem apagar o catálogo, o progresso ou as capas.

O comando `npm run import -- "E:\\Filmes"` já executa essa primeira persistência local. Duplicidades de temporada/episódio não apagam arquivos: o primeiro vínculo é mantido e os demais continuam registrados como `media_items` para a futura revisão.

A API local em `scripts/api-server.mjs` expõe o catálogo somente para leitura em `/api/library`, `/api/sources` e `/api/health`. A interface usa esses endpoints quando disponíveis e mantém o protótipo como fallback durante o desenvolvimento.

## Importação assistida

A organização terá três níveis, nesta ordem:

1. **Determinístico:** extensão, pasta, padrões `S01E01`, `1x01`, `01.01`, tamanho e duração.
2. **Metadados públicos opcionais:** busca por título/ano em uma fonte configurada.
3. **IA local opcional:** usada apenas quando os níveis anteriores não resolverem o caso ou quando houver mais de uma interpretação.

O fluxo da tela será:

```text
Adicionar arquivo/pasta
  -> prévia do que será alterado
  -> sugestões de título, tipo, temporada e episódio
  -> usuário confirma ou edita
  -> catálogo SQLite atualizado
  -> arquivo original preservado
```

Uma integração local com Ollama pode ser adicionada depois. O modelo não terá permissão para mover, apagar ou renomear arquivos sozinho; ele retornará uma sugestão estruturada para a aplicação validar.

## Capas e metadados visuais

Cada item terá uma referência de arte independente do arquivo de vídeo:

1. capa encontrada na própria pasta;
2. capa obtida de uma fonte pública configurada;
3. capa gerada por IA, explicitamente marcada como gerada;
4. fallback visual sem imagem.

O catálogo guarda a origem e se a capa foi validada. A interface nunca deve assumir que uma capa pública ou gerada está correta sem permitir revisão manual.

Quando uma capa for aprovada, o arquivo poderá ser salvo ao lado da mídia, por exemplo `poster.jpg`, e o SQLite guardará `local_path`, `remote_url`, `provider` e `provider_id`. O vídeo original não será alterado. O caminho local será relativo à fonte para continuar funcionando quando a letra do SSD mudar.

## Legendas

A estratégia recomendada é:

1. detectar faixas embutidas no arquivo;
2. procurar arquivos locais com o mesmo nome (`.srt`, `.ass`, `.vtt`);
3. consultar OpenSubtitles por hash e, depois, por título/temporada/episódio;
4. mostrar os resultados com idioma, qualidade e provedor para confirmação;
5. baixar a faixa escolhida ao lado do vídeo e registrar o caminho relativo no SQLite.

OpenSubtitles é a primeira opção para integração porque possui busca por arquivo e catálogo de filmes/séries, mas requer conta/chave e deve ser usado respeitando seus termos e limites. A aplicação não deve baixar legendas automaticamente sem aprovação. A tabela `subtitle_tracks` já separa provedor, identificador remoto, URL e caminho local.

## Por que SQLite em vez de CSV/TXT

CSV e TXT podem ser úteis para exportação ou backup legível, mas não são adequados como fonte principal porque não lidam bem com relações entre série, temporada, episódio, arquivo, legendas e progresso. SQLite mantém tudo em um único arquivo local, permite consultas, transações e migrações, sem exigir um servidor.

## Evolução em pequenos commits

1. Protótipo visual navegável.
2. Modelo SQLite e migrações.
3. Cadastro e leitura de fontes.
4. Scanner de filmes.
5. Scanner de séries e episódios.
6. Player e progresso.
7. Capas/metadados.
8. Suporte a HD externo e arquivos indisponíveis.
9. Caixa de entrada para importação manual.
10. Sugestões de metadados e IA local com confirmação.
