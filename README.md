# Cine Local

Interface local para organizar e assistir filmes e séries armazenados em discos locais e HDs externos.

## Status

Protótipo inicial da interface. A biblioteca exibida ainda usa dados estáticos; o próximo passo é conectar o scanner de arquivos ao banco SQLite.

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
- Legendas serão priorizadas nesta ordem: embutidas, arquivos locais, OpenSubtitles e seleção manual.
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
npm run scan -- "D:\\Filmes" --limit 20
npm run import -- "E:\\Filmes"
npm run api
```

O scanner é somente leitura. Ele não renomeia, move ou exclui arquivos; apenas gera uma classificação preliminar para a futura tela de revisão.

O schema SQLite inicial está em `database/schema.sql`. Ele ainda não é carregado automaticamente pela interface; essa será a próxima etapa do backend local.

O comando `import` cria `data/catalog.db` localmente e importa os caminhos encontrados sem alterar os arquivos de mídia. A pasta `data/` fica fora do Git.

Com o catálogo importado, `npm run api` inicia a API local em `http://127.0.0.1:4174`; o Vite encaminha as chamadas `/api` automaticamente durante o desenvolvimento.
