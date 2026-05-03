import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_TABLE_NAME, JsonRpcError, asObject, ddb, parseRunId } from './shared'
import { dispatchNextQueuedRun } from '../run_queue'

export async function rpcDeleteQueuedRun(rawParams: unknown) {
  const runId = parseRunId(asObject(rawParams))
  const found = await ddb.send(new GetCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId },
  }))
  const item = found.Item as Record<string, any> | undefined
  if (!item) {
    throw new JsonRpcError(-32004, 'run not found', { runId })
  }
  if (item.status !== 'QUEUED') {
    throw new JsonRpcError(-32011, 'only queued runs can be deleted', { runId, status: item.status })
  }
  if (item.runner !== 'cpu' && item.runner !== 'gpu') {
    throw new JsonRpcError(-32012, 'queued run has invalid runner', { runId, runner: item.runner })
  }

  await ddb.send(new DeleteCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId },
    ConditionExpression: '#status = :queued',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':queued': 'QUEUED' },
  }))

  await dispatchNextQueuedRun(item.runner)
  return { ok: true, runId, runner: item.runner }
}
