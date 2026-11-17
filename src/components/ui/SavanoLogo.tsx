import { useId } from 'react'

type SavanoLogoProps = {
  size?: number
  animated?: boolean
  className?: string
}

/** Official Noir Âmbar Savano Cine vectorized SVG emblem (snake-S + apple + Play). */
export function SavanoLogo({ size = 36, animated = false, className = '' }: SavanoLogoProps) {
  const gradId = useId()

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradId})`} />
      <path
        className={animated ? 'sc-snake-crawl' : undefined}
        d={
          animated
            ? 'M 8 45 H 36 C 40 45 43 42 43 38 C 43 34 40 31 36 31 H 27 C 23 31 20 28 20 24 C 20 20 23 17 27 17 H 42'
            : 'M 20 45 H 36 C 40 45 43 42 43 38 C 43 34 40 31 36 31 H 27 C 23 31 20 28 20 24 C 20 20 23 17 27 17 H 41'
        }
        stroke="white"
        strokeWidth="5.8"
        strokeLinecap="round"
      />
      <circle
        className={animated ? 'sc-snake-apple' : undefined}
        cx="45"
        cy="17"
        r="4.1"
        fill="#f43f5e"
        stroke="white"
        strokeWidth="1.3"
      />
      <polygon
        className={animated ? 'sc-snake-play' : undefined}
        points="28,26.5 38,32 28,37.5"
        fill="#090a0d"
      />
    </svg>
  )
}
