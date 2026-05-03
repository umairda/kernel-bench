import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_IDS,
  BENCHMARK_TABS,
  benchmarkKey,
  benchmarkLabel,
  benchmarkToTab,
  formatBenchmarkParams,
} from './benchmarkRegistry'

describe('benchmarkRegistry', () => {
  it('maps benchmarks to UI tabs and labels', () => {
    expect(BENCHMARK_TABS).toEqual([
      { value: 'vector', label: 'Vector' },
      { value: 'matmul', label: 'Matrix Multiplication' },
      { value: 'conv', label: 'Convolution' },
    ])
    expect(benchmarkToTab(BENCHMARK_IDS.matmul)).toBe('matmul')
    expect(benchmarkLabel(BENCHMARK_IDS.convolution)).toBe('Convolution')
  })

  it('builds stable latest-run keys', () => {
    expect(benchmarkKey(BENCHMARK_IDS.vector, 'cpu')).toBe('vector:cpu')
    expect(benchmarkKey(BENCHMARK_IDS.matmul, 'gpu')).toBe('matrix-multiplication:gpu')
  })

  it('formats benchmark parameters for status cards', () => {
    expect(formatBenchmarkParams(BENCHMARK_IDS.vector, { vectorLength: 1000000 })).toBe('n=1,000,000')
    expect(formatBenchmarkParams(BENCHMARK_IDS.matmul, { inputRows: 1000, inputCols: 2000, outputCols: 3000 })).toBe('1,000x2,000 * 2,000x3,000')
    expect(formatBenchmarkParams(BENCHMARK_IDS.convolution, {
      inputN: 1,
      inputC: 3,
      inputH: 64,
      inputW: 64,
      filterOutC: 16,
      filterH: 3,
      filterW: 3,
      strideH: 1,
      padH: 1,
    })).toBe('N1 C3 H64 W64 | K16 3x3 s1 p1')
  })
})
