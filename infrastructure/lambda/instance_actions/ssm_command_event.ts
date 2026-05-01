import type { EventBridgeEvent } from 'aws-lambda'
import { QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { StopInstancesCommand } from '@aws-sdk/client-ec2'
import { ddb, ec2, putMetric } from '../aws'
import { mapSsmStatus, nowIso, TERMINAL_STATUSES } from '../common'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const COMMAND_ID_INDEX_NAME = process.env.COMMAND_ID_INDEX_NAME ?? 'commandId-index'

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

export async function handler(event: EventBridgeEvent<string, any>) {
  const commandId = event.detail?.['command-id'] as string | undefined
  if (!commandId) return { ok: true, reason: 'missing command-id' }

  const q = await ddb.send(new QueryCommand({
    TableName: RUNS_TABLE_NAME,
    IndexName: COMMAND_ID_INDEX_NAME,
    KeyConditionExpression: 'commandId = :commandId',
    ExpressionAttributeValues: { ':commandId': commandId },
    Limit: 1,
  }))

  const item = (q.Items?.[0] ?? null) as Record<string, any> | null
  if (!item) return { ok: true, reason: 'run not found for command-id', commandId }

  const runId = item.runId as string
  const ssmStatus = String(event.detail?.status ?? 'Unknown')
  const mapped = mapSsmStatus(ssmStatus)
  const responseCodeRaw = event.detail?.['response-code']
  const responseCode = Number.isFinite(Number(responseCodeRaw)) ? Number(responseCodeRaw) : -1

  const values: Record<string, any> = {
    ':ssmStatus': ssmStatus,
    ':status': mapped,
    ':updatedAt': nowIso(),
    ':responseCode': responseCode,
  }
  let updateExpression = 'SET ssmStatus = :ssmStatus, #status = :status, updatedAt = :updatedAt, responseCode = :responseCode'
  if (TERMINAL_STATUSES.has(mapped)) {
    updateExpression += ', completedAt = :completedAt'
    values[':completedAt'] = nowIso()
  }

  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: values,
  }))

  if (TERMINAL_STATUSES.has(mapped)) {
    await stopInstance((event.detail?.['instance-id'] as string | undefined) ?? item.instanceId)
    await releaseRunnerLock(item.runner as string | undefined, runId)
    const runner = item.runner as string | undefined
    const benchmark = item.benchmark as string | undefined
    if (mapped === 'COMPLETED') await putMetric('RunCompleted', 1, runner, benchmark)
    if (mapped === 'FAILED') await putMetric('RunFailed', 1, runner, benchmark)
    if (mapped === 'CANCELLED') await putMetric('RunCancelled', 1, runner, benchmark)
  }

  return { ok: true, runId, status: mapped }
}
