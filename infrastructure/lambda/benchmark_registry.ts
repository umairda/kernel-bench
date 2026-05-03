export const BENCHMARK_IDS = {
  vector: 'vector',
  matmul: 'matrix-multiplication',
  convolution: 'convolution',
} as const

export type Benchmark = typeof BENCHMARK_IDS[keyof typeof BENCHMARK_IDS]

type ParamSpec = {
  key: string
  min: number
}

type BenchmarkManifest = {
  id: Benchmark
  label: string
  params: readonly ParamSpec[]
  s3ParameterKey: (params: Record<string, number>) => string
  timeoutSeconds: (params: Record<string, number>, baseSeconds: number, maxSeconds: number) => number
}

type IntReader = (params: Record<string, unknown>, key: string, min: number) => number

const VECTOR_PARAMS = [
  { key: 'vectorLength', min: 1 },
] as const

const MATMUL_PARAMS = [
  { key: 'inputRows', min: 1 },
  { key: 'inputCols', min: 1 },
  { key: 'outputCols', min: 1 },
] as const

const CONVOLUTION_PARAMS = [
  { key: 'inputN', min: 1 },
  { key: 'inputC', min: 1 },
  { key: 'inputH', min: 1 },
  { key: 'inputW', min: 1 },
  { key: 'filterOutC', min: 1 },
  { key: 'filterH', min: 1 },
  { key: 'filterW', min: 1 },
  { key: 'strideH', min: 1 },
  { key: 'strideW', min: 1 },
  { key: 'padH', min: 0 },
  { key: 'padW', min: 0 },
] as const

function clampTimeoutSeconds(seconds: number, baseSeconds: number, maxSeconds: number): number {
  const s = Math.trunc(seconds)
  if (!Number.isFinite(s) || s <= 0) return baseSeconds
  return Math.max(baseSeconds, Math.min(maxSeconds, s))
}

function vectorTimeout(params: Record<string, number>, baseSeconds: number, maxSeconds: number): number {
  const vectorLength = Number(params.vectorLength ?? 0)
  if (vectorLength >= 2_000_000_000) return clampTimeoutSeconds(2 * 60 * 60, baseSeconds, maxSeconds)
  return clampTimeoutSeconds(baseSeconds, baseSeconds, maxSeconds)
}

function matmulTimeout(params: Record<string, number>, baseSeconds: number, maxSeconds: number): number {
  const rows = Number(params.inputRows ?? 0)
  const k = Number(params.inputCols ?? 0)
  const outCols = Number(params.outputCols ?? 0)
  const estimatedOps = rows * k * outCols

  if (estimatedOps >= 1_000_000_000_000) return clampTimeoutSeconds(4 * 60 * 60, baseSeconds, maxSeconds)
  if (estimatedOps >= 500_000_000_000) return clampTimeoutSeconds(3 * 60 * 60, baseSeconds, maxSeconds)
  if (estimatedOps >= 100_000_000_000) return clampTimeoutSeconds(2 * 60 * 60, baseSeconds, maxSeconds)
  return clampTimeoutSeconds(baseSeconds, baseSeconds, maxSeconds)
}

function convolutionTimeout(params: Record<string, number>, baseSeconds: number, maxSeconds: number): number {
  const n = Number(params.inputN ?? 0)
  const cIn = Number(params.inputC ?? 0)
  const hIn = Number(params.inputH ?? 0)
  const wIn = Number(params.inputW ?? 0)
  const cOut = Number(params.filterOutC ?? 0)
  const kH = Number(params.filterH ?? 0)
  const kW = Number(params.filterW ?? 0)
  const strideH = Number(params.strideH ?? 1)
  const strideW = Number(params.strideW ?? 1)
  const padH = Number(params.padH ?? 0)
  const padW = Number(params.padW ?? 0)
  const outH = Math.floor((hIn + 2 * padH - kH) / Math.max(1, strideH)) + 1
  const outW = Math.floor((wIn + 2 * padW - kW) / Math.max(1, strideW)) + 1
  const estimatedOps = n * cOut * Math.max(0, outH) * Math.max(0, outW) * cIn * kH * kW

  if (estimatedOps >= 300_000_000_000) return clampTimeoutSeconds(3 * 60 * 60, baseSeconds, maxSeconds)
  if (estimatedOps >= 80_000_000_000) return clampTimeoutSeconds(2 * 60 * 60, baseSeconds, maxSeconds)
  return clampTimeoutSeconds(baseSeconds, baseSeconds, maxSeconds)
}

export const BENCHMARK_REGISTRY: Record<Benchmark, BenchmarkManifest> = {
  [BENCHMARK_IDS.vector]: {
    id: BENCHMARK_IDS.vector,
    label: 'Vector',
    params: VECTOR_PARAMS,
    s3ParameterKey: (params) => String(params.vectorLength),
    timeoutSeconds: vectorTimeout,
  },
  [BENCHMARK_IDS.matmul]: {
    id: BENCHMARK_IDS.matmul,
    label: 'Matrix Multiplication',
    params: MATMUL_PARAMS,
    s3ParameterKey: (params) => `${params.inputRows}-${params.inputCols}-${params.outputCols}`,
    timeoutSeconds: matmulTimeout,
  },
  [BENCHMARK_IDS.convolution]: {
    id: BENCHMARK_IDS.convolution,
    label: 'Convolution',
    params: CONVOLUTION_PARAMS,
    s3ParameterKey: (params) => CONVOLUTION_PARAMS.map((spec) => params[spec.key]).join('-'),
    timeoutSeconds: convolutionTimeout,
  },
}

export const BENCHMARK_ORDER = [
  BENCHMARK_IDS.vector,
  BENCHMARK_IDS.matmul,
  BENCHMARK_IDS.convolution,
] as const

export function benchmarkChoices(): string {
  return BENCHMARK_ORDER.join(', ')
}

export function isBenchmark(value: unknown): value is Benchmark {
  return typeof value === 'string' && value in BENCHMARK_REGISTRY
}

export function benchmarkManifest(benchmark: Benchmark): BenchmarkManifest {
  return BENCHMARK_REGISTRY[benchmark]
}

export function normalizeBenchmarkParams(
  benchmark: Benchmark,
  params: Record<string, unknown>,
  readInt: IntReader,
): Record<string, number> {
  const manifest = benchmarkManifest(benchmark)
  return Object.fromEntries(manifest.params.map((spec) => [spec.key, readInt(params, spec.key, spec.min)]))
}

export function benchmarkS3ParameterKey(benchmark: Benchmark, params: Record<string, number>): string {
  return benchmarkManifest(benchmark).s3ParameterKey(params)
}

export function estimateBenchmarkTimeoutSeconds(
  benchmark: Benchmark,
  params: Record<string, number>,
  baseSeconds: number,
  maxSeconds: number,
): number {
  return benchmarkManifest(benchmark).timeoutSeconds(params, baseSeconds, maxSeconds)
}
