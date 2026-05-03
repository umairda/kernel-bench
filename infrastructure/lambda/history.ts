import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { ddb } from './aws'
import { BENCHMARK_IDS, type Benchmark } from './benchmark_registry'
import { normalizeOperationDurations } from './common'

const HISTORY_TABLE_NAME = process.env.HISTORY_TABLE_NAME

type HistoryRunner = 'cpu' | 'gpu'

type HistorySourceRun = {
  runId: string
  benchmark: Benchmark
  runner: HistoryRunner
  instanceType?: string
  params: Record<string, number>
  createdAt?: string
  completedAt?: string
  performance?: {
    totalDurationMs?: number
    operationDurations?: Array<{ name: string; durationMs: number }>
    operations?: Array<{ name?: string; operationType?: string; durationMs?: number }>
  }
}

function fallbackInstanceType(runner: HistoryRunner): string {
  return runner === 'cpu' ? 'c7i.8xlarge' : 'g6e.xlarge'
}

function operationLookup(performance?: HistorySourceRun['performance']) {
  const ops = normalizeOperationDurations(performance)
  return Object.fromEntries(ops.map((op) => [normalizeOperationName(op.name), op.durationMs]))
}

function normalizeOperationName(name: string) {
  if (name === BENCHMARK_IDS.matmul) return 'matmul'
  return name
    .replace(/^vector-/, '')
}

function seriesKey(benchmark: Benchmark, runner: HistoryRunner) {
  return `${benchmark}#${runner}`
}

function completedAtRunId(run: Pick<HistorySourceRun, 'createdAt' | 'completedAt' | 'runId'>) {
  return `${run.createdAt ?? run.completedAt}#${run.runId}`
}

export async function writeHistoryRecord(run: HistorySourceRun) {
  if (!HISTORY_TABLE_NAME || !run.performance || !run.completedAt) return

  const normalizedOperations = normalizeOperationDurations(run.performance).map((op) => ({
    name: normalizeOperationName(op.name),
    durationMs: op.durationMs,
  }))
  if (normalizedOperations.length === 0) return

  const params = run.params ?? {}
  const lookup = operationLookup(run.performance)
  const squareSize =
    run.benchmark === BENCHMARK_IDS.matmul &&
    params.inputRows === params.inputCols &&
    params.inputCols === params.outputCols
      ? params.inputRows
      : undefined

  const item: Record<string, unknown> = {
    seriesKey: seriesKey(run.benchmark, run.runner),
    completedAtRunId: completedAtRunId(run),
    runId: run.runId,
    benchmark: run.benchmark,
    runner: run.runner,
    instanceType: run.instanceType ?? fallbackInstanceType(run.runner),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    params,
    totalDurationMs: run.performance.totalDurationMs,
    operationDurations: normalizedOperations,
    opMs: lookup,
  }

  if (run.benchmark === BENCHMARK_IDS.vector) {
    item.vectorLength = params.vectorLength
  } else if (run.benchmark === BENCHMARK_IDS.matmul) {
    item.inputRows = params.inputRows
    item.inputCols = params.inputCols
    item.outputCols = params.outputCols
    item.isSquare = squareSize !== undefined
    item.squareSize = squareSize
  } else if (run.benchmark === BENCHMARK_IDS.convolution) {
    item.inputN = params.inputN
    item.inputC = params.inputC
    item.inputH = params.inputH
    item.inputW = params.inputW
    item.filterOutC = params.filterOutC
    item.filterH = params.filterH
    item.filterW = params.filterW
    item.strideH = params.strideH
    item.strideW = params.strideW
    item.padH = params.padH
    item.padW = params.padW
    item.inputArea = params.inputH * params.inputW
    item.filterArea = params.filterH * params.filterW
  }

  await ddb.send(new PutCommand({
    TableName: HISTORY_TABLE_NAME,
    Item: item,
  }))
}

async function queryHistorySeries(benchmark: Benchmark, runner: HistoryRunner) {
  if (!HISTORY_TABLE_NAME) return []
  const result = await ddb.send(new QueryCommand({
    TableName: HISTORY_TABLE_NAME,
    KeyConditionExpression: 'seriesKey = :seriesKey',
    ExpressionAttributeValues: {
      ':seriesKey': seriesKey(benchmark, runner),
    },
    ScanIndexForward: true,
  }))
  return (result.Items ?? []) as Array<Record<string, any>>
}

function chooseHistoryItem(a: Record<string, any>, b: Record<string, any>) {
  const aCompletedAt = String(a.completedAt ?? '')
  const bCompletedAt = String(b.completedAt ?? '')
  if (aCompletedAt !== bCompletedAt) {
    return aCompletedAt > bCompletedAt ? a : b
  }

  const aUpdatedAt = String(a.updatedAt ?? '')
  const bUpdatedAt = String(b.updatedAt ?? '')
  if (aUpdatedAt !== bUpdatedAt) {
    return aUpdatedAt > bUpdatedAt ? a : b
  }

  return a
}

function dedupeHistoryItems(items: Array<Record<string, any>>) {
  const byRunId = new Map<string, Record<string, any>>()
  const withoutRunId: Array<Record<string, any>> = []

  for (const item of items) {
    if (!item.runId) {
      withoutRunId.push(item)
      continue
    }

    const key = String(item.runId)
    const existing = byRunId.get(key)
    byRunId.set(key, existing ? chooseHistoryItem(existing, item) : item)
  }

  return [...byRunId.values(), ...withoutRunId]
}

export async function queryHistory(benchmark: Benchmark, runner?: HistoryRunner | 'all') {
  const runners: HistoryRunner[] = runner && runner !== 'all' ? [runner] : ['cpu', 'gpu']
  const results = await Promise.all(runners.map((value) => queryHistorySeries(benchmark, value)))
  return dedupeHistoryItems(results.flat())
    .sort((a, b) => String(a.completedAt ?? '').localeCompare(String(b.completedAt ?? '')))
}
