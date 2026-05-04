import { describe, expect, it } from 'vitest'
import {
  buildConvolutionHeatmap,
  buildConvolutionSeries,
  buildDimensionOptions,
  buildFilteredConvolutionSeries,
  buildLogGridTicks,
  buildMatmulSeries,
  buildVectorSeries,
  buildXAxisTicks,
  buildYAxisTicks,
} from './HistoricalView'

describe('HistoricalView series builders', () => {
  it('builds standard power-of-ten log-scale axis ticks', () => {
    const points = [[
      { x: 8192, y: 4 },
      { x: 16384, y: 1250 },
      { x: 100000, y: 65000 },
    ]]

    expect(buildXAxisTicks(points)).toEqual([1000, 10000, 100000])
    expect(buildYAxisTicks(points)).toEqual([1, 10, 100, 1000, 10000, 100000])
  })

  it('builds unlabeled minor log grid ticks between labeled powers', () => {
    expect(buildLogGridTicks(100, 1000)).toEqual([100, 200, 400, 600, 800, 1000])
  })

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

  it('builds convolution dimension filters and filtered scatter points', () => {
    const points = [
      {
        runId: 'a', runner: 'cpu' as const, inputN: 1, inputC: 3, inputH: 64, inputW: 128,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 8192, filterArea: 9, convolutionMs: 10, totalDurationMs: null,
      },
      {
        runId: 'b', runner: 'cpu' as const, inputN: 1, inputC: 3, inputH: 128, inputW: 128,
        filterOutC: 32, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 16384, filterArea: 9, convolutionMs: 20, totalDurationMs: null,
      },
    ]

    expect(buildDimensionOptions(points, 'inputH')).toEqual([64, 128])
    expect(buildFilteredConvolutionSeries(points, 'cpu', { inputH: 64, inputW: 'all' })).toMatchObject([
      { runId: 'a', x: 8192, y: 10, inputH: 64, inputW: 128 },
    ])
  })

  it('builds convolution heatmap cells with CPU and GPU averages', () => {
    const cells = buildConvolutionHeatmap([
      {
        runId: 'cpu-a', runner: 'cpu', inputN: 1, inputC: 3, inputH: 64, inputW: 64,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 4096, filterArea: 9, convolutionMs: 10, totalDurationMs: null,
      },
      {
        runId: 'cpu-b', runner: 'cpu', inputN: 1, inputC: 3, inputH: 64, inputW: 64,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 4096, filterArea: 9, convolutionMs: 14, totalDurationMs: null,
      },
      {
        runId: 'gpu-a', runner: 'gpu', inputN: 1, inputC: 3, inputH: 64, inputW: 64,
        filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1,
        inputArea: 4096, filterArea: 9, convolutionMs: 4, totalDurationMs: null,
      },
    ])

    expect(cells).toEqual([{ key: '4096:16', inputArea: 4096, filterOutC: 16, cpuMs: 12, gpuMs: 4 }])
  })
})
