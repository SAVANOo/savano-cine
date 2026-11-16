import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'light' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-white border-transparent shadow-lg shadow-pink-950/20',
  light: 'bg-[var(--sc-text-primary)] hover:opacity-90 text-[var(--sc-bg-canvas)] border-transparent font-semibold shadow-lg',
  secondary: 'bg-[var(--sc-bg-surface)] hover:bg-[var(--sc-bg-surface-hover)] text-[var(--sc-text-primary)] border-[var(--sc-border-subtle)] backdrop-blur-md',
  ghost: 'bg-transparent hover:bg-[var(--sc-bg-surface)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] border-transparent',
  danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border-red-400/30',
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
