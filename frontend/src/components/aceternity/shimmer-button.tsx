import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

export function ShimmerButton({
  children,
  className = '',
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }>) {
  return (
    <button
      className={`group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-full border border-cyan-500/40 bg-white px-6 text-sm font-semibold text-zinc-900 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-400/40 dark:bg-zinc-950 dark:text-white dark:shadow-none ${className}`}
      {...props}
    >
      <span className="absolute inset-0 -translate-x-full animate-[shimmer_2.4s_infinite] bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent dark:via-cyan-300/35" />
      <span className="relative z-10">{children}</span>
    </button>
  )
}
