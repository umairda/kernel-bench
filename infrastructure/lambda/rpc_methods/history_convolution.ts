import { asObject, parseRunner, queryHistory } from './shared'

export async function rpcHistoryConvolution(rawParams: unknown) {
  const params = rawParams === undefined ? {} : asObject(rawParams)
  const items = await queryHistory('convolution', parseRunner(params.runner))
  return {
    items: items.map((item) => ({
      runId: item.runId,
      runner: item.runner,
      completedAt: item.completedAt,
      inputN: item.inputN,
      inputC: item.inputC,
      inputH: item.inputH,
      inputW: item.inputW,
      filterOutC: item.filterOutC,
      filterH: item.filterH,
      filterW: item.filterW,
      strideH: item.strideH,
      strideW: item.strideW,
      padH: item.padH,
      padW: item.padW,
      inputArea: item.inputArea,
      filterArea: item.filterArea,
      convolutionMs: item.opMs?.convolution ?? null,
      totalDurationMs: item.totalDurationMs ?? null,
    })),
  }
}
