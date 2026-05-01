import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import { StopInstancesCommand } from '@aws-sdk/client-ec2'
import { ddb, ec2, putMetric, s3, ssm } from '../aws'
import { isOriginVerified, mapSsmStatus, nowIso, publicRunView, response, TERMINAL_STATUSES } from '../common'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const ARTIFACT_BUCKET_NAME = process.env.ARTIFACT_BUCKET_NAME!
const STARTING_STALE_SECONDS = Number(process.env.STARTING_STALE_SECONDS ?? '180')

async function releaseRunnerLock(runner: string | undefined, runId: string) {
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

async function stopInstance(instanceId?: string) {
  if (!instanceId) return
  try { await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] })) } catch {}
}

function parseIso(v?: string): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

async function attachPerformance(item: Record<string, any>): Promise<Record<string, any>> {
  if (item.performance || !item.s3Prefix) return item
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET_NAME, Key: `${item.s3Prefix}performance.json` }))
    const txt = await obj.Body?.transformToString()
    if (!txt) return item
    const perf = JSON.parse(txt)
    return { ...item, performance: perf }
  } catch {
    return item
  }
}

async function emitTerminalMetrics(item: Record<string, any>, mapped: string) {
  const runner = item.runner as string | undefined
  const benchmark = item.benchmark as string | undefined
  if (mapped === 'COMPLETED') await putMetric('RunCompleted', 1, runner, benchmark)
  if (mapped === 'FAILED') await putMetric('RunFailed', 1, runner, benchmark)
  if (mapped === 'CANCELLED') await putMetric('RunCancelled', 1, runner, benchmark)
  const created = parseIso(item.createdAt)
  if (created) {
    const sec = Math.max(0, (Date.now() - created.getTime()) / 1000)
    await putMetric('RunDurationSeconds', sec, runner, benchmark, 'Seconds')
  }
}

export async function handler(event: APIGatewayProxyEventV2) {
  if (!isOriginVerified(event)) return response(403, { error: 'origin not allowed' })
  const runId = event.pathParameters?.runId
  if (!runId) return response(400, { error: 'missing runId' })

  const found = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  let item = found.Item as Record<string, any> | undefined
  if (!item) return response(404, { error: 'run not found' })

  if (TERMINAL_STATUSES.has(item.status)) {
    await releaseRunnerLock(item.runner, runId)
    item = await attachPerformance(item)
    return response(200, publicRunView(item))
  }

  const commandId = item.commandId as string | undefined
  const instanceId = item.instanceId as string | undefined
  if (!commandId || !instanceId) {
    if (item.status === 'STARTING') {
      const created = parseIso(item.createdAt)
      if (created && (Date.now() - created.getTime()) / 1000 >= STARTING_STALE_SECONDS) {
        await ddb.send(new UpdateCommand({
          TableName: RUNS_TABLE_NAME,
          Key: { runId },
          UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt, completedAt = :completedAt',
          ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
          ExpressionAttributeValues: { ':status': 'FAILED', ':error': `Run stuck in STARTING without command for > ${STARTING_STALE_SECONDS}s`, ':updatedAt': nowIso(), ':completedAt': nowIso() },
        }))
        await releaseRunnerLock(item.runner, runId)
        const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
        return response(200, publicRunView((refreshed.Item as Record<string, any>) ?? item))
      }
    }
    return response(200, publicRunView(item))
  }

  try {
    const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }))
    const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
    const values: Record<string, any> = {
      ':status': mapped,
      ':ssmStatus': inv.Status ?? 'Unknown',
      ':updatedAt': nowIso(),
      ':responseCode': inv.ResponseCode ?? -1,
    }
    let updateExpression = 'SET #status = :status, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode'
    if (TERMINAL_STATUSES.has(mapped)) {
      updateExpression += ', completedAt = :completedAt'
      values[':completedAt'] = nowIso()
      await stopInstance(instanceId)
      await releaseRunnerLock(item.runner, runId)
      await emitTerminalMetrics(item, mapped)
    }
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: values,
    }))
  } catch (e: any) {
    if (String(e?.name ?? '').includes('InvocationDoesNotExist')) return response(200, publicRunView(item))
    return response(500, { error: String(e?.message ?? e) })
  }

  const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  item = (refreshed.Item as Record<string, any>) ?? item
  if (TERMINAL_STATUSES.has(item.status)) item = await attachPerformance(item)
  return response(200, publicRunView(item))
}
