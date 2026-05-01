import { AnimatePresence, motion } from 'framer-motion'
import type { PropsWithChildren } from 'react'

type AccordionSectionProps = PropsWithChildren<{
  title: string
  open: boolean
  onToggle: () => void
}>

export function AccordionSection({ title, open, onToggle, children }: AccordionSectionProps) {
  return (
    <div className="rounded-2xl border border-zinc-300/70 bg-white/80 dark:border-white/10 dark:bg-zinc-900/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left text-lg font-semibold text-zinc-900 dark:text-zinc-100"
      >
        <span>{title}</span>
        <span className="text-sm text-cyan-700 dark:text-cyan-300">{open ? 'Collapse' : 'Expand'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
