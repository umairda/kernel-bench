import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleHelp } from 'lucide-react'

export function AnimatedTooltip({
  content,
  className = '',
}: {
  content: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const tooltipId = useId()

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        aria-label={content}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 transition hover:text-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 dark:text-zinc-500 dark:hover:text-cyan-300"
      >
        <CircleHelp className="h-4 w-4" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-2xl border border-cyan-500/20 bg-zinc-950 px-3 py-2 text-left text-[11px] font-medium normal-case tracking-normal text-zinc-100 shadow-xl dark:border-cyan-300/20"
          >
            {content}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  )
}
