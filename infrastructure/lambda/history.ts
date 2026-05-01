import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { ddb } from './aws'
import { normalizeOperationDurations } from './common'

const HISTORY_TABLE_NAME = process.env.HISTORY_TABLE_NAME

type HistoryRunner = 'cpu' | 'gpu'
type HistoryBenchmark = 'vector' | 'matrix-multiplication' | 'convolution'

type HistorySourceRun = {
  runId: string
  benchmark: HistoryBenchmark
  runner: HistoryRunner
  params: Record<string, number>
  createdAt?: string
  completedAt?: string
  performance?: {
    totalDurationMs?: number
    operationDurations?: Array<{ name: string; durationMs: number }>
    operations?: Array<{ name?: string; operationType?: string; durationMs?: number }>
  }
}

function operationLookup(performance?: HistorySourceRun['performance']) {
  const ops = normalizeOperationDurations(performance)
  return Object.fromEntries(ops.map((op) => [normalizeOperationName(op.name), op.durationMs]))
}

function normalizeOperationName(name: string) {
  return name
    .replace(/^vector-/, '')
    .replace(/^matrix-multiplication$/, 'matmul')
    .replace(/^convolution$/, 'convolution')
}

function seriesKey(benchmark: HistoryBenchmark, runner: HistoryRunner) {
  return `${benchmark}#${runner}`
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
    run.benchmark === 'matrix-multiplication' &&
    params.inputRows === params.inputCols &&
    params.inputCols === params.outputCols
      ? params.inputRows
      : undefined

  const item: Record<string, unknown> = {
    seriesKey: seriesKey(run.benchmark, run.runner),
    completedAtRunId: `${run.completedAt}#${run.runId}`,
    runId: run.runId,
    benchmark: run.benchmark,
    runner: run.runner,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    params,
    totalDurationMs: run.performance.totalDurationMs,
    operationDurations: normalizedOperations,
    opMs: lookup,
  }

  if (run.benchmark === 'vector') {
    item.vectorLength = params.vectorLength
  } else if (run.benchmark === 'matrix-multiplication') {
    item.inputRows = params.inputRows
    item.inputCols = params.inputCols
    item.outputCols = params.outputCols
    item.isSquare = squareSize !== undefined
    item.squareSize = squareSize
  } else if (run.benchmark === 'convolution') {
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

async function queryHistorySeries(benchmark: HistoryBenchmark, runner: HistoryRunner) {
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

export async function queryHistory(benchmark: HistoryBenchmark, runner?: HistoryRunner | 'all') {
  const runners: HistoryRunner[] = runner && runner !== 'all' ? [runner] : ['cpu', 'gpu']
  const results = await Promise.all(runners.map((value) => queryHistorySeries(benchmark, value)))
  return results.flat().sort((a, b) => String(a.completedAt ?? '').localeCompare(String(b.completedAt ?? '')))
}
