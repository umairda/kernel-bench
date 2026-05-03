import { BENCHMARK_IDS } from '../benchmark_registry'
import { asObject, parseRunner, queryHistory } from './shared'

export async function rpcHistoryVector(rawParams: unknown) {
  const params = rawParams === undefined ? {} : asObject(rawParams)
  const items = await queryHistory(BENCHMARK_IDS.vector, parseRunner(params.runner))
  return {
    items: items.map((item) => ({
      runId: item.runId,
      runner: item.runner,
      completedAt: item.completedAt,
      vectorLength: item.vectorLength,
      addMs: item.opMs?.add ?? null,
      subtractMs: item.opMs?.subtract ?? null,
      multiplyMs: item.opMs?.multiply ?? null,
      divideMs: item.opMs?.divide ?? null,
      totalDurationMs: item.totalDurationMs ?? null,
    })),
  }
}
