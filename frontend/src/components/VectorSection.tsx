import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { type RunRecord, useStartRunMutation } from '../lib/api'
import { NumberField } from './NumberField'
import { RunStatusCard } from './RunStatusCard'
import { ShimmerButton } from './aceternity/shimmer-button'

type VectorParams = { vectorLength: number }
const DEFAULT_VECTOR_PARAMS: VectorParams = { vectorLength: 100000 }

function numberParam(params: Record<string, number> | undefined, key: keyof VectorParams, fallback: number) {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function VectorSection({
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
  const [params, setParams] = useState<VectorParams>(DEFAULT_VECTOR_PARAMS)
  const cpuStart = useStartRunMutation()
  const gpuStart = useStartRunMutation()

  useEffect(() => {
    if (!lastRun) {
      return
    }
    setParams({
      vectorLength: numberParam(lastRun.params, 'vectorLength', DEFAULT_VECTOR_PARAMS.vectorLength),
    })
  }, [lastRun?.runId])

  const valid = Number.isFinite(params.vectorLength) && params.vectorLength > 0
  const cpuLaunching = cpuStart.isPending
  const gpuLaunching = gpuStart.isPending
  const isCpuExecuting = cpuLaunching || cpuRun?.status === 'STARTING' || cpuRun?.status === 'RUNNING'
  const isGpuExecuting = gpuLaunching || gpuRun?.status === 'STARTING' || gpuRun?.status === 'RUNNING'

  return (
    <div className="rounded-2xl border border-zinc-300/70 bg-white/80 px-5 py-5 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Vector</h3>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <NumberField label="Vector Length" min={1} value={params.vectorLength} onChange={(value) => setParams({ vectorLength: value })} />
        </div>
        <div className="flex flex-wrap gap-3">
          <ShimmerButton
            title={cpuTitle}
            disabled={!valid || isCpuExecuting || cpuState !== 'stopped'}
            onClick={async () => {
              try {
                onCpuStartError(null)
                const result = await cpuStart.mutateAsync({
                  runner: 'cpu',
                  benchmark: 'vector',
                  params: { vectorLength: params.vectorLength },
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
                  benchmark: 'vector',
                  params: { vectorLength: params.vectorLength },
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
