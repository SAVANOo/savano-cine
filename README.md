# Cine Local

Interface local para organizar e assistir filmes e séries armazenados em discos locais e HDs externos.

## Status

Protótipo inicial da interface. A biblioteca exibida ainda usa dados estáticos; o próximo passo é conectar o scanner de arquivos ao banco SQLite.

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

## Desenvolvimento

```bash
npm install
npm run dev
```

Verificações disponíveis:

```bash
npm run lint
npm run build
```
