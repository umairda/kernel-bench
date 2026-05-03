import { BENCHMARK_IDS } from '../benchmark_registry'
import { asObject, parseRunner, queryHistory } from './shared'

export async function rpcHistoryMatmul(rawParams: unknown) {
  const params = rawParams === undefined ? {} : asObject(rawParams)
  const squareOnly = params.squareOnly === undefined ? true : Boolean(params.squareOnly)
  const items = await queryHistory(BENCHMARK_IDS.matmul, parseRunner(params.runner))
  return {
    items: items
      .filter((item) => !squareOnly || item.isSquare)
      .map((item) => ({
        runId: item.runId,
        runner: item.runner,
        completedAt: item.completedAt,
        size: item.squareSize ?? null,
        inputRows: item.inputRows,
        inputCols: item.inputCols,
        outputCols: item.outputCols,
        matmulMs: item.opMs?.matmul ?? null,
        totalDurationMs: item.totalDurationMs ?? null,
      })),
  }
}
