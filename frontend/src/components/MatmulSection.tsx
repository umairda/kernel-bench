import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { BENCHMARK_IDS } from '../benchmarks/benchmarkRegistry'
import { type RunRecord, useStartRunMutation } from '../lib/api'
import { MemoryBudgetSummary } from './MemoryBudgetSummary'
import { NumberField } from './NumberField'
import { RunStatusCard } from './RunStatusCard'
import { ShimmerButton } from './aceternity/shimmer-button'

type MatmulParams = { inputRows: number; inputCols: number; outputCols: number }
const DEFAULT_MATMUL_PARAMS: MatmulParams = { inputRows: 256, inputCols: 256, outputCols: 256 }
const BYTES_PER_FLOAT32 = 4

function numberParam(params: Record<string, number> | undefined, key: keyof MatmulParams, fallback: number) {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function MatmulSection({
  cpuState,
  gpuState,
  lastRun,
  cpuRun,
  gpuRun,
  cpuStartError,
  gpuStartError,
  cpuTitle,
  gpuTitle,
  onCpuRunStarted,
  onGpuRunStarted,
  onCpuStartError,
  onGpuStartError,
}: {
  cpuState: string
  gpuState: string
  lastRun?: RunRecord
  cpuRun?: RunRecord
  gpuRun?: RunRecord
  cpuStartError?: string | null
  gpuStartError?: string | null
  cpuTitle?: string
  gpuTitle?: string
  onCpuRunStarted: (runId: string) => void
  onGpuRunStarted: (runId: string) => void
  onCpuStartError: (message: string | null) => void
  onGpuStartError: (message: string | null) => void
}) {
  const [params, setParams] = useState<MatmulParams>(DEFAULT_MATMUL_PARAMS)
  const cpuStart = useStartRunMutation()
  const gpuStart = useStartRunMutation()

  useEffect(() => {
    if (!lastRun) {
      return
    }
    setParams({
      inputRows: numberParam(lastRun.params, 'inputRows', DEFAULT_MATMUL_PARAMS.inputRows),
      inputCols: numberParam(lastRun.params, 'inputCols', DEFAULT_MATMUL_PARAMS.inputCols),
      outputCols: numberParam(lastRun.params, 'outputCols', DEFAULT_MATMUL_PARAMS.outputCols),
    })
  }, [lastRun?.runId])

  const valid =
    Number.isFinite(params.inputRows) &&
    Number.isFinite(params.inputCols) &&
    Number.isFinite(params.outputCols) &&
    params.inputRows > 0 &&
    params.inputCols > 0 &&
    params.outputCols > 0
  const cpuLaunching = cpuStart.isPending
  const gpuLaunching = gpuStart.isPending
  const isCpuExecuting = cpuLaunching || cpuRun?.status === 'STARTING' || cpuRun?.status === 'RUNNING'
  const isGpuExecuting = gpuLaunching || gpuRun?.status === 'STARTING' || gpuRun?.status === 'RUNNING'
  const bytesInputA = params.inputRows * params.inputCols * BYTES_PER_FLOAT32
  const bytesInputB = params.inputCols * params.outputCols * BYTES_PER_FLOAT32
  const bytesOutput = params.inputRows * params.outputCols * BYTES_PER_FLOAT32
  const bytesTotal = bytesInputA + bytesInputB + bytesOutput

  return (
    <div className="rounded-2xl border border-zinc-300/70 bg-white/80 px-5 py-5 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Matrix Multiplication</h3>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <NumberField label="Input Rows" min={1} value={params.inputRows} onChange={(value) => setParams((p) => ({ ...p, inputRows: value }))} />
          <NumberField label="Input Cols (= Output Rows)" min={1} value={params.inputCols} onChange={(value) => setParams((p) => ({ ...p, inputCols: value }))} />
          <NumberField label="Output Cols" min={1} value={params.outputCols} onChange={(value) => setParams((p) => ({ ...p, outputCols: value }))} />
        </div>
        <MemoryBudgetSummary
          items={[
            { label: 'Input A', bytes: bytesInputA },
            { label: 'Input B', bytes: bytesInputB },
            { label: 'Output', bytes: bytesOutput },
          ]}
          totalBytes={bytesTotal}
        />
        <div className="flex flex-wrap gap-3">
          <ShimmerButton
            title={cpuTitle}
            disabled={!valid || isCpuExecuting || cpuState !== 'stopped'}
            onClick={async () => {
              try {
                onCpuStartError(null)
                const result = await cpuStart.mutateAsync({
                  runner: 'cpu',
                  benchmark: BENCHMARK_IDS.matmul,
                  params,
                })
                onCpuRunStarted(result.runId)
              } catch (e) {
                onCpuStartError(String(e))
              }
            }}
          >
            {isCpuExecuting ? (
              <span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> CPU Executing</span>
            ) : (
              <span className="inline-flex items-center"><Play className="mr-2 h-4 w-4" /> Run CPU</span>
            )}
          </ShimmerButton>
          <ShimmerButton
            title={gpuTitle}
            disabled={!valid || isGpuExecuting || gpuState !== 'stopped'}
            onClick={async () => {
              try {
                onGpuStartError(null)
                const result = await gpuStart.mutateAsync({
                  runner: 'gpu',
                  benchmark: BENCHMARK_IDS.matmul,
                  params,
                })
                onGpuRunStarted(result.runId)
              } catch (e) {
                onGpuStartError(String(e))
              }
            }}
          >
            {isGpuExecuting ? (
              <span className="inline-flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> GPU Executing</span>
            ) : (
              <span className="inline-flex items-center"><Play className="mr-2 h-4 w-4" /> Run GPU</span>
            )}
          </ShimmerButton>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <RunStatusCard title="CPU" instanceState={cpuState} run={cpuRun} startError={cpuStartError} launching={cpuLaunching} />
          <RunStatusCard title="GPU" instanceState={gpuState} run={gpuRun} startError={gpuStartError} launching={gpuLaunching} />
        </div>
      </div>
    </div>
  )
}
