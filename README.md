# Cine Local

Interface local para organizar e assistir filmes e séries armazenados em discos locais e HDs externos.

## Status

Aplicação local funcional em evolução incremental: o catálogo já usa SQLite, importa as fontes
locais, abre séries por rota própria, reproduz arquivos pelo player HTTP e baixa capas de séries.
O próximo ciclo é acompanhado no [Kanban](docs/kanban.md).

O nome da aplicação é **Savano Cine**. O repositório continua com o nome técnico `cine-local` para manter o histórico inicial simples.

## Arquitetura planejada

O projeto será organizado por responsabilidade, evitando uma camada única com regras de negócio misturadas à interface:

```text
src/
├── domain/          # entidades e regras de mídia
├── application/     # casos de uso: escanear, buscar, atualizar progresso
├── infrastructure/  # filesystem, SQLite, VLC e APIs externas
└── presentation/    # telas e componentes React
```

O protótipo atual mantém a tela principal em `src/App.tsx` para validar a experiência antes de extrair as próximas camadas.

## Decisões iniciais

- O repositório vive em `D:\Filmes\cine-local`, separado dos arquivos de mídia.
- Os arquivos originais serão tratados como somente leitura pelo scanner.
- Caminhos e fontes de mídia serão persistidos no banco; a interface não dependerá de renomear os arquivos.
- A aplicação será local e monousuário, sem autenticação ou backend remoto.
- A primeira integração de metadados será opcional e não bloqueará a reprodução offline.
- O SQLite será a fonte de verdade do catálogo; CSV/TXT não serão usados como banco principal.
- Uma caixa de entrada permitirá importar arquivos sem exigir organização manual prévia.
- IA local será opcional e só poderá sugerir alterações; a confirmação final continuará sendo do usuário.
- Capas serão tratadas como metadado substituível: primeiro arquivo local, depois fonte pública e, por último, geração por IA.

## Operação do projeto

O Kanban em `docs/kanban.md` é a referência de execução. A revisão automática do estado,
pendências e próximo incremento acontece a cada 2 minutos e 30 segundos de trabalho contínuo.
- Legendas serão priorizadas nesta ordem: embutidas, arquivos locais, OpenSubtitles e seleção manual.
- O importador associa somente arquivos `.srt` e `.vtt` na mesma pasta do vídeo, inferindo idiomas como
  `pt-BR`, `en` e `es` pelo sufixo do nome. O player converte SRT para WebVTT em tempo de resposta;
  legendas embutidas ficam reservadas para uma etapa futura com runtime externo.
- A biblioteca principal só exibe filmes e séries aprovados; cursos, coleções e arquivos promocionais ficam em revisão.

## Desenvolvimento

```bash
npm install
npm run dev
```

Verificações disponíveis:

```bash
npm run lint
npm run build
npm run doctor
npm run scan -- "D:\\Filmes" --limit 20
npm run import -- "E:\\Filmes"
npm run api
```

O scanner é somente leitura. Ele não renomeia, move ou exclui arquivos; apenas gera uma classificação preliminar para a futura tela de revisão.

`npm run doctor` executa um diagnóstico operacional somente leitura em português. Ele verifica o
SQLite e seu schema, fontes cadastradas e online/offline, contagens de filmes, séries e itens em
revisão, artes locais, legendas registradas e a disponibilidade de FFmpeg, FFprobe e VLC. O código
de saída é `0` quando tudo está disponível, `1` quando há avisos operacionais (como uma fonte
offline ou runtime ausente) e `2` quando o banco não existe, está ilegível ou tem schema incompatível.
O comando não imprime valores de variáveis de ambiente, não expõe segredos e não altera dados nem
arquivos físicos.

Fontes em volumes Windows persistem o identificador do volume, rótulo e caminho relativo. A API
reconsulta os volumes montados para reconhecer uma unidade reconectada com outra letra; quando a
consulta nativa não está disponível, mantém o fallback pelo caminho salvo. Nenhum arquivo físico é alterado.

O schema SQLite inicial está em `database/schema.sql`. Ele ainda não é carregado automaticamente pela interface; essa será a próxima etapa do backend local.

O comando `import` cria `data/catalog.db` localmente e importa os caminhos encontrados sem alterar os arquivos de mídia. A pasta `data/` fica fora do Git.

Com o catálogo importado, `npm run api` inicia a API local em `http://127.0.0.1:4174`; o Vite encaminha as chamadas `/api` automaticamente durante o desenvolvimento.

`/api/player/capabilities` detecta automaticamente `ffmpeg.exe`, `ffprobe.exe` e `vlc.exe`
no PATH do Windows. As variáveis `CINE_FFMPEG_PATH`, `CINE_FFPROBE_PATH` e
`CINE_VLC_PATH` têm prioridade quando apontam para arquivos existentes. A rota retorna
somente disponibilidade e diagnóstico seguro da origem (`environment`, `path` ou `none`);
não expõe caminhos absolutos. Nenhum runtime é instalado e nenhum transcoding é executado
por essa detecção.

`GET /api/media/:mediaId/streams` valida a mídia no catálogo e, quando o FFprobe está
disponível, analisa faixas internas de áudio e legendas usando `execFile` sem shell.
A resposta nunca inclui o caminho físico. Sem FFprobe, retorna `available: false` com
listas vazias, mantendo o player web atual funcionando; a interface informa a indisponibilidade
e mantém as legendas externas existentes. Quando FFprobe e FFmpeg estão disponíveis, o modal
exibe as faixas detectadas e usa `/api/media/:mediaId/transcode?format=mp4&audioStream=...`
(opcionalmente `subtitleStream=...`) para trocar a faixa sem fingir suporte nativo do navegador
a MKV/AVI.

`GET /api/media/:mediaId/transcode?format=mp4` prepara um stream MP4 fragmentado sob demanda
com FFmpeg, usando `spawn` sem shell, `stdout` e nenhum arquivo temporário. O endpoint valida
o ID, a mídia ativa e o confinamento ao diretório da fonte antes de iniciar o processo. Sem
FFmpeg, responde `200` com `{ "available": false, "reason": "ffmpeg-not-found" }`; Range não
é aplicado ao stream transcodificado, mas o streaming progressivo continua disponível. A
reprodução web existente não é redirecionada automaticamente para evitar regressões.

`npm run artwork` usa TVMaze para séries e Wikipedia para filmes, sem exigir `TMDB_API_KEY`.
Quando `TMDB_API_KEY` estiver configurada, a busca aceita somente um título exato no TMDB
e baixa um backdrop separado quando a fonte pública fornecer `backdrop_path`. Sem uma
correspondência única ou sem backdrop adequado, a interface usa o poster como fallback;
nenhum vídeo ou arquivo do acervo é alterado.
Para acervos cujo título é melhor atendido em outro idioma, a busca pode começar por uma
Wikipedia configurável e recua para português e inglês:

```powershell
$env:CINE_WIKIPEDIA_LANG = "en"
npm run artwork
```

Para habilitar backdrops públicos de filmes:

```powershell
$env:TMDB_API_KEY = "sua-chave"
npm run artwork
```

As capas e metadados são gravados apenas em `data/` e os arquivos físicos do acervo permanecem inalterados.
