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
