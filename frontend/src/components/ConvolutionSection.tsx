import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { type RunRecord, useStartRunMutation } from '../lib/api'
import { NumberField } from './NumberField'
import { RunStatusCard } from './RunStatusCard'
import { ShimmerButton } from './aceternity/shimmer-button'

type ConvParams = {
  inputN: number
  inputC: number
  inputH: number
  inputW: number
  filterOutC: number
  filterH: number
  filterW: number
  strideH: number
  strideW: number
  padH: number
  padW: number
}

export function ConvolutionSection({
  cpuState,
  gpuState,
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
  const [params, setParams] = useState<ConvParams>({
    inputN: 1,
    inputC: 3,
    inputH: 64,
    inputW: 64,
    filterOutC: 16,
    filterH: 3,
    filterW: 3,
    strideH: 1,
    strideW: 1,
    padH: 1,
    padW: 1,
  })
  const cpuStart = useStartRunMutation()
  const gpuStart = useStartRunMutation()

  const valid =
    Object.values(params).every((v) => Number.isFinite(v)) &&
    params.inputN > 0 &&
    params.inputC > 0 &&
    params.inputH > 0 &&
    params.inputW > 0 &&
    params.filterOutC > 0 &&
    params.filterH > 0 &&
    params.filterW > 0 &&
    params.strideH > 0 &&
    params.strideW > 0 &&
    params.padH >= 0 &&
    params.padW >= 0
  const cpuLaunching = cpuStart.isPending
  const gpuLaunching = gpuStart.isPending
  const isCpuExecuting = cpuLaunching || cpuRun?.status === 'STARTING' || cpuRun?.status === 'RUNNING'
  const isGpuExecuting = gpuLaunching || gpuRun?.status === 'STARTING' || gpuRun?.status === 'RUNNING'

  return (
    <div className="rounded-2xl border border-zinc-300/70 bg-white/80 px-5 py-5 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Convolution</h3>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <NumberField label="Input N" min={1} value={params.inputN} onChange={(value) => setParams((p) => ({ ...p, inputN: value }))} />
          <NumberField label="Input C" min={1} value={params.inputC} onChange={(value) => setParams((p) => ({ ...p, inputC: value }))} />
          <NumberField label="Input H" min={1} value={params.inputH} onChange={(value) => setParams((p) => ({ ...p, inputH: value }))} />
          <NumberField label="Input W" min={1} value={params.inputW} onChange={(value) => setParams((p) => ({ ...p, inputW: value }))} />
          <NumberField label="Filter Out C" min={1} value={params.filterOutC} onChange={(value) => setParams((p) => ({ ...p, filterOutC: value }))} />
          <NumberField label="Filter H" min={1} value={params.filterH} onChange={(value) => setParams((p) => ({ ...p, filterH: value }))} />
          <NumberField label="Filter W" min={1} value={params.filterW} onChange={(value) => setParams((p) => ({ ...p, filterW: value }))} />
          <NumberField label="Stride H" min={1} value={params.strideH} onChange={(value) => setParams((p) => ({ ...p, strideH: value }))} />
          <NumberField label="Stride W" min={1} value={params.strideW} onChange={(value) => setParams((p) => ({ ...p, strideW: value }))} />
          <NumberField label="Pad H" min={0} value={params.padH} onChange={(value) => setParams((p) => ({ ...p, padH: value }))} />
          <NumberField label="Pad W" min={0} value={params.padW} onChange={(value) => setParams((p) => ({ ...p, padW: value }))} />
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
                  benchmark: 'convolution',
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
                  benchmark: 'convolution',
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
