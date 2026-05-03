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
  reconcileWorkflowTerminal,
  ssm,
  reasonFromSsm,
  extractLatestProgress,
  extractLatestProgressFromLogs,
  completeRunIfPerformanceAvailable,
} from './shared'

export async function rpcRunStatus(rawParams: unknown) {
  const runId = parseRunId(asObject(rawParams))
  const found = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  let item = found.Item as Record<string, any> | undefined
  if (!item) {
    throw new JsonRpcError(-32004, 'run not found', { runId })
  }

  if (TERMINAL_STATUSES.has(item.status)) {
    if (item.status !== 'COMPLETED' && item.reason === 'INSTANCE_STOPPING_WHILE_SSM_RUNNING') {
      const completedFromPerformance = await completeRunIfPerformanceAvailable(item, {
        ssmStatus: item.ssmStatus,
        responseCode: item.responseCode,
        progress: item.progress,
      })
      if (completedFromPerformance) {
        return publicRunView(completedFromPerformance)
      }
    }
    await releaseRunnerLock(item.runner, runId, { cancelInFlight: false })
    item = await attachPerformance(item)
    return publicRunView(item)
  }

  const workflowTerminal = await reconcileWorkflowTerminal(item)
  if (workflowTerminal) {
    item = workflowTerminal
    if (TERMINAL_STATUSES.has(item.status)) {
      item = await attachPerformance(item)
    }
    return publicRunView(item)
  }

  const commandId = item.commandId as string | undefined
  const instanceId = item.instanceId as string | undefined
  if (!commandId || !instanceId) {
    if (item.status === 'STARTING' && createdTooOld(item.createdAt)) {
      await ddb.send(new UpdateCommand({
        TableName: RUNS_TABLE_NAME,
        Key: { runId },
        UpdateExpression: 'SET #status = :status, #error = :error, reason = :reason, updatedAt = :updatedAt, completedAt = :completedAt',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':error': `Run stuck in STARTING without command for > ${STARTING_STALE_SECONDS}s`,
          ':reason': 'STARTING_STALE_NO_COMMAND',
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
    const latestProgress = extractLatestProgress(inv.StandardOutputContent) ?? await extractLatestProgressFromLogs(commandId, instanceId)
    if (mapped === 'RUNNING') {
      const state = await getState(instanceId)
      if (['stopped', 'stopping', 'shutting-down', 'terminated'].includes(state)) {
        // SSM status can lag briefly while the runner script is finishing and stopping the instance.
        // Re-check once before declaring a hard failure.
        const invRetry = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }))
        const mappedRetry = mapSsmStatus(invRetry.Status ?? 'Unknown')
        if (mappedRetry === 'COMPLETED' || mappedRetry === 'FAILED' || mappedRetry === 'CANCELLED') {
          const retryValues: Record<string, any> = {
            ':status': mappedRetry,
            ':reason': reasonFromSsm(mappedRetry, invRetry.Status ?? 'Unknown', invRetry.ResponseCode ?? -1),
            ':ssmStatus': invRetry.Status ?? 'Unknown',
            ':updatedAt': nowIso(),
            ':responseCode': invRetry.ResponseCode ?? -1,
            ':completedAt': nowIso(),
          }
          let retryUpdateExpression = 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt'
          const retryProgress = extractLatestProgress(invRetry.StandardOutputContent)
          if (retryProgress) {
            retryUpdateExpression += ', progress = :progress'
            retryValues[':progress'] = retryProgress
          }
          await ddb.send(new UpdateCommand({
            TableName: RUNS_TABLE_NAME,
            Key: { runId },
            UpdateExpression: retryUpdateExpression,
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: retryValues,
          }))
          await stopInstance(instanceId)
          await releaseRunnerLock(item.runner, runId)
          await emitTerminalMetrics(item, mappedRetry)
          const refreshed = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
          item = (refreshed.Item as Record<string, any>) ?? item
          return publicRunView(item)
        }

        const completedFromPerformance = await completeRunIfPerformanceAvailable(item, {
          ssmStatus: invRetry.Status ?? inv.Status ?? 'Unknown',
          responseCode: invRetry.ResponseCode ?? inv.ResponseCode ?? -1,
          progress: latestProgress,
        })
        if (completedFromPerformance) {
          return publicRunView(completedFromPerformance)
        }

        // While instance is still stopping/shutting down, keep RUNNING and let next poll settle terminal state.
        if (state === 'stopping' || state === 'shutting-down') {
          return publicRunView(item)
        }

        await ddb.send(new UpdateCommand({
          TableName: RUNS_TABLE_NAME,
          Key: { runId },
          UpdateExpression: 'SET #status = :status, #error = :error, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt',
          ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
          ExpressionAttributeValues: {
            ':status': 'FAILED',
            ':error': `Instance state is ${state} while SSM status is ${inv.Status ?? 'Unknown'}`,
            ':reason': 'INSTANCE_STOPPING_WHILE_SSM_RUNNING',
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
      ':reason': reasonFromSsm(mapped, inv.Status ?? 'Unknown', inv.ResponseCode ?? -1),
      ':ssmStatus': inv.Status ?? 'Unknown',
      ':updatedAt': nowIso(),
      ':responseCode': inv.ResponseCode ?? -1,
    }
    let updateExpression = 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode'
    if (latestProgress) {
      updateExpression += ', progress = :progress'
      values[':progress'] = latestProgress
    }
    if (TERMINAL_STATUSES.has(mapped)) {
      updateExpression += ', completedAt = :completedAt'
      values[':completedAt'] = nowIso()
      await stopInstance(instanceId)
      await releaseRunnerLock(item.runner, runId, { cancelInFlight: false })
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
