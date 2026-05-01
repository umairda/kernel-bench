import type { RunRecord } from '../lib/api'
import { GlowCard } from './aceternity/glow-card'

export function InProgressRunsCard({ items }: { items: RunRecord[] }) {
  return (
    <GlowCard>
      <h2 className="mb-2 text-lg font-semibold">Active Runs</h2>
      <pre className="overflow-x-auto rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100">
        {JSON.stringify(items, null, 2)}
      </pre>
    </GlowCard>
  )
}
