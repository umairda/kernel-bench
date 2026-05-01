import { GetObjectCommand } from '@aws-sdk/client-s3'
import { DescribeInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2'
import { GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, ec2, putMetric, s3, ssm } from '../aws'
import { JsonRpcError, TERMINAL_STATUSES, mapSsmStatus, normalizePerformance, nowIso, publicRunView } from '../common'
import { queryHistory, writeHistoryRecord } from '../history'

export type Runner = 'cpu' | 'gpu'
export type Benchmark = 'vector' | 'matrix-multiplication' | 'convolution'
export type HistoryRunnerParam = Runner | 'all' | undefined

export const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
export const ARTIFACT_BUCKET_NAME = process.env.ARTIFACT_BUCKET_NAME!
export const CPU_INSTANCE_ID = process.env.CPU_INSTANCE_ID!
export const GPU_INSTANCE_ID = process.env.GPU_INSTANCE_ID!
export const LOCK_TTL_SECONDS = Number(process.env.RUNNER_LOCK_TTL_SECONDS ?? '7200')
export const STARTING_STALE_SECONDS = Number(process.env.STARTING_STALE_SECONDS ?? '180')

export function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonRpcError(-32602, 'params must be an object')
  }
  return value as Record<string, unknown>
}

export function toInt(params: Record<string, unknown>, key: string, min = 1): number {
  const v = Number(params[key])
  if (!Number.isFinite(v) || v < min) throw new JsonRpcError(-32602, `invalid integer parameter: ${key}`)
  return Math.trunc(v)
}

export function validateBenchmarkParams(benchmark: Benchmark, params: Record<string, unknown>): Record<string, number> {
  if (benchmark === 'vector') return { vectorLength: toInt(params, 'vectorLength', 1) }
  if (benchmark === 'matrix-multiplication') {
    return {
      inputRows: toInt(params, 'inputRows', 1),
      inputCols: toInt(params, 'inputCols', 1),
      outputCols: toInt(params, 'outputCols', 1),
    }
  }
  return {
    inputN: toInt(params, 'inputN', 1),
    inputC: toInt(params, 'inputC', 1),
    inputH: toInt(params, 'inputH', 1),
    inputW: toInt(params, 'inputW', 1),
    filterOutC: toInt(params, 'filterOutC', 1),
    filterH: toInt(params, 'filterH', 1),
    filterW: toInt(params, 'filterW', 1),
    strideH: toInt(params, 'strideH', 1),
    strideW: toInt(params, 'strideW', 1),
    padH: toInt(params, 'padH', 0),
    padW: toInt(params, 'padW', 0),
  }
}

export function parseRunner(value: unknown, fallback: HistoryRunnerParam = 'all'): HistoryRunnerParam {
  if (value === undefined) return fallback
  if (value === 'cpu' || value === 'gpu' || value === 'all') return value
  throw new JsonRpcError(-32602, 'runner must be cpu, gpu, or all')
}

export function parseRunId(params: Record<string, unknown>) {
  const runId = params.runId
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new JsonRpcError(-32602, 'runId is required')
  }
  return runId
}

export function createdTooOld(createdAt?: string): boolean {
  if (!createdAt) return false
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return false
  return (Date.now() - d.getTime()) / 1000 >= STARTING_STALE_SECONDS
}

export async function releaseRunnerLock(runner: string | undefined, runId: string) {
  if (!runner) return
  try {
    await ddb.send(new DeleteCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: `RUNNER_LOCK#${runner}` },
      ConditionExpression: 'ownerRunId = :owner',
      ExpressionAttributeValues: { ':owner': runId },
    }))
  } catch {}
}

export async function stopInstance(instanceId?: string) {
  if (!instanceId) return
  try {
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }))
  } catch {}
}

export async function acquireRunnerLock(runner: Runner, runId: string): Promise<{ ok: boolean; activeRunId?: string }> {
  const now = Math.floor(Date.now() / 1000)
  try {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: `RUNNER_LOCK#${runner}` },
      UpdateExpression: 'SET ownerRunId = :owner, runner = :runner, expiresAtEpoch = :expires, updatedAt = :updated',
      ConditionExpression: 'attribute_not_exists(ownerRunId) OR expiresAtEpoch < :now',
      ExpressionAttributeValues: {
        ':owner': runId,
        ':runner': runner,
        ':expires': now + LOCK_TTL_SECONDS,
        ':updated': nowIso(),
        ':now': now,
      },
    }))
    return { ok: true }
  } catch {
    const existing = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: `RUNNER_LOCK#${runner}` } }))
    return { ok: false, activeRunId: (existing.Item as any)?.ownerRunId }
  }
}

