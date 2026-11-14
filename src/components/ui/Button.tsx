import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'light' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-white border-transparent shadow-lg shadow-red-950/40',
  light: 'bg-white hover:bg-white/90 text-neutral-950 border-transparent font-semibold shadow-lg',
  secondary: 'bg-white/12 hover:bg-white/20 text-white border-white/15 backdrop-blur-md',
  ghost: 'bg-transparent hover:bg-white/10 text-[var(--sc-text-secondary)] hover:text-white border-transparent',
  danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border-red-400/30',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-[var(--sc-radius-sm)]',
  md: 'h-10 px-4 text-sm gap-2 rounded-[var(--sc-radius-md)]',
  lg: 'h-11 px-6 text-sm sm:text-base gap-2.5 rounded-[var(--sc-radius-md)]',
}

/** Standardized Design System button with consistent variants and focus ring. */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center border font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sc-accent)] ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
