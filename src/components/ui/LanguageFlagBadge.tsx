import { Badge } from './Badge'

type FlagCode = 'BR' | 'PT' | 'US' | 'ES' | 'RU' | 'FR' | 'JP' | 'IT' | 'DE' | 'DUAL' | 'LEG'

function resolveFlagCode(label: string): FlagCode {
  const upper = label.toUpperCase()
  if (upper.includes('PT-BR') || upper.includes('DUBLADO') || upper.includes('🇧🇷')) return 'BR'
  if (upper.includes('PT-PT') || upper.includes('🇵🇹')) return 'PT'
  if (upper.includes('DUAL')) return 'DUAL'
  if (upper.includes('LEGENDADO') || upper.includes('LEG')) return 'LEG'
  if (upper.includes('ENG') || upper.includes('🇺🇸') || upper.includes('🇬🇧')) return 'US'
  if (upper.includes('ESP') || upper.includes('🇪🇸')) return 'ES'
  if (upper.includes('RUS') || upper.includes('🇷🇺')) return 'RU'
  if (upper.includes('FRA') || upper.includes('🇫🇷')) return 'FR'
  if (upper.includes('JPN') || upper.includes('🇯🇵')) return 'JP'
  if (upper.includes('ITA') || upper.includes('🇮🇹')) return 'IT'
  if (upper.includes('GER') || upper.includes('🇩🇪')) return 'DE'
  return 'DUAL'
}

function FlagSvg({ code }: { code: FlagCode }) {
  switch (code) {
    case 'BR':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="16" fill="#009c3b" />
          <polygon points="12,2 21,8 12,14 3,8" fill="#ffdf00" />
          <circle cx="12" cy="8" r="3.2" fill="#002776" />
        </svg>
      )
    case 'PT':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="9" height="16" fill="#006600" />
          <rect x="9" width="15" height="16" fill="#ff0000" />
          <circle cx="9" cy="8" r="3" fill="#ffdf00" />
        </svg>
      )
    case 'US':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="16" fill="#b22234" />
          <rect y="2" width="24" height="2" fill="#ffffff" />
          <rect y="6" width="24" height="2" fill="#ffffff" />
          <rect y="10" width="24" height="2" fill="#ffffff" />
          <rect y="14" width="24" height="2" fill="#ffffff" />
          <rect width="10" height="8" fill="#3c3b6e" />
        </svg>
      )
    case 'ES':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="16" fill="#aa151b" />
          <rect y="4" width="24" height="8" fill="#f1bf00" />
        </svg>
      )
    case 'RU':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="5.3" fill="#ffffff" />
          <rect y="5.3" width="24" height="5.4" fill="#0039a6" />
          <rect y="10.7" width="24" height="5.3" fill="#d52b1e" />
        </svg>
      )
    case 'FR':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="8" height="16" fill="#002395" />
          <rect x="8" width="8" height="16" fill="#ffffff" />
          <rect x="16" width="8" height="16" fill="#ed2939" />
        </svg>
      )
    case 'JP':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="16" fill="#ffffff" />
          <circle cx="12" cy="8" r="4.2" fill="#bc002d" />
        </svg>
      )
    case 'IT':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="8" height="16" fill="#009246" />
          <rect x="8" width="8" height="16" fill="#ffffff" />
          <rect x="16" width="8" height="16" fill="#ce2b37" />
        </svg>
      )
    case 'DE':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="24" height="5.3" fill="#000000" />
          <rect y="5.3" width="24" height="5.4" fill="#dd0000" />
          <rect y="10.7" width="24" height="5.3" fill="#ffce00" />
        </svg>
      )
    case 'DUAL':
    case 'LEG':
      return (
        <svg viewBox="0 0 24 16" className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-xs" aria-hidden="true">
          <rect width="12" height="16" fill="#009c3b" />
          <rect x="12" width="12" height="16" fill="#3c3b6e" />
          <circle cx="12" cy="8" r="3" fill="#ffdf00" />
        </svg>
      )
  }
}

function stripEmojiPrefix(label: string): string {
  return label.replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*|^[🔊💬]\s*/u, '').trim()
}

export function LanguageFlagBadge({ label }: { label: string }) {
  const code = resolveFlagCode(label)
  return (
    <Badge tone={code === 'BR' ? 'gold' : 'neutral'}>
      <FlagSvg code={code} />
      <span>{stripEmojiPrefix(label)}</span>
    </Badge>
  )
}
