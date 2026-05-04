import { useEffect, useMemo, useState } from 'react'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { benchmarkLabel, formatBenchmarkParams } from '../benchmarks/benchmarkRegistry'
import type { RunRecord, Runner } from '../lib/api'
import { useDeleteQueuedRunMutation, useReorderQueuedRunsMutation, useStartRunMutation } from '../lib/api'
import { RunStatusCard } from './RunStatusCard'
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

function sortByCompletion(items: RunRecord[]) {
  return [...items].sort((a, b) => {
    const aTime = String(a.completedAt ?? a.updatedAt ?? a.createdAt ?? '')
    const bTime = String(b.completedAt ?? b.updatedAt ?? b.createdAt ?? '')
    const byTime = bTime.localeCompare(aTime)
    return byTime !== 0 ? byTime : a.runId.localeCompare(b.runId)
  })
}

function isTerminalRun(run: RunRecord) {
  return run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED'
}

function isActiveRun(run: RunRecord) {
  return run.status === 'STARTING' || run.status === 'RUNNING'
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

function SortableQueuedRun({
  run,
  index,
  isOpen,
  isDeleting,
  onToggle,
  onDelete,
}: {
  run: RunRecord
  index: number
  isOpen: boolean
  isDeleting: boolean
  onToggle: (runId: string) => void
  onDelete: (runId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: run.runId })
  const canDelete = run.status === 'QUEUED'
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-zinc-300 bg-zinc-50 dark:border-white/10 dark:bg-zinc-950/70 ${isDragging ? 'relative z-10 opacity-80 shadow-lg' : ''}`}
    >
      <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-500 transition hover:border-cyan-400 hover:text-cyan-700 active:cursor-grabbing dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-cyan-300"
            aria-label={`Drag queued run ${index + 1}`}
            title="Drag to change queue priority"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(run.runId)}
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClasses(run.status)}`}>
            {run.status}
          </span>
          <button
            type="button"
            disabled={!canDelete || isDeleting}
            title={canDelete ? 'Delete queued run' : 'Only queued runs can be deleted'}
            onClick={() => onDelete(run.runId)}
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
}

