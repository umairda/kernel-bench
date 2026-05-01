import type { PropsWithChildren } from 'react'

export function GlowCard({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-zinc-300/60 bg-white/90 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/60 dark:shadow-none ${className}`}>
      <div className="pointer-events-none absolute -left-20 -top-20 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl dark:bg-cyan-500/15" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-500/15" />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
