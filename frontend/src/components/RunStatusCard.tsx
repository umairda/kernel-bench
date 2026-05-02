import { useEffect, useState } from 'react'
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
  return status === 'STARTING' || status === 'RUNNING'
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

function formatRunParams(run: RunRecord): string {
  const p = run.params ?? {}
  if (run.benchmark === 'vector') {
    return `n=${formatInteger(Number(p.vectorLength ?? 0))}`
  }
  if (run.benchmark === 'matrix-multiplication') {
    return `${formatInteger(Number(p.inputRows ?? 0))}x${formatInteger(Number(p.inputCols ?? 0))} * ${formatInteger(Number(p.inputCols ?? 0))}x${formatInteger(Number(p.outputCols ?? 0))}`
  }
  return `N${p.inputN ?? '?'} C${p.inputC ?? '?'} H${p.inputH ?? '?'} W${p.inputW ?? '?'} | K${p.filterOutC ?? '?'} ${p.filterH ?? '?'}x${p.filterW ?? '?'} s${p.strideH ?? '?'} p${p.padH ?? '?'}`
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
}: {
  title: string
  instanceState: string
  run?: RunRecord
  startError?: string | null
  launching?: boolean
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

  return (
    <GlowCard className="h-full">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-cyan-700 dark:text-cyan-300">{title}</h4>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getInstanceStateBadgeClasses(instanceState)}`}>
          {instanceState}
        </span>
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
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Parameters:</span> {formatRunParams(run)}
          </p>
          {run.status === 'STARTING' && run.startupProgress ? (
            <div className="rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-white/10 dark:bg-zinc-950">
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">Startup Progress</p>
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
              {typeof run.progress.rowsDone === 'number' && typeof run.progress.totalRows === 'number' ? (
                <p className="flex items-center justify-between gap-3">
                  <span>rows</span>
                  <span>{formatInteger(run.progress.rowsDone)} / {formatInteger(run.progress.totalRows)}</span>
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
          {run.performance ? (
            <div className="rounded-md border border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-white/10 dark:bg-zinc-950">
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">
                Total Duration: {formatMilliseconds(run.performance.totalDurationMs)}
              </p>
              {run.performance.phaseDurationsMs ? (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-300">Phase Durations</p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>queue/start request</span>
                    <span>{formatMilliseconds(run.performance.phaseDurationsMs.queueStartRequestMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>instance boot + SSM ready</span>
                    <span>{formatMilliseconds(run.performance.phaseDurationsMs.instanceBootSsmReadyMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>build/setup</span>
                    <span>{formatMilliseconds(run.performance.phaseDurationsMs.buildSetupMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>benchmark execution</span>
                    <span>{formatMilliseconds(run.performance.phaseDurationsMs.benchmarkExecutionMs)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-3 pl-3">
                    <span>upload/finalization</span>
                    <span>{formatMilliseconds(run.performance.phaseDurationsMs.uploadFinalizationMs)}</span>
                  </p>
                </div>
              ) : null}
              {run.performance.operationDurations && run.performance.operationDurations.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-300">Operation Durations</p>
                  {run.performance.operationDurations.map((op) => (
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
