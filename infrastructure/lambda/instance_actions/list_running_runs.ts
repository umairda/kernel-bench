import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ScanCommand, UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import { StopInstancesCommand } from '@aws-sdk/client-ec2'
import { ddb, ec2, ssm } from '../aws'
import { isOriginVerified, mapSsmStatus, nowIso, publicRunView, response, TERMINAL_STATUSES } from '../common'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
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

function createdTooOld(createdAt?: string): boolean {
  if (!createdAt) return false
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return false
  return (Date.now() - d.getTime()) / 1000 >= STARTING_STALE_SECONDS
}

async function reconcile(item: Record<string, any>): Promise<Record<string, any>> {
  if (!['STARTING','RUNNING'].includes(item.status)) return item

  if (item.status === 'STARTING' && !item.commandId && createdTooOld(item.createdAt)) {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
      UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: { ':status': 'FAILED', ':error': `Run stuck in STARTING without command for > ${STARTING_STALE_SECONDS}s`, ':updatedAt': nowIso(), ':completedAt': nowIso() },
    }))
    await releaseRunnerLock(item.runner, item.runId)
    const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
    return (latest.Item as Record<string, any>) ?? item
  }

  if (!item.commandId || !item.instanceId) return item

  try {
    const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: item.commandId, InstanceId: item.instanceId }))
    const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
    if (mapped === 'RUNNING') return item

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
    const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
    return (latest.Item as Record<string, any>) ?? item
  } catch {
    return item
  }
}

export async function handler(event: APIGatewayProxyEventV2) {
  if (!isOriginVerified(event)) return response(403, { error: 'origin not allowed' })

  const resp = await ddb.send(new ScanCommand({
    TableName: RUNS_TABLE_NAME,
    FilterExpression: '#status IN (:starting, :running)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':starting': 'STARTING', ':running': 'RUNNING' },
  }))

  const out: Record<string, any>[] = []
  for (const i of (resp.Items ?? []) as Record<string, any>[]) {
    const rec = await reconcile(i)
    if (!TERMINAL_STATUSES.has(rec.status)) out.push(publicRunView(rec))
  }

  out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  return response(200, { items: out })
}
