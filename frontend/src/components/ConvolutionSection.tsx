import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { type RunRecord, useStartRunMutation } from '../lib/api'
import { NumberField } from './NumberField'
import { RunStatusCard } from './RunStatusCard'
import { AnimatedTooltip } from './aceternity/animated-tooltip'
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

const BYTES_PER_FLOAT32 = 4
const G4DN_XLARGE_CONV_TOTAL_BYTES_LIMIT = 8 * 1024 * 1024 * 1024 // conservative 50% of 16 GiB GPU memory

function formatBytes(bytes: number) {
  const numberFormat = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toLocaleString(undefined, numberFormat)} GiB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString(undefined, numberFormat)} MiB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toLocaleString(undefined, numberFormat)} KiB`
  }
  return `${bytes.toLocaleString(undefined, numberFormat)} B`
}

function TooltipLabel({ label, description }: { label: string; description: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <AnimatedTooltip content={description} />
    </span>
  )
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

  const outputH = Math.floor((params.inputH + 2 * params.padH - params.filterH) / params.strideH) + 1
  const outputW = Math.floor((params.inputW + 2 * params.padW - params.filterW) / params.strideW) + 1
  const safeOutputH = Number.isFinite(outputH) && outputH > 0 ? outputH : 0
  const safeOutputW = Number.isFinite(outputW) && outputW > 0 ? outputW : 0

  const bytesInput = params.inputN * params.inputC * params.inputH * params.inputW * BYTES_PER_FLOAT32
  const bytesFilter = params.filterOutC * params.inputC * params.filterH * params.filterW * BYTES_PER_FLOAT32
  const bytesOutput = params.inputN * params.filterOutC * safeOutputH * safeOutputW * BYTES_PER_FLOAT32
  const bytesTotal = bytesInput + bytesFilter + bytesOutput
  const overLimit = bytesTotal > G4DN_XLARGE_CONV_TOTAL_BYTES_LIMIT

  return (
    <div className="rounded-2xl border border-zinc-300/70 bg-white/80 px-5 py-5 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Convolution</h3>
      </div>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <NumberField label={<TooltipLabel label="Input N" description="Batch size: how many images or examples are processed together in one convolution run." />} min={1} value={params.inputN} onChange={(value) => setParams((p) => ({ ...p, inputN: value }))} />
          <NumberField label={<TooltipLabel label="Input C" description="Input channels: the depth of the input tensor, like 3 for RGB images." />} min={1} value={params.inputC} onChange={(value) => setParams((p) => ({ ...p, inputC: value }))} />
          <NumberField label={<TooltipLabel label="Input H" description="Input height: the number of rows in each input feature map or image." />} min={1} value={params.inputH} onChange={(value) => setParams((p) => ({ ...p, inputH: value }))} />
          <NumberField label={<TooltipLabel label="Input W" description="Input width: the number of columns in each input feature map or image." />} min={1} value={params.inputW} onChange={(value) => setParams((p) => ({ ...p, inputW: value }))} />
          <NumberField label={<TooltipLabel label="Filter Out C" description="Output channels: how many filters are applied, which determines the depth of the output tensor." />} min={1} value={params.filterOutC} onChange={(value) => setParams((p) => ({ ...p, filterOutC: value }))} />
          <NumberField label={<TooltipLabel label="Filter H" description="Filter height: the number of rows in each convolution kernel." />} min={1} value={params.filterH} onChange={(value) => setParams((p) => ({ ...p, filterH: value }))} />
          <NumberField label={<TooltipLabel label="Filter W" description="Filter width: the number of columns in each convolution kernel." />} min={1} value={params.filterW} onChange={(value) => setParams((p) => ({ ...p, filterW: value }))} />
          <NumberField label={<TooltipLabel label="Stride H" description="Vertical stride: how many rows the filter moves each step." />} min={1} value={params.strideH} onChange={(value) => setParams((p) => ({ ...p, strideH: value }))} />
          <NumberField label={<TooltipLabel label="Stride W" description="Horizontal stride: how many columns the filter moves each step." />} min={1} value={params.strideW} onChange={(value) => setParams((p) => ({ ...p, strideW: value }))} />
          <NumberField label={<TooltipLabel label="Pad H" description="Vertical padding: how many zero rows are added above and below the input." />} min={0} value={params.padH} onChange={(value) => setParams((p) => ({ ...p, padH: value }))} />
          <NumberField label={<TooltipLabel label="Pad W" description="Horizontal padding: how many zero columns are added to the left and right of the input." />} min={0} value={params.padW} onChange={(value) => setParams((p) => ({ ...p, padW: value }))} />
        </div>
        <div className="rounded-xl border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
          <p><span className="font-semibold">Input:</span> {formatBytes(bytesInput)}</p>
          <p><span className="font-semibold">Filter:</span> {formatBytes(bytesFilter)}</p>
          <p><span className="font-semibold">Output:</span> {formatBytes(bytesOutput)}</p>
          <p className={`mt-1 ${overLimit ? 'text-red-700 dark:text-red-300' : ''}`}>
            <span className="font-semibold">Total:</span> {formatBytes(bytesTotal)}
          </p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Constraint (g4dn.xlarge): total should be less than {formatBytes(G4DN_XLARGE_CONV_TOTAL_BYTES_LIMIT)}
          </p>
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
