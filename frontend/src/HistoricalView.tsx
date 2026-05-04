import { type ReactNode, useMemo, useState } from 'react'
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
type ConvolutionScatterPoint = ChartPoint & {
  runId: string
  runner: Runner
  inputH: number
  inputW: number
  inputC: number
  filterOutC: number
  filterH: number
  filterW: number
  label: string
}
type HeatmapCell = {
  key: string
  inputArea: number
  filterOutC: number
  cpuMs: number | null
  gpuMs: number | null
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

function formatConvolutionTooltipValue(value: unknown, name: unknown, item: TooltipPayloadItem) {
  if (item.dataKey === 'x') {
    return [formatInteger(Number(value)), 'Input area'] as [string, string]
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
  children?: ReactNode
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

function ChartFrame({ className = 'h-80', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`${className} min-h-72 min-w-0 overflow-hidden`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240} debounce={50}>
        {children}
      </ResponsiveContainer>
    </div>
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

function sortedUniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b)
}

export function buildDimensionOptions(points: ConvolutionHistoryPoint[], key: 'inputH' | 'inputW') {
  return sortedUniqueNumbers(points.map((point) => point[key]))
}

export function buildFilteredConvolutionSeries(
  points: ConvolutionHistoryPoint[],
  runner: Runner,
  filters: { inputH: number | 'all'; inputW: number | 'all' },
): ConvolutionScatterPoint[] {
  return points
    .filter((point) => point.runner === runner && positiveNumber(point.inputArea) && positiveNumber(point.convolutionMs))
    .filter((point) => filters.inputH === 'all' || point.inputH === filters.inputH)
    .filter((point) => filters.inputW === 'all' || point.inputW === filters.inputW)
    .map((point) => ({
      x: point.inputArea,
      y: point.convolutionMs as number,
      runId: point.runId,
      runner: point.runner,
      inputH: point.inputH,
      inputW: point.inputW,
      inputC: point.inputC,
      filterOutC: point.filterOutC,
      filterH: point.filterH,
      filterW: point.filterW,
      label: `${point.inputH}x${point.inputW} · C=${point.inputC} · K=${point.filterOutC}`,
    }))
}

export function buildConvolutionHeatmap(points: ConvolutionHistoryPoint[]): HeatmapCell[] {
  const grouped = new Map<string, { inputArea: number; filterOutC: number; cpu: number[]; gpu: number[] }>()
  for (const point of points) {
    if (!positiveNumber(point.inputArea) || !positiveNumber(point.filterOutC) || !positiveNumber(point.convolutionMs)) {
      continue
    }
    const key = `${point.inputArea}:${point.filterOutC}`
    const entry = grouped.get(key) ?? { inputArea: point.inputArea, filterOutC: point.filterOutC, cpu: [], gpu: [] }
    entry[point.runner].push(point.convolutionMs as number)
    grouped.set(key, entry)
  }

  const average = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  return [...grouped.entries()].map(([key, entry]) => ({
    key,
    inputArea: entry.inputArea,
    filterOutC: entry.filterOutC,
    cpuMs: average(entry.cpu),
    gpuMs: average(entry.gpu),
  })).sort((a, b) => {
    const byArea = a.inputArea - b.inputArea
    return byArea !== 0 ? byArea : a.filterOutC - b.filterOutC
  })
}

function heatIntensity(value: number | null, max: number) {
  if (!value || !Number.isFinite(value) || max <= 0) {
    return 'rgba(113,113,122,0.12)'
  }
  const normalized = Math.max(0.12, Math.min(1, value / max))
  return `rgba(8, 145, 178, ${0.18 + normalized * 0.72})`
}

function HeatmapValue({ label, value, max }: { label: string; value: number | null; max: number }) {
  return (
    <div
      className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-zinc-950 dark:text-white"
      style={{ background: heatIntensity(value, max) }}
      title={`${label}: ${formatMilliseconds(value)}`}
    >
      <span className="block text-[10px] uppercase tracking-wide opacity-75">{label}</span>
      <span>{formatMilliseconds(value)}</span>
    </div>
  )
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
  const convolutionItems = convolutionHistory.data?.items ?? []
  const [convInputH, setConvInputH] = useState<number | 'all'>('all')
  const [convInputW, setConvInputW] = useState<number | 'all'>('all')
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
  const convolutionInputHOptions = useMemo(() => buildDimensionOptions(convolutionItems, 'inputH'), [convolutionItems])
  const convolutionInputWOptions = useMemo(() => buildDimensionOptions(convolutionItems, 'inputW'), [convolutionItems])
  const filteredConvolutionCpuPoints = useMemo(
    () => buildFilteredConvolutionSeries(convolutionItems, 'cpu', { inputH: convInputH, inputW: convInputW }),
    [convInputH, convInputW, convolutionItems],
  )
  const filteredConvolutionGpuPoints = useMemo(
    () => buildFilteredConvolutionSeries(convolutionItems, 'gpu', { inputH: convInputH, inputW: convInputW }),
    [convInputH, convInputW, convolutionItems],
  )
  const filteredConvolutionXTicks = useMemo(() => buildXAxisTicks([filteredConvolutionCpuPoints, filteredConvolutionGpuPoints]), [filteredConvolutionCpuPoints, filteredConvolutionGpuPoints])
  const convolutionHeatmap = useMemo(() => buildConvolutionHeatmap(convolutionItems), [convolutionItems])
  const heatmapMax = useMemo(() => Math.max(
    0,
    ...convolutionHeatmap.flatMap((cell) => [cell.cpuMs ?? 0, cell.gpuMs ?? 0]),
  ), [convolutionHeatmap])

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
        <ChartFrame>
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
        </ChartFrame>
      </ChartPanel>

      <ChartPanel
        title="Square Matrix Multiplication"
        subtitle="Historical square-only runs where CPU and GPU results share the same axes for easier comparison."
        loading={matmulHistory.isPending}
        empty={matmulCpuPoints.length === 0 && matmulGpuPoints.length === 0}
      >
        <ChartFrame>
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
        </ChartFrame>
      </ChartPanel>

      <ChartPanel
        title="Convolution Preview"
        subtitle="Current preview uses input area on the X axis and convolution duration on the Y axis, with CPU and GPU overlaid on the same chart."
        loading={convolutionHistory.isPending}
        empty={convolutionCpuPoints.length === 0 && convolutionGpuPoints.length === 0}
      >
        <div className="space-y-4">
          <ChartFrame>
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
          </ChartFrame>
          <div className="rounded-xl border border-zinc-300 bg-zinc-100 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">Filtered Scatter: Input Height / Width</p>
                <p className="mt-1">Filter convolution history to compare CPU and GPU timings for specific input dimensions.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                  Input H
                  <select
                    value={convInputH}
                    onChange={(event) => setConvInputH(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                  >
                    <option value="all">All heights</option>
                    {convolutionInputHOptions.map((value) => (
                      <option key={value} value={value}>{formatInteger(value)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                  Input W
                  <select
                    value={convInputW}
                    onChange={(event) => setConvInputW(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                  >
                    <option value="all">All widths</option>
                    {convolutionInputWOptions.map((value) => (
                      <option key={value} value={value}>{formatInteger(value)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {filteredConvolutionCpuPoints.length === 0 && filteredConvolutionGpuPoints.length === 0 ? (
              <div className="mt-4 flex h-52 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                No convolution runs match these filters.
              </div>
            ) : (
              <ChartFrame className="mt-4 h-72">
                <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(161,161,170,0.35)" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    scale="log"
                    domain={['auto', 'auto']}
                    name="Input Area"
                    ticks={filteredConvolutionXTicks}
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
                  <Tooltip formatter={formatConvolutionTooltipValue} labelFormatter={(value) => `Input area=${formatInteger(Number(value))}`} />
                  <Legend />
                  <Scatter name="CPU Filtered Convolution" data={filteredConvolutionCpuPoints} fill="#be123c" />
                  <Scatter name="GPU Filtered Convolution" data={filteredConvolutionGpuPoints} fill="#f59e0b" />
                </ScatterChart>
              </ChartFrame>
            )}
          </div>

          <div className="rounded-xl border border-zinc-300 bg-zinc-100 p-4 text-sm text-zinc-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">Heatmap: Input Area vs. Output Channels</p>
            <p className="mt-1">Each row groups runs by input area and filter output channels. Darker cells indicate slower average operation duration.</p>
            {convolutionHeatmap.length === 0 ? (
              <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                No convolution heatmap data yet.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[560px] space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <span>Input Area</span>
                    <span>Output Channels</span>
                    <span>CPU Avg</span>
                    <span>GPU Avg</span>
                  </div>
                  {convolutionHeatmap.map((cell) => (
                    <div key={cell.key} className="grid grid-cols-[1fr_1fr_1fr_1fr] items-center gap-2 rounded-xl border border-zinc-300 bg-white/70 p-2 dark:border-white/10 dark:bg-zinc-900/70">
                      <span className="font-mono text-xs">{formatInteger(cell.inputArea)}</span>
                      <span className="font-mono text-xs">{formatInteger(cell.filterOutC)}</span>
                      <HeatmapValue label="CPU" value={cell.cpuMs} max={heatmapMax} />
                      <HeatmapValue label="GPU" value={cell.gpuMs} max={heatmapMax} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ChartPanel>
    </div>
  )
}