function ActiveRunRow({ run, isOpen, onToggle }: { run: RunRecord; isOpen: boolean; onToggle: (runId: string) => void }) {
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/20">
      <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={() => onToggle(run.runId)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={isOpen}
        >
          <ChevronDown className={`h-4 w-4 shrink-0 text-emerald-700 transition-transform dark:text-emerald-300 ${isOpen ? 'rotate-180' : ''}`} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Active: {run.runner.toUpperCase()} {benchmarkLabel(run.benchmark)}
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {formatBenchmarkParams(run.benchmark, run.params)}
            </span>
          </span>
        </button>
        <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClasses(run.status)}`}>
          {run.status}
        </span>
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
            <div className="border-t border-emerald-300 p-3 text-xs text-zinc-700 dark:border-emerald-500/30 dark:text-zinc-300">
              <dl className="grid gap-2 md:grid-cols-2">
                <div>
                  <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Run ID</dt>
                  <dd className="break-all">{run.runId}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-zinc-900 dark:text-zinc-100">Started At</dt>
                  <dd>{formatDateTime(run.dispatchStartedAt ?? run.updatedAt ?? run.createdAt)}</dd>
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
}

export function InProgressRunsCard({
  items,
  completedItems = [],
  cpuState = 'unknown',
  gpuState = 'unknown',
}: {
  items: RunRecord[]
  completedItems?: RunRecord[]
  cpuState?: string
  gpuState?: string
}) {
  const orderedCpuItems = useMemo(() => sortByQueuePriority(items.filter((item) => item.status === 'QUEUED' && item.runner === 'cpu')), [items])
  const orderedGpuItems = useMemo(() => sortByQueuePriority(items.filter((item) => item.status === 'QUEUED' && item.runner === 'gpu')), [items])
  const activeCpuRun = useMemo(() => sortByCompletion(items.filter((item) => isActiveRun(item) && item.runner === 'cpu'))[0], [items])
  const activeGpuRun = useMemo(() => sortByCompletion(items.filter((item) => isActiveRun(item) && item.runner === 'gpu'))[0], [items])
  const orderedItems = useMemo(() => [...orderedCpuItems, ...orderedGpuItems], [orderedCpuItems, orderedGpuItems])
  const completedRuns = useMemo(() => sortByCompletion(completedItems.filter(isTerminalRun)).slice(0, 6), [completedItems])
  const firstRunIds = useMemo(() => [
    activeCpuRun?.runId ?? orderedCpuItems[0]?.runId,
    activeGpuRun?.runId ?? orderedGpuItems[0]?.runId,
  ].filter((runId): runId is string => Boolean(runId)), [activeCpuRun, activeGpuRun, orderedCpuItems, orderedGpuItems])
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(() => new Set(firstRunIds))
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null)
  const deleteQueuedRun = useDeleteQueuedRunMutation()
  const reorderQueuedRuns = useReorderQueuedRunsMutation()
  const retryRun = useStartRunMutation()
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    setOpenRunIds((current) => {
      const currentIds = new Set(orderedItems.map((item) => item.runId))
      const next = new Set([...current].filter((runId) => currentIds.has(runId)))
      for (const runId of firstRunIds) {
        next.add(runId)
      }
      return next
    })
  }, [firstRunIds, orderedItems])

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

  const handleDragEnd = async (event: DragEndEvent, queueItems: RunRecord[]) => {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = queueItems.findIndex((item) => item.runId === active.id)
    const newIndex = queueItems.findIndex((item) => item.runId === over.id)
    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const reordered = arrayMove(queueItems, oldIndex, newIndex)
    try {
      setReorderError(null)
      await reorderQueuedRuns.mutateAsync(reordered.map((run) => run.runId))
    } catch (error) {
      setReorderError(String(error))
    }
  }

  const handleRetry = async (run: RunRecord) => {
    setRetryingRunId(run.runId)
    try {
      await retryRun.mutateAsync({
        runner: run.runner,
        benchmark: run.benchmark,
        params: run.params,
      })
    } finally {
      setRetryingRunId(null)
    }
  }

  const renderQueueSection = (runner: Runner, queueItems: RunRecord[], activeRun?: RunRecord) => {
    const title = runner === 'cpu' ? 'Queued CPU Runs' : 'Queued GPU Runs'
    const runnerLabel = runner.toUpperCase()
    const queuedBadge = `${queueItems.length} queued ${runnerLabel} ${queueItems.length === 1 ? 'run' : 'runs'}`
    const activeCount = activeRun ? 1 : 0
    const activeBadge = `${activeCount} active ${runnerLabel} ${activeCount === 1 ? 'run' : 'runs'}`

    return (
      <GlowCard>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <div className="flex flex-wrap justify-end gap-2">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-200">
              {activeBadge}
            </span>
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200">
              {queuedBadge}
            </span>
          </div>
        </div>
        {deleteError ? (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/50 dark:bg-red-900/30 dark:text-red-200">
            {deleteError}
          </div>
        ) : null}
        {reorderError ? (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/50 dark:bg-red-900/30 dark:text-red-200">
            {reorderError}
          </div>
        ) : null}
        {activeRun ? (
          <div className="mt-4">
            <ActiveRunRow run={activeRun} isOpen={openRunIds.has(activeRun.runId)} onToggle={toggleRun} />
          </div>
        ) : null}
        {queueItems.length === 0 ? (
          <p className={activeRun ? 'mt-3 text-sm text-zinc-500 dark:text-zinc-400' : 'mt-4 text-sm text-zinc-500 dark:text-zinc-400'}>
            No queued {runner.toUpperCase()} runs.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event, queueItems)}>
            <SortableContext items={queueItems.map((run) => run.runId)} strategy={verticalListSortingStrategy}>
              <div className={activeRun ? 'mt-3 space-y-3' : 'mt-4 space-y-3'}>
                {queueItems.map((run, index) => (
                  <SortableQueuedRun
                    key={run.runId}
                    run={run}
                    index={index}
                    isOpen={openRunIds.has(run.runId)}
                    isDeleting={deleteQueuedRun.isPending && deleteQueuedRun.variables === run.runId}
                    onToggle={toggleRun}
                    onDelete={(runId) => void handleDelete(runId)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </GlowCard>
    )
  }

  return (
    <>
      {renderQueueSection('cpu', orderedCpuItems, activeCpuRun)}
      {renderQueueSection('gpu', orderedGpuItems, activeGpuRun)}
      <GlowCard>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Completed Runs</h3>
          <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300">
            {completedRuns.length} finished
          </span>
        </div>
        {completedRuns.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No completed runs yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {completedRuns.map((run) => (
              <RunStatusCard
                key={run.runId}
                title={`${run.runner.toUpperCase()} ${benchmarkLabel(run.benchmark)}`}
                instanceState={run.runner === 'cpu' ? cpuState : gpuState}
                run={run}
                onRetry={(failedRun) => void handleRetry(failedRun)}
                retrying={retryRun.isPending && retryingRunId === run.runId}
              />
            ))}
          </div>
        )}
      </GlowCard>
    </>
  )
}
