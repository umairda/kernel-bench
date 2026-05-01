import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import {
  RUNS_TABLE_NAME,
  JsonRpcError,
  TERMINAL_STATUSES,
  parseRunId,
  asObject,
  ddb,
  releaseRunnerLock,
  attachPerformance,
  publicRunView,
  createdTooOld,
  STARTING_STALE_SECONDS,
  mapSsmStatus,
  nowIso,
  stopInstance,
  emitTerminalMetrics,
  getState,
  ssm,
} from './shared'

export async function rpcRunStatus(rawParams: unknown) {
  const runId = parseRunId(asObject(rawParams))
  const found = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  let item = found.Item as Record<string, any> | undefined
  if (!item) {
    throw new JsonRpcError(-32004, 'run not found', { runId })
  }

  if (TERMINAL_STATUSES.has(item.status)) {
    await releaseRunnerLock(item.runner, runId)
    item = await attachPerformance(item)
    return publicRunView(item)
  }

  const commandId = item.commandId as string | undefined
  const instanceId = item.instanceId as string | undefined
  if (!commandId || !instanceId) {
    if (item.status === 'STARTING' && createdTooOld(item.createdAt)) {
      await ddb.send(new UpdateCommand({
        TableName: RUNS_TABLE_NAME,
        Key: { runId },
        UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt, completedAt = :completedAt',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':error': `Run stuck in STARTING without command for > ${STARTING_STALE_SECONDS}s`,
          ':updatedAt': nowIso(),
          ':completedAt': nowIso(),
        },
      }))
      await releaseRunnerLock(item.runner, runId)
      const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
      return publicRunView((refreshed.Item as Record<string, any>) ?? item)
    }
    return publicRunView(item)
  }

  try {
    const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }))
    const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
    if (mapped === 'RUNNING') {
      const state = await getState(instanceId)
      if (['stopped', 'stopping', 'shutting-down', 'terminated'].includes(state)) {
        await ddb.send(new UpdateCommand({
          TableName: RUNS_TABLE_NAME,
          Key: { runId },
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
        await releaseRunnerLock(item.runner, runId)
        await emitTerminalMetrics(item, 'FAILED')
        const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
        item = (refreshed.Item as Record<string, any>) ?? item
        return publicRunView(item)
      }
    }
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
  } catch (error: any) {
    if (String(error?.name ?? '').includes('InvocationDoesNotExist')) {
      return publicRunView(item)
    }
    throw new JsonRpcError(-32000, String(error?.message ?? error))
  }

  const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  item = (refreshed.Item as Record<string, any>) ?? item
  if (TERMINAL_STATUSES.has(item.status)) {
    item = await attachPerformance(item)
  }
  return publicRunView(item)
}
