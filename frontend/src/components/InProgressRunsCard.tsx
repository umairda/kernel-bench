import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { benchmarkLabel, formatBenchmarkParams } from '../benchmarks/benchmarkRegistry'
import type { RunRecord } from '../lib/api'
import { useDeleteQueuedRunMutation } from '../lib/api'
import { GlowCard } from './aceternity/glow-card'

function priorityTimestamp(run: RunRecord) {
  return run.queuedAt ?? run.createdAt ?? ''
}

function sortByQueuePriority(items: RunRecord[]) {
  return [...items].sort((a, b) => {
    const byTime = priorityTimestamp(a).localeCompare(priorityTimestamp(b))
    return byTime !== 0 ? byTime : a.runId.localeCompare(b.runId)
  })
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'n/a'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusClasses(status: RunRecord['status']) {
  if (status === 'RUNNING') {
    return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
  }
  if (status === 'STARTING') {
    return 'border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-300'
  }
  return 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300'
}

export function InProgressRunsCard({ items }: { items: RunRecord[] }) {
  const orderedItems = useMemo(() => sortByQueuePriority(items.filter((item) => item.status === 'QUEUED')), [items])
  const firstRunId = orderedItems[0]?.runId
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(() => new Set(firstRunId ? [firstRunId] : []))
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteQueuedRun = useDeleteQueuedRunMutation()
  const count = orderedItems.length
  const badgeLabel = `${count} queued ${count === 1 ? 'run' : 'runs'}`

  useEffect(() => {
    setOpenRunIds((current) => {
      const currentIds = new Set(orderedItems.map((item) => item.runId))
      const next = new Set([...current].filter((runId) => currentIds.has(runId)))
      if (firstRunId) {
        next.add(firstRunId)
      }
      return next
    })
  }, [firstRunId, orderedItems])

  const toggleRun = (runId: string) => {
    setOpenRunIds((current) => {
      const next = new Set(current)
      if (next.has(runId)) {
        next.delete(runId)
      } else {
        next.add(runId)
      }
      return next
    })
  }

  const handleDelete = async (runId: string) => {
    try {
      setDeleteError(null)
      await deleteQueuedRun.mutateAsync(runId)
    } catch (error) {
      setDeleteError(String(error))
    }
  }

  return (
    <GlowCard>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-3">
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Queued Runs</span>
          <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200">
            {badgeLabel}
          </span>
        </span>
      </div>

      {deleteError ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/50 dark:bg-red-900/30 dark:text-red-200">
          {deleteError}
        </div>
      ) : null}

      {orderedItems.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No queued runs.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {orderedItems.map((run, index) => {
            const isOpen = openRunIds.has(run.runId)
            const canDelete = run.status === 'QUEUED'
            const isDeleting = deleteQueuedRun.isPending && deleteQueuedRun.variables === run.runId
            return (
              <div key={run.runId} className="rounded-xl border border-zinc-300 bg-zinc-50 dark:border-white/10 dark:bg-zinc-950/70">
                <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <button
                    type="button"
                    onClick={() => toggleRun(run.runId)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown className={`h-4 w-4 shrink-0 text-cyan-700 transition-transform dark:text-cyan-300 ${isOpen ? 'rotate-180' : ''}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Priority {index + 1}: {run.runner.toUpperCase()} {benchmarkLabel(run.benchmark)}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {formatBenchmarkParams(run.benchmark, run.params)}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClasses(run.status)}`}>
                      {run.status}
                    </span>
                    <button
                      type="button"
                      disabled={!canDelete || isDeleting}
                      title={canDelete ? 'Delete queued run' : 'Only queued runs can be deleted'}
                      onClick={() => void handleDelete(run.runId)}
                      className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:border-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 disabled:hover:bg-white dark:border-red-500/40 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/30 dark:disabled:border-white/10 dark:disabled:text-zinc-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {isDeleting ? 'Deleting' : 'Delete'}
                    </button>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-zinc-300 p-3 text-xs text-zinc-700 dark:border-white/10 dark:text-zinc-300">
                        <dl className="grid gap-2 md:grid-cols-2">
                          <div>
                            <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Run ID</dt>
                            <dd className="break-all">{run.runId}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Queued At</dt>
                            <dd>{formatDateTime(run.queuedAt ?? run.createdAt)}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Runner</dt>
                            <dd>{run.runner.toUpperCase()}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Benchmark</dt>
                            <dd>{benchmarkLabel(run.benchmark)}</dd>
                          </div>
                          <div className="md:col-span-2">
                            <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Parameters</dt>
                            <dd>{formatBenchmarkParams(run.benchmark, run.params)}</dd>
                          </div>
                        </dl>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}
    </GlowCard>
  )
}
