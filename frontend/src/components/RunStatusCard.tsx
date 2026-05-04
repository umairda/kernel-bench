import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { formatBenchmarkParams } from '../benchmarks/benchmarkRegistry'
import { GlowCard } from './aceternity/glow-card'
import type { RunRecord } from '../lib/api'

function formatInteger(value: number) {
  if (!Number.isFinite(value)) {
    return ''
  }
  return new Intl.NumberFormat().format(Math.trunc(value))
}

function formatMilliseconds(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a'
  }
  if (value > 60000) {
    return `${(value / 60000).toFixed(1)}min`
  }
  if (value > 1000) {
    return `${(value / 1000).toFixed(1)} s`
  }
  return `${Math.round(value).toLocaleString()} ms`
}

function formatSeconds(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 'n/a'
  }
  if (value >= 3600) {
    return `${(value / 3600).toFixed(1)} h`
  }
  if (value >= 60) {
    return `${(value / 60).toFixed(1)} m`
  }
  return `${value.toFixed(1)} s`
}

function formatCreatedAt(value?: string) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { date: value, time: '' }
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    date: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  }
}

function isActiveStatus(status: RunRecord['status']) {
  return status === 'QUEUED' || status === 'STARTING' || status === 'RUNNING'
}

function isTerminalStatus(status: RunRecord['status']) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
}

function shouldShowFailureDetails(run: RunRecord) {
  return (run.status === 'FAILED' || run.status === 'CANCELLED') && Boolean(run.reason || run.error)
}

