import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_IDS,
  benchmarkChoices,
  benchmarkS3ParameterKey,
  estimateBenchmarkTimeoutSeconds,
  isBenchmark,
  normalizeBenchmarkParams,
} from '../../lambda/benchmark_registry'

function readInt(params: Record<string, unknown>, key: string, min: number) {
  const value = Number(params[key])
  if (!Number.isFinite(value) || value < min) throw new Error(`invalid ${key}`)
  return Math.trunc(value)
}

describe('benchmark_registry', () => {
  it('identifies supported benchmarks and exposes stable choices', () => {
    expect(isBenchmark(BENCHMARK_IDS.vector)).toBe(true)
    expect(isBenchmark('not-a-benchmark')).toBe(false)
    expect(benchmarkChoices()).toBe('vector, matrix-multiplication, convolution')
  })

  it('normalizes params from manifest specs', () => {
    expect(normalizeBenchmarkParams(BENCHMARK_IDS.matmul, {
      inputRows: 128.9,
      inputCols: '64',
      outputCols: 32,
    }, readInt)).toEqual({
      inputRows: 128,
      inputCols: 64,
      outputCols: 32,
    })

    expect(() => normalizeBenchmarkParams(BENCHMARK_IDS.convolution, {
      inputN: 1,
      inputC: 3,
      inputH: 64,
      inputW: 64,
      filterOutC: 16,
      filterH: 3,
      filterW: 3,
      strideH: 1,
      strideW: 1,
      padH: -1,
      padW: 0,
    }, readInt)).toThrow('invalid padH')
  })

  it('builds benchmark-specific S3 parameter keys', () => {
    expect(benchmarkS3ParameterKey(BENCHMARK_IDS.vector, { vectorLength: 1000 })).toBe('1000')
    expect(benchmarkS3ParameterKey(BENCHMARK_IDS.matmul, { inputRows: 2, inputCols: 3, outputCols: 4 })).toBe('2-3-4')
    expect(benchmarkS3ParameterKey(BENCHMARK_IDS.convolution, {
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
    })).toBe('1-3-64-64-16-3-3-1-1-1-1')
  })

  it('estimates larger timeouts for large work units', () => {
    expect(estimateBenchmarkTimeoutSeconds(BENCHMARK_IDS.vector, { vectorLength: 1 }, 5400, 21600)).toBe(5400)
    expect(estimateBenchmarkTimeoutSeconds(BENCHMARK_IDS.vector, { vectorLength: 2_000_000_000 }, 5400, 21600)).toBe(7200)
    expect(estimateBenchmarkTimeoutSeconds(BENCHMARK_IDS.matmul, { inputRows: 10000, inputCols: 10000, outputCols: 10000 }, 5400, 21600)).toBe(14400)
  })
})
