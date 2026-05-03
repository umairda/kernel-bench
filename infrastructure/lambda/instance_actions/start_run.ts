import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { v4 as uuidv4 } from 'uuid'
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { StartExecutionCommand } from '@aws-sdk/client-sfn'
import { ddb, putMetric, sfn } from '../aws'
import { benchmarkChoices, isBenchmark, normalizeBenchmarkParams } from '../benchmark_registry'
import { isOriginVerified, makeS3Prefix, nowIso, parseJsonBody, publicRunView, response, runTimestamp } from '../common'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const CPU_INSTANCE_ID = process.env.CPU_INSTANCE_ID!
const GPU_INSTANCE_ID = process.env.GPU_INSTANCE_ID!
const CPU_INSTANCE_TYPE = process.env.CPU_INSTANCE_TYPE ?? 'c7i.8xlarge'
const GPU_INSTANCE_TYPE = process.env.GPU_INSTANCE_TYPE ?? 'g6e.xlarge'
const RUN_WORKFLOW_STATE_MACHINE_ARN = process.env.RUN_WORKFLOW_STATE_MACHINE_ARN!
const LOCK_TTL_SECONDS = Number(process.env.RUNNER_LOCK_TTL_SECONDS ?? '7200')

function toInt(params: Record<string, unknown>, key: string, min = 1): number {
  const v = Number(params[key])
  if (!Number.isFinite(v) || v < min) throw new Error(`invalid integer parameter: ${key}`)
  return Math.trunc(v)
}

async function acquireRunnerLock(runner: string, runId: string): Promise<{ ok: boolean; activeRunId?: string }> {
  const now = Math.floor(Date.now() / 1000)
  try {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: `RUNNER_LOCK#${runner}` },
      UpdateExpression: 'SET ownerRunId = :owner, runner = :runner, expiresAtEpoch = :expires, updatedAt = :updated',
      ConditionExpression: 'attribute_not_exists(ownerRunId) OR expiresAtEpoch < :now',
      ExpressionAttributeValues: { ':owner': runId, ':runner': runner, ':expires': now + LOCK_TTL_SECONDS, ':updated': nowIso(), ':now': now },
    }))
    return { ok: true }
  } catch {
    const existing = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: `RUNNER_LOCK#${runner}` } }))
    return { ok: false, activeRunId: (existing.Item as any)?.ownerRunId }
  }
}

export async function handler(event: APIGatewayProxyEventV2) {
  try {
    if (!isOriginVerified(event)) return response(403, { error: 'origin not allowed' })
    const payload = parseJsonBody<any>(event)
    const runner = payload.runner
    const benchmark = payload.benchmark
    const params = payload.params ?? {}
    if (!['cpu', 'gpu'].includes(runner)) return response(400, { error: 'runner must be one of: cpu, gpu' })
    if (!isBenchmark(benchmark)) return response(400, { error: `benchmark must be one of: ${benchmarkChoices()}` })

    const normalizedParams = normalizeBenchmarkParams(benchmark, params, toInt)
    const runId = uuidv4()
    const createdAt = nowIso()
    const timestamp = runTimestamp()
    const s3Prefix = makeS3Prefix(benchmark, normalizedParams, timestamp, runner)
    const instanceId = runner === 'cpu' ? CPU_INSTANCE_ID : GPU_INSTANCE_ID
    const instanceType = runner === 'cpu' ? CPU_INSTANCE_TYPE : GPU_INSTANCE_TYPE

    const lock = await acquireRunnerLock(runner, runId)
    if (!lock.ok) {
      await putMetric('RunnerBusy', 1, runner, benchmark)
      return response(409, { error: `${runner} runner already has an active run`, runner, activeRunId: lock.activeRunId })
    }

    const item = {
      runId,
      runner,
      benchmark,
      params: normalizedParams,
      status: 'STARTING',
      instanceId,
      instanceType,
      s3Prefix,
      createdAt,
      updatedAt: createdAt,
      startupProgress: {
        phase: 'QUEUED',
        ec2State: 'unknown',
        instanceStatus: 'unknown',
        systemStatus: 'unknown',
        ssmPingStatus: 'unknown',
        detail: 'Run accepted and queued for workflow execution',
        observedAt: createdAt,
      },
    }

    await ddb.send(new PutCommand({ TableName: RUNS_TABLE_NAME, Item: item }))
    await sfn.send(new StartExecutionCommand({
      stateMachineArn: RUN_WORKFLOW_STATE_MACHINE_ARN,
      name: runId,
      input: JSON.stringify(item),
    }))

    await putMetric('RunStarted', 1, runner, benchmark)
    return response(200, publicRunView({ ...item, ssmStatus: 'Pending', responseCode: -1 }))
  } catch (e: any) {
    return response(500, { error: String(e?.message ?? e) })
  }
}
