export const BENCHMARK_IDS = {
  vector: 'vector',
  matmul: 'matrix-multiplication',
  convolution: 'convolution',
} as const

export type Benchmark = typeof BENCHMARK_IDS[keyof typeof BENCHMARK_IDS]
export type BenchmarkTab = 'vector' | 'matmul' | 'conv'

type BenchmarkManifest = {
  id: Benchmark
  tab: BenchmarkTab
  label: string
}

export const BENCHMARK_REGISTRY: Record<Benchmark, BenchmarkManifest> = {
  [BENCHMARK_IDS.vector]: {
    id: BENCHMARK_IDS.vector,
    tab: 'vector',
    label: 'Vector',
  },
  [BENCHMARK_IDS.matmul]: {
    id: BENCHMARK_IDS.matmul,
    tab: 'matmul',
    label: 'Matrix Multiplication',
  },
  [BENCHMARK_IDS.convolution]: {
    id: BENCHMARK_IDS.convolution,
    tab: 'conv',
    label: 'Convolution',
  },
}

export const BENCHMARK_TABS = [
  { value: BENCHMARK_REGISTRY[BENCHMARK_IDS.vector].tab, label: BENCHMARK_REGISTRY[BENCHMARK_IDS.vector].label },
  { value: BENCHMARK_REGISTRY[BENCHMARK_IDS.matmul].tab, label: BENCHMARK_REGISTRY[BENCHMARK_IDS.matmul].label },
  { value: BENCHMARK_REGISTRY[BENCHMARK_IDS.convolution].tab, label: BENCHMARK_REGISTRY[BENCHMARK_IDS.convolution].label },
] as const

function formatInteger(value: number) {
  if (!Number.isFinite(value)) {
    return ''
  }
  return new Intl.NumberFormat().format(Math.trunc(value))
}

export function benchmarkToTab(benchmark: Benchmark): BenchmarkTab {
  return BENCHMARK_REGISTRY[benchmark].tab
}

export function benchmarkLabel(benchmark: Benchmark): string {
  return BENCHMARK_REGISTRY[benchmark].label
}

export function benchmarkKey(benchmark: Benchmark, runner: 'cpu' | 'gpu'): string {
  return `${benchmark}:${runner}`
}

export function formatBenchmarkParams(benchmark: Benchmark, params: Record<string, number> | undefined): string {
  const p = params ?? {}
  if (benchmark === BENCHMARK_IDS.vector) {
    return `n=${formatInteger(Number(p.vectorLength ?? 0))}`
  }
  if (benchmark === BENCHMARK_IDS.matmul) {
    return `${formatInteger(Number(p.inputRows ?? 0))}x${formatInteger(Number(p.inputCols ?? 0))} * ${formatInteger(Number(p.inputCols ?? 0))}x${formatInteger(Number(p.outputCols ?? 0))}`
  }
  return `N${p.inputN ?? '?'} C${p.inputC ?? '?'} H${p.inputH ?? '?'} W${p.inputW ?? '?'} | K${p.filterOutC ?? '?'} ${p.filterH ?? '?'}x${p.filterW ?? '?'} s${p.strideH ?? '?'} p${p.padH ?? '?'}`
}