function formatElapsed(createdAt?: string, endMs?: number) {
  if (!createdAt || typeof endMs !== 'number') {
    return null
  }
  const createdMs = new Date(createdAt).getTime()
  if (Number.isNaN(createdMs)) {
    return null
  }
  const elapsedSeconds = Math.max(0, Math.floor((endMs - createdMs) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function runEndTimeMs(run: RunRecord) {
  const endTime = run.completedAt ?? run.updatedAt
  if (!endTime) {
    return null
  }
  const endMs = new Date(endTime).getTime()
  return Number.isNaN(endMs) ? null : endMs
}

function fallbackPerformance(run: RunRecord) {
  if (!isTerminalStatus(run.status)) {
    return undefined
  }
  const createdMs = run.createdAt ? new Date(run.createdAt).getTime() : NaN
  const endedMs = runEndTimeMs(run)
  if (!Number.isFinite(createdMs) || typeof endedMs !== 'number') {
    return undefined
  }
  return {
    totalDurationMs: Math.max(0, endedMs - createdMs),
    phaseDurationsMs: {},
    operationDurations: [],
  } satisfies NonNullable<RunRecord['performance']>
}

function getInstanceStateBadgeClasses(state: string) {
  switch (state.toLowerCase()) {
    case 'stopped':
      return 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300'
    case 'running':
      return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'stopping':
      return 'border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300'
    default:
      return 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300'
  }
}

export function RunStatusCard({
  title,
  instanceState,
  run,
  startError,
  launching,
  onRetry,
  retrying,
}: {
  title: string
  instanceState: string
  run?: RunRecord
  startError?: string | null
  launching?: boolean
  onRetry?: (run: RunRecord) => void
  retrying?: boolean
}) {
  const createdAt = run ? formatCreatedAt(run.createdAt) : null
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!run || !isActiveStatus(run.status)) {
      return
    }
    setNowMs(Date.now())
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [run?.createdAt, run?.runId, run?.status])

  const elapsed = run
    ? formatElapsed(run.createdAt, isActiveStatus(run.status) ? nowMs : runEndTimeMs(run) ?? undefined)
    : null
  const performance = run?.performance ?? (run ? fallbackPerformance(run) : undefined)
  const phaseDurations = performance?.phaseDurationsMs as NonNullable<NonNullable<RunRecord['performance']>['phaseDurationsMs']> | undefined
  const canRetry = run?.status === 'FAILED' && Boolean(onRetry)

  return (
    <GlowCard className="h-full">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-bold uppercase tracking-widest text-cyan-700 dark:text-cyan-300">{title}</h4>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getInstanceStateBadgeClasses(instanceState)}`}>
            {instanceState}
          </span>
        </div>
        {canRetry ? (
          <button
            type="button"
            aria-label={`Retry ${title} run`}
            title="Retry failed run"
            disabled={retrying}
            onClick={() => onRetry?.(run)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-cyan-400/60 dark:hover:text-cyan-200"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {startError ? (
        <div className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/50 dark:bg-red-900/30 dark:text-red-200">
          {startError}
        </div>
      ) : null}
      {!run ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{startError ? 'Error' : launching ? 'Executing' : 'No run started.'}</p>
      ) : (
        <div className="space-y-2 text-sm text-zinc-900 dark:text-zinc-100">
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Run ID:</span> {run.runId}
          </p>
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Status:</span> {run.status}{elapsed ? ` [${elapsed}]` : ''}
          </p>
          {shouldShowFailureDetails(run) ? (
            <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-400/50 dark:bg-red-900/30 dark:text-red-200">
              {run.reason ? <p><span className="font-semibold">Reason:</span> {run.reason}</p> : null}
              {run.error ? <p className={run.reason ? 'mt-1' : ''}><span className="font-semibold">Error:</span> {run.error}</p> : null}
            </div>
          ) : null}
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Created:</span>{' '}
            {createdAt ? (
              <span className="inline-flex items-center">
                <span>{createdAt.date}</span>
                {createdAt.time ? <span className="ml-3">{createdAt.time}</span> : null}
              </span>
            ) : 'n/a'}
          </p>
          <p>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Parameters:</span> {formatBenchmarkParams(run.benchmark, run.params)}
          </p>
          {(run.status === 'QUEUED' || run.status === 'STARTING') && run.startupProgress ? (
            <div className="rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-white/10 dark:bg-zinc-950">
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                {run.status === 'QUEUED' ? 'Queue Status' : 'Startup Progress'}
              </p>
              <p className="mt-1 flex items-center justify-between gap-3">
                <span>phase</span>
                <span>{run.startupProgress.phase ?? 'unknown'}</span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>ec2 state</span>
                <span>{run.startupProgress.ec2State ?? 'unknown'}</span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>instance status</span>
                <span>{run.startupProgress.instanceStatus ?? 'unknown'}</span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>system status</span>
                <span>{run.startupProgress.systemStatus ?? 'unknown'}</span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span>ssm ping</span>
                <span>{run.startupProgress.ssmPingStatus ?? 'unknown'}</span>
              </p>
              {run.startupProgress.detail ? (
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">{run.startupProgress.detail}</p>
              ) : null}
            </div>
          ) : null}
          {run.progress ? (
            <div className="rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-white/10 dark:bg-zinc-950">
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                {run.status === 'RUNNING' ? 'Execution Progress' : 'Last Execution Progress'}
              </p>
              <p className="mt-1 flex items-center justify-between gap-3">
                <span>phase</span>
                <span>{run.progress.phase ?? 'running'}</span>
              </p>
              {run.progress.op ? (
                <p className="flex items-center justify-between gap-3">
                  <span>operation</span>
                  <span>{run.progress.op}</span>
                </p>
              ) : null}
              {run.progress.backend ? (
                <p className="flex items-center justify-between gap-3">
                  <span>backend</span>
                  <span>{run.progress.backend}</span>
                </p>
              ) : null}
              {typeof run.progress.rowsDone === 'number' && typeof run.progress.totalRows === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>rows</span>
                  <span>{formatInteger(run.progress.rowsDone)} / {formatInteger(run.progress.totalRows)}</span>
                </p>
              ) : null}
              {typeof run.progress.elementsDone === 'number' && typeof run.progress.totalElements === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>elements</span>
                  <span>{formatInteger(run.progress.elementsDone)} / {formatInteger(run.progress.totalElements)}</span>
                </p>
              ) : null}
              {typeof run.progress.percent === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>complete</span>
                  <span>{run.progress.percent.toFixed(2)}%</span>
                </p>
              ) : null}
              {typeof run.progress.elapsedMs === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>elapsed</span>
                  <span>{formatMilliseconds(run.progress.elapsedMs)}</span>
                </p>
              ) : null}
              {typeof run.progress.elapsedS === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>elapsed (compute)</span>
                  <span>{formatSeconds(run.progress.elapsedS)}</span>
                </p>
              ) : null}
              {typeof run.progress.etaS === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>eta</span>
                  <span>{formatSeconds(run.progress.etaS)}</span>
                </p>
              ) : null}
              {run.progress.detail ? (
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">{run.progress.detail}</p>
              ) : null}
            </div>
          ) : null}
          {performance ? (
            <div className="rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-white/10 dark:bg-zinc-950">
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                Total Duration: {formatMilliseconds(performance.totalDurationMs)}
              </p>
              {phaseDurations ? (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-300">Phase Durations</p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>queue/start request</span>
                    <span>{formatMilliseconds(phaseDurations.queueStartRequestMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>instance boot + SSM ready</span>
                    <span>{formatMilliseconds(phaseDurations.instanceBootSsmReadyMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>build/setup</span>
                    <span>{formatMilliseconds(phaseDurations.buildSetupMs)}</span>
                  </p>
                  {typeof phaseDurations.gpuWarmupMs === 'number' ? (
                    <p className="flex items-center justify-between gap-3 pl-3">
                      <span>CUDA warmup</span>
                      <span>{formatMilliseconds(phaseDurations.gpuWarmupMs)}</span>
                    </p>
                  ) : null}
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>benchmark execution</span>
                    <span>{formatMilliseconds(phaseDurations.benchmarkExecutionMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>upload/finalization</span>
                    <span>{formatMilliseconds(phaseDurations.uploadFinalizationMs)}</span>
                  </p>
                </div>
              ) : null}
              {performance.operationDurations && performance.operationDurations.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-300">Operation Durations</p>
                  {performance.operationDurations.map((op) => (
                    <p key={op.name} className="flex items-center justify-between gap-3 pl-3">
                      <span className="font-medium">{op.name}</span>
                      <span>{formatMilliseconds(op.durationMs)}</span>
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </GlowCard>
  )
}