export async function attachPerformance(item: Record<string, any>): Promise<Record<string, any>> {
  if (!item.s3Prefix) return item
  if (!item.performance) {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET_NAME, Key: `${item.s3Prefix}performance.json` }))
      const txt = await obj.Body?.transformToString()
      if (txt) {
        const parsed = JSON.parse(txt)
        item = { ...item, performance: parsed }
        await ddb.send(new UpdateCommand({
          TableName: RUNS_TABLE_NAME,
          Key: { runId: item.runId },
          UpdateExpression: 'SET performance = :performance',
          ExpressionAttributeValues: { ':performance': parsed },
        }))
      }
    } catch {}
  }

  if (item.performance && item.status === 'COMPLETED') {
    await writeHistoryRecord({
      runId: item.runId,
      benchmark: item.benchmark,
      runner: item.runner,
      params: item.params ?? {},
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      performance: normalizePerformance(item.performance),
    })
  }
  return item
}

export async function emitTerminalMetrics(item: Record<string, any>, mapped: string) {
  const runner = item.runner as string | undefined
  const benchmark = item.benchmark as string | undefined
  if (mapped === 'COMPLETED') await putMetric('RunCompleted', 1, runner, benchmark)
  if (mapped === 'FAILED') await putMetric('RunFailed', 1, runner, benchmark)
  if (mapped === 'CANCELLED') await putMetric('RunCancelled', 1, runner, benchmark)
}

export async function reconcileRunningItem(item: Record<string, any>): Promise<Record<string, any>> {
  if (!['STARTING', 'RUNNING'].includes(item.status)) return item

  if (item.status === 'STARTING' && !item.commandId && createdTooOld(item.createdAt)) {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
      UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':error': `Run stuck in STARTING without command for > ${STARTING_STALE_SECONDS}s`,
        ':updatedAt': nowIso(),
        ':completedAt': nowIso(),
      },
    }))
    await releaseRunnerLock(item.runner, item.runId)
    const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
    return (latest.Item as Record<string, any>) ?? item
  }

  if (!item.commandId || !item.instanceId) return item

  try {
    const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: item.commandId, InstanceId: item.instanceId }))
    const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
    if (mapped === 'RUNNING') {
      const state = await getState(item.instanceId)
      if (!['stopped', 'stopping', 'shutting-down', 'terminated'].includes(state)) {
        return item
      }

      await ddb.send(new UpdateCommand({
        TableName: RUNS_TABLE_NAME,
        Key: { runId: item.runId },
        UpdateExpression: 'SET #status = :status, #error = :error, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':error': `Instance state is ${state} while SSM status is ${inv.Status ?? 'Unknown'}`,
          ':ssmStatus': inv.Status ?? 'Unknown',
          ':updatedAt': nowIso(),
          ':responseCode': inv.ResponseCode ?? -1,
          ':completedAt': nowIso(),
        },
      }))
      await releaseRunnerLock(item.runner, item.runId)
      await emitTerminalMetrics(item, 'FAILED')
      const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
      return (latest.Item as Record<string, any>) ?? item
    }

    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
      UpdateExpression: 'SET #status = :status, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': mapped,
        ':ssmStatus': inv.Status ?? 'Unknown',
        ':updatedAt': nowIso(),
        ':responseCode': inv.ResponseCode ?? -1,
        ':completedAt': nowIso(),
      },
    }))
    await stopInstance(item.instanceId)
    await releaseRunnerLock(item.runner, item.runId)
    await emitTerminalMetrics(item, mapped)
    const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
    return (latest.Item as Record<string, any>) ?? item
  } catch {
    return item
  }
}

export async function getState(instanceId: string) {
  const resp = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
  return resp.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown'
}

export { ddb, ec2, ssm, mapSsmStatus, nowIso, publicRunView, queryHistory, JsonRpcError, putMetric, TERMINAL_STATUSES }
