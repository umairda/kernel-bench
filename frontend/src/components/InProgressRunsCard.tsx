import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { RunRecord } from '../lib/api'
import { GlowCard } from './aceternity/glow-card'

export function InProgressRunsCard({ items }: { items: RunRecord[] }) {
  const [open, setOpen] = useState(false)
  const count = items.length
  const badgeLabel = `${count} queued/active ${count === 1 ? 'run' : 'runs'}`

  return (
    <GlowCard>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Active Runs</span>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200">
            {badgeLabel}
          </span>
        </span>
        <span className="text-sm font-medium text-cyan-700 dark:text-cyan-300">{open ? 'Collapse' : 'Expand'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="mt-4 overflow-x-auto rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
              {JSON.stringify(items, null, 2)}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </GlowCard>
  )
}
