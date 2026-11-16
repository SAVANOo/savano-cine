/** Extracts language and audio badges (with country flags) from a Stremio stream name/title. */
export function extractStreamLanguages(text: string): string[] {
  const badges: string[] = []
  const upper = text.toUpperCase()
  const flagMap: Array<[RegExp, string]> = [
    [/🇧🇷|PT-BR|PTBR|BRAZIL|BRASIL/i, '🇧🇷 PT-BR'],
    [/DUBLADO|\bDUB\b/i, '🇧🇷 Dublado'],
    [/DUAL[\s_-]?AUDIO|\bDUAL\b/i, '🔊 Dual Áudio'],
    [/LEGENDADO|\bLEG\b/i, '💬 Legendado'],
    [/🇵🇹|PT-PT/i, '🇵🇹 PT-PT'],
    [/🇺🇸|🇬🇧|\bENG\b|\bENGLISH\b/i, '🇺🇸 ENG'],
    [/🇪🇸|\bSPA\b|\bESP\b|LATINO/i, '🇪🇸 ESP'],
    [/🇷🇺|\bRUS\b|RUTRACKER/i, '🇷🇺 RUS'],
    [/🇫🇷|\bFRE\b|\bFRA\b/i, '🇫🇷 FRA'],
    [/🇯🇵|\bJPN\b|\bJAP\b/i, '🇯🇵 JPN'],
    [/🇮🇹|\bITA\b/i, '🇮🇹 ITA'],
    [/🇩🇪|\bGER\b|\bDEU\b/i, '🇩🇪 GER'],
  ]
  for (const [pattern, label] of flagMap) {
    if (pattern.test(upper) && !badges.includes(label)) {
      badges.push(label)
    }
  }
  return badges.slice(0, 3)
}
