import { describe, expect, it } from 'vitest'
import { buildConvolutionSeries, buildMatmulSeries, buildVectorSeries } from './HistoricalView'

describe('HistoricalView series builders', () => {
  it('filters non-positive values before log-scale vector charts', () => {
    const series = buildVectorSeries([
      { runId: 'zero', runner: 'cpu', vectorLength: 100, addMs: 0, subtractMs: null, multiplyMs: null, divideMs: null, totalDurationMs: null },
      { runId: 'positive', runner: 'cpu', vectorLength: 1000, addMs: 4, subtractMs: null, multiplyMs: null, divideMs: null, totalDurationMs: null },
      { runId: 'gpu', runner: 'gpu', vectorLength: 1000, addMs: 8, subtractMs: null, multiplyMs: null, divideMs: null, totalDurationMs: null },
    ], 'addMs', 'cpu')

    expect(series).toEqual([{ x: 1000, y: 4, runId: 'positive', completedAt: undefined }])
  })

  it('filters non-positive values before log-scale matrix charts', () => {
    const series = buildMatmulSeries([
      { runId: 'zero', runner: 'cpu', size: 512, inputRows: 512, inputCols: 512, outputCols: 512, matmulMs: 0, totalDurationMs: null },
      { runId: 'positive', runner: 'cpu', size: 1024, inputRows: 1024, inputCols: 1024, outputCols: 1024, matmulMs: 12, totalDurationMs: null },
    ], 'cpu')

    expect(series).toEqual([{ x: 1024, y: 12, runId: 'positive', completedAt: undefined }])
  })

  it('filters non-positive values before log-scale convolution charts', () => {
    const series = buildConvolutionSeries([
      {
        runId: 'zero', runner: 'cpu', inputN: 1, inputC: 3, inputH: 64, inputW: 64,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 4096, filterArea: 9, convolutionMs: 0, totalDurationMs: null,
      },
      {
        runId: 'positive', runner: 'cpu', inputN: 1, inputC: 3, inputH: 128, inputW: 128,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 16384, filterArea: 9, convolutionMs: 20, totalDurationMs: null,
      },
    ], 'cpu')

    expect(series).toEqual([{
      x: 16384,
      y: 20,
      runId: 'positive',
      completedAt: undefined,
      label: '128x128 · K=16 · 3x3',
    }])
  })
})
