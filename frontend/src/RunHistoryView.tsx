import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { benchmarkLabel } from './benchmarks/benchmarkRegistry'
import { GlowCard } from './components/aceternity/glow-card'
import { type RunHistoryRow, useGetRunHistoryQuery } from './lib/api'

type SortKey = 'runId' | 'createdAt' | 'runner' | 'operation' | 'parameters' | 'result' | 'duration'
type SortDirection = 'asc' | 'desc'

function formatParams(params: Record<string, number> | undefined) {
  return JSON.stringify(params ?? {})
}

function resultLabel(status: RunHistoryRow['status']) {
  return status === 'COMPLETED' ? 'Success' : 'Failed'
}

function totalOperationDuration(run: RunHistoryRow) {
  const ops = run.performance?.operationDurations ?? []
  if (ops.length > 0) {
    return ops.reduce((sum, op) => sum + (Number(op.durationMs) || 0), 0)
  }
  return run.performance?.totalDurationMs ?? 0
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  if (value > 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`
  }
  return `${Math.round(value).toLocaleString()} ms`
}

function formatCreatedAt(value?: string) {
  if (!value) {
    return 'n/a'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function compareValues(a: string | number, b: string | number, direction: SortDirection) {
  const order = direction === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * order
  }
  return String(a).localeCompare(String(b)) * order
}

export default function RunHistoryView() {
  const runHistory = useGetRunHistoryQuery()
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const rows = useMemo(() => {
    const items = [...(runHistory.data?.items ?? [])]
    items.sort((left, right) => {
      if (sortKey === 'runId') {
        return compareValues(left.runId, right.runId, sortDirection)
      }
      if (sortKey === 'createdAt') {
        return compareValues(left.createdAt ?? '', right.createdAt ?? '', sortDirection)
      }
      if (sortKey === 'runner') {
        return compareValues(left.runner, right.runner, sortDirection)
      }
      if (sortKey === 'operation') {
        return compareValues(benchmarkLabel(left.benchmark), benchmarkLabel(right.benchmark), sortDirection)
      }
      if (sortKey === 'parameters') {
        return compareValues(formatParams(left.params), formatParams(right.params), sortDirection)
      }
      if (sortKey === 'result') {
        return compareValues(resultLabel(left.status), resultLabel(right.status), sortDirection)
      }
      return compareValues(totalOperationDuration(left), totalOperationDuration(right), sortDirection)
    })
    return items
  }, [runHistory.data?.items, sortDirection, sortKey])

  const setSort = (key: SortKey) => {
    setSortDirection((direction) => (
      sortKey === key
        ? (direction === 'asc' ? 'desc' : 'asc')
        : (key === 'duration' || key === 'createdAt' ? 'desc' : 'asc')
    ))
    setSortKey(key)
  }

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return null
    return sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
  }

  return (
    <GlowCard>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Run History</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Sortable history of completed and failed runs across runners.
        </p>
      </div>
      {runHistory.isPending ? (
        <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading run history
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          No completed or failed runs yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed divide-y divide-zinc-200 text-sm dark:divide-white/10">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[8%]" />
              <col className="w-[15%]" />
              <col className="w-[24%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('runId')} className="inline-flex items-center gap-1 font-semibold">Run ID {renderSortIcon('runId')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('createdAt')} className="inline-flex items-center gap-1 font-semibold">Created {renderSortIcon('createdAt')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('runner')} className="inline-flex items-center gap-1 font-semibold">Runner {renderSortIcon('runner')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('operation')} className="inline-flex items-center gap-1 font-semibold">Operation {renderSortIcon('operation')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('parameters')} className="inline-flex items-center gap-1 font-semibold">Parameters {renderSortIcon('parameters')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('duration')} className="inline-flex w-full items-center justify-start gap-1 text-left font-semibold">Operation Duration {renderSortIcon('duration')}</button>
                </th>
                <th className="px-3 py-3">
                  <button type="button" onClick={() => setSort('result')} className="inline-flex items-center gap-1 font-semibold">Result {renderSortIcon('result')}</button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              {rows.map((row) => (
                <tr key={row.runId} className="align-top">
                  <td className="px-3 py-3 font-mono text-xs text-zinc-800 dark:text-zinc-100">{row.runId}</td>
                  <td className="px-3 py-3 text-xs text-zinc-700 dark:text-zinc-200">{formatCreatedAt(row.createdAt)}</td>
                  <td className="px-3 py-3 uppercase text-zinc-700 dark:text-zinc-200">{row.runner}</td>
                  <td className="px-3 py-3 text-zinc-700 dark:text-zinc-200">{benchmarkLabel(row.benchmark)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300 break-words whitespace-normal">{formatParams(row.params)}</td>
                  <td className="px-3 py-3 text-zinc-700 dark:text-zinc-200">{formatDuration(totalOperationDuration(row))}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
                      {resultLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlowCard>
  )
}
