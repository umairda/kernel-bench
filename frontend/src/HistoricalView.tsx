import { useMemo } from 'react'
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'
import { SegmentedControl } from './components/SegmentedControl'
import { GlowCard } from './components/aceternity/glow-card'
import {
  type ConvolutionHistoryPoint,
  type MatmulHistoryPoint,
  type Runner,
  type VectorHistoryPoint,
  useGetConvolutionHistoryQuery,
  useGetMatmulHistoryQuery,
  useGetVectorHistoryQuery,
} from './lib/api'

type HistoryRunnerFilter = Runner | 'all'
type ChartPoint = { x: number; y: number }
type TooltipPayloadItem = {
  dataKey?: unknown
}

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
  return `${Math.round(value).toLocaleString()} ms`
}

function formatTooltipMilliseconds(value: unknown) {
  return formatMilliseconds(typeof value === 'number' ? value : Number(value))
}

function formatTooltipValue(value: unknown, name: unknown, item: TooltipPayloadItem) {
  if (item.dataKey === 'x') {
    return [formatInteger(Number(value)), String(name)] as [string, string]
  }
  return [formatTooltipMilliseconds(value), String(name)] as [string, string]
}

function buildXAxisTicks(series: ChartPoint[][], maxTicks = 8) {
  const ticks = [...new Set(series.flat().map((point) => point.x).filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b)
  if (ticks.length <= maxTicks) {
    return ticks
  }

  const selected = new Set<number>()
  for (let i = 0; i < maxTicks; i += 1) {
    const index = Math.round((i * (ticks.length - 1)) / (maxTicks - 1))
    selected.add(ticks[index])
  }
  return [...selected].sort((a, b) => a - b)
}

function ChartPanel({
  title,
  subtitle,
  loading,
  empty,
  children,
}: {
  title: string
  subtitle: string
  loading?: boolean
  empty?: boolean
  children?: React.ReactNode
}) {
  return (
    <GlowCard>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</p>
      </div>
      {loading ? (
        <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history
        </div>
      ) : empty ? (
        <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          No historical runs yet for this benchmark and runner.
        </div>
      ) : (
        children
      )}
    </GlowCard>
  )
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function buildVectorSeries(points: VectorHistoryPoint[], key: 'addMs' | 'subtractMs' | 'multiplyMs' | 'divideMs', runner: Runner) {
  return points
    .filter((point) => point.runner === runner && positiveNumber(point.vectorLength) && positiveNumber(point[key]))
    .map((point) => ({
      x: point.vectorLength,
      y: point[key] as number,
      runId: point.runId,
      completedAt: point.completedAt,
    }))
}

export function buildMatmulSeries(points: MatmulHistoryPoint[], runner: Runner) {
  return points
    .filter((point) => point.runner === runner && positiveNumber(point.size) && positiveNumber(point.matmulMs))
    .map((point) => ({
      x: point.size as number,
      y: point.matmulMs as number,
      runId: point.runId,
      completedAt: point.completedAt,
    }))
}

export function buildConvolutionSeries(points: ConvolutionHistoryPoint[], runner: Runner) {
  return points
    .filter((point) => point.runner === runner && positiveNumber(point.inputArea) && positiveNumber(point.convolutionMs))
    .map((point) => ({
      x: point.inputArea,
      y: point.convolutionMs as number,
      runId: point.runId,
      completedAt: point.completedAt,
      label: `${point.inputH}x${point.inputW} · K=${point.filterOutC} · ${point.filterH}x${point.filterW}`,
    }))
}

export default function HistoricalView({
  historyRunner,
  onRunnerChange,
}: {
  historyRunner: HistoryRunnerFilter
  onRunnerChange: (runner: HistoryRunnerFilter) => void
}) {
  const vectorHistory = useGetVectorHistoryQuery(historyRunner)
  const matmulHistory = useGetMatmulHistoryQuery(historyRunner)
  const convolutionHistory = useGetConvolutionHistoryQuery(historyRunner)

  const vectorCpuAdd = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'addMs', 'cpu'), [vectorHistory.data])
  const vectorGpuAdd = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'addMs', 'gpu'), [vectorHistory.data])
  const vectorCpuSubtract = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'subtractMs', 'cpu'), [vectorHistory.data])
  const vectorGpuSubtract = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'subtractMs', 'gpu'), [vectorHistory.data])
  const vectorCpuMultiply = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'multiplyMs', 'cpu'), [vectorHistory.data])
  const vectorGpuMultiply = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'multiplyMs', 'gpu'), [vectorHistory.data])
  const vectorCpuDivide = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'divideMs', 'cpu'), [vectorHistory.data])
  const vectorGpuDivide = useMemo(() => buildVectorSeries(vectorHistory.data?.items ?? [], 'divideMs', 'gpu'), [vectorHistory.data])
  const matmulCpuPoints = useMemo(() => buildMatmulSeries(matmulHistory.data?.items ?? [], 'cpu'), [matmulHistory.data])
  const matmulGpuPoints = useMemo(() => buildMatmulSeries(matmulHistory.data?.items ?? [], 'gpu'), [matmulHistory.data])
  const convolutionCpuPoints = useMemo(() => buildConvolutionSeries(convolutionHistory.data?.items ?? [], 'cpu'), [convolutionHistory.data])
  const convolutionGpuPoints = useMemo(() => buildConvolutionSeries(convolutionHistory.data?.items ?? [], 'gpu'), [convolutionHistory.data])
  const vectorXTicks = useMemo(() => buildXAxisTicks([
    vectorCpuAdd,
    vectorGpuAdd,
    vectorCpuSubtract,
    vectorGpuSubtract,
    vectorCpuMultiply,
    vectorGpuMultiply,
    vectorCpuDivide,
    vectorGpuDivide,
  ]), [
    vectorCpuAdd,
    vectorGpuAdd,
    vectorCpuSubtract,
    vectorGpuSubtract,
    vectorCpuMultiply,
    vectorGpuMultiply,
    vectorCpuDivide,
    vectorGpuDivide,
  ])
  const matmulXTicks = useMemo(() => buildXAxisTicks([matmulCpuPoints, matmulGpuPoints]), [matmulCpuPoints, matmulGpuPoints])
  const convolutionXTicks = useMemo(() => buildXAxisTicks([convolutionCpuPoints, convolutionGpuPoints]), [convolutionCpuPoints, convolutionGpuPoints])

  return (
    <div className="space-y-4">
      <div className="flex justify-start">
        <SegmentedControl
          value={historyRunner}
          onChange={onRunnerChange}
          options={[
            { value: 'all', label: 'CPU + GPU' },
            { value: 'cpu', label: 'CPU Only' },
            { value: 'gpu', label: 'GPU Only' },
          ]}
        />
      </div>

      <ChartPanel
        title="Vector Operations"
        subtitle="Scatter plot of vector length vs. operation duration, with CPU and GPU plotted together for direct comparison."
        loading={vectorHistory.isPending}
        empty={
          vectorCpuAdd.length === 0 &&
          vectorGpuAdd.length === 0 &&
          vectorCpuSubtract.length === 0 &&
          vectorGpuSubtract.length === 0 &&
          vectorCpuMultiply.length === 0 &&
          vectorGpuMultiply.length === 0 &&
          vectorCpuDivide.length === 0 &&
          vectorGpuDivide.length === 0
        }
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(161,161,170,0.35)" />
              <XAxis
                type="number"
                dataKey="x"
                scale="log"
                domain={['auto', 'auto']}
                name="Vector Length"
                ticks={vectorXTicks}
                tickFormatter={(value) => formatInteger(Number(value))}
              />
              <YAxis
                type="number"
                dataKey="y"
                scale="log"
                domain={['auto', 'auto']}
                name="Duration (ms)"
                tickFormatter={(value) => `${Math.round(Number(value))}`}
                label={{ value: 'ms', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip formatter={formatTooltipValue} labelFormatter={(value) => `N=${formatInteger(Number(value))}`} />
              <Legend />
              <Scatter name="CPU Add" data={vectorCpuAdd} fill="#991b1b" />
              <Scatter name="GPU Add" data={vectorGpuAdd} fill="#facc15" />
              <Scatter name="CPU Subtract" data={vectorCpuSubtract} fill="#b91c1c" />
              <Scatter name="GPU Subtract" data={vectorGpuSubtract} fill="#fde047" />
              <Scatter name="CPU Multiply" data={vectorCpuMultiply} fill="#dc2626" />
              <Scatter name="GPU Multiply" data={vectorGpuMultiply} fill="#f59e0b" />
              <Scatter name="CPU Divide" data={vectorCpuDivide} fill="#ef4444" />
              <Scatter name="GPU Divide" data={vectorGpuDivide} fill="#fef08a" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>

      <ChartPanel
        title="Square Matrix Multiplication"
        subtitle="Historical square-only runs where CPU and GPU results share the same axes for easier comparison."
        loading={matmulHistory.isPending}
        empty={matmulCpuPoints.length === 0 && matmulGpuPoints.length === 0}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(161,161,170,0.35)" />
              <XAxis
                type="number"
                dataKey="x"
                scale="log"
                domain={['auto', 'auto']}
                name="Matrix Size"
                ticks={matmulXTicks}
                tickFormatter={(value) => formatInteger(Number(value))}
              />
              <YAxis
                type="number"
                dataKey="y"
                scale="log"
                domain={['auto', 'auto']}
                name="Duration (ms)"
                tickFormatter={(value) => `${Math.round(Number(value))}`}
                label={{ value: 'ms', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip formatter={formatTooltipValue} labelFormatter={(value) => `Size=${formatInteger(Number(value))}`} />
              <Legend />
              <Scatter name="CPU Matmul" data={matmulCpuPoints} fill="#7c3aed" />
              <Scatter name="GPU Matmul" data={matmulGpuPoints} fill="#c4b5fd" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>

      <ChartPanel
        title="Convolution Preview"
        subtitle="Current preview uses input area on the X axis and convolution duration on the Y axis, with CPU and GPU overlaid on the same chart."
        loading={convolutionHistory.isPending}
        empty={convolutionCpuPoints.length === 0 && convolutionGpuPoints.length === 0}
      >
        <div className="space-y-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(161,161,170,0.35)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  scale="log"
                  domain={['auto', 'auto']}
                  name="Input Area"
                  ticks={convolutionXTicks}
                  tickFormatter={(value) => formatInteger(Number(value))}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  scale="log"
                  domain={['auto', 'auto']}
                  name="Duration (ms)"
                  tickFormatter={(value) => `${Math.round(Number(value))}`}
                  label={{ value: 'ms', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip formatter={formatTooltipValue} labelFormatter={(value) => `Input area=${formatInteger(Number(value))}`} />
                <Legend />
                <Scatter name="CPU Convolution" data={convolutionCpuPoints} fill="#db2777" />
                <Scatter name="GPU Convolution" data={convolutionGpuPoints} fill="#f9a8d4" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-zinc-300 bg-zinc-100 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Recommended next views</p>
            <p className="mt-2">A filtered scatter by input height/width is the easiest next step. After that, a heatmap of input area vs. output channels would likely reveal the clearest performance trends.</p>
          </div>
        </div>
      </ChartPanel>
    </div>
  )
}
