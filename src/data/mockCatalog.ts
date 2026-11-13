import type { Episode, LibraryItem, MediaSource, SubtitleTrack } from '../domain/catalog'

export const mediaSources: MediaSource[] = [
  {
    id: 'local-filmes',
    name: 'Biblioteca local',
    path: 'D:\\Filmes',
    status: 'online',
    removable: false,
    itemCount: 3,
  },
  {
    id: 'ssd-filmes',
    name: 'SSD externo',
    path: 'E:\\Filmes',
    status: 'online',
    removable: true,
    itemCount: 0,
    volumeLabel: 'Extends',
  },
]

const portugueseSubtitle: SubtitleTrack = {
  language: 'pt-BR',
  label: 'Português (Brasil)',
  available: true,
}

const noSubtitle: SubtitleTrack = {
  language: 'pt-BR',
  label: 'Nenhuma faixa cadastrada',
  available: false,
}

const southParkEpisodes: Episode[] = [
  {
    id: 'south-park-s01e01',
    season: 1,
    number: 1,
    title: 'Cartman Tem uma Sonda Anal',
    filename: '01.01 - Cartman Tem uma Sonda Anal.rmvb',
    duration: '21 min',
    subtitles: [noSubtitle],
  },
  {
    id: 'south-park-s01e02',
    season: 1,
    number: 2,
    title: 'Ganhe Peso 4000',
    filename: '01.02 - Ganhe Peso 4000.rmvb',
    duration: '22 min',
    subtitles: [noSubtitle],
  },
  {
    id: 'south-park-s01e03',
    season: 1,
    number: 3,
    title: 'Vulcão',
    filename: '01.03 - Vulcão.rmvb',
    duration: '22 min',
    subtitles: [noSubtitle],
  },
  {
    id: 'south-park-s01e04',
    season: 1,
    number: 4,
    title: 'A Grande Viagem Gay de Barco',
    filename: '01.04 - A Grande Viagem Gay de Barco.rmvb',
    duration: '22 min',
    subtitles: [noSubtitle],
  },
  {
    id: 'south-park-s01e05',
    season: 1,
    number: 5,
    title: 'Um Elefante faz Amor com uma Porca',
    filename: '01.05 - Um Elefante faz Amor com uma Porca.rmvb',
    duration: '22 min',
    subtitles: [noSubtitle],
  },
  {
    id: 'south-park-s01e06',
    season: 1,
    number: 6,
    title: 'Morte',
    filename: '01.06 - Morte.rmvb',
    duration: '22 min',
    progress: 42,
    position: '13:24',
    subtitles: [portugueseSubtitle],
  },
  {
    id: 'south-park-s01e07',
    season: 1,
    number: 7,
    title: 'Olho Cor-de-Rosa',
    filename: '01.07 - Olho Cor-de-Rosa.rmvb',
    duration: '22 min',
    subtitles: [noSubtitle],
  },
]

export const library: LibraryItem[] = [
  {
    id: 'south-park',
    title: 'South Park',
    kind: 'Série',
    meta: '15 temporadas',
    detail: '216 episódios encontrados',
    posterClass: 'poster-south-park',
    artwork: { source: 'none', verified: false },
    progress: 42,
    seasons: [{ number: 1, episodes: southParkEpisodes }],
  },
  {
    id: 'marighella',
    title: 'Marighella',
    kind: 'Filme',
    meta: '2019 · 1080p',
    detail: 'MKV · 3,8 GB',
    posterClass: 'poster-marighella',
    artwork: { source: 'none', verified: false },
  },
  {
    id: 'a-fuga-do-planeta-terra',
    title: 'A Fuga do Planeta Terra',
    kind: 'Filme',
    meta: '2013 · 720p',
    detail: 'MP4 · 724 MB',
    posterClass: 'poster-fuga',
    artwork: { source: 'none', verified: false },
  },
]
