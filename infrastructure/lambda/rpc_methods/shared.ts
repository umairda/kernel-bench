import { GetObjectCommand } from '@aws-sdk/client-s3'
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2'
import { CancelCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm'
import { DescribeExecutionCommand, StopExecutionCommand } from '@aws-sdk/client-sfn'
import { GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { cloudwatchLogs, ddb, ec2, putMetric, s3, sfn, ssm } from '../aws'
import { benchmarkChoices, isBenchmark, normalizeBenchmarkParams, type Benchmark } from '../benchmark_registry'
import { JsonRpcError, TERMINAL_STATUSES, mapSsmStatus, normalizePerformance, nowIso, publicRunView, reasonFromSsm } from '../common'
import { queryHistory, writeHistoryRecord } from '../history'
import { dispatchNextOrStopRunner } from '../run_queue'

export type Runner = 'cpu' | 'gpu'
export type HistoryRunnerParam = Runner | 'all' | undefined
export type { Benchmark } from '../benchmark_registry'
export { benchmarkChoices, isBenchmark }

export const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
export const ARTIFACT_BUCKET_NAME = process.env.ARTIFACT_BUCKET_NAME!
export const CPU_INSTANCE_ID = process.env.CPU_INSTANCE_ID!
export const GPU_INSTANCE_ID = process.env.GPU_INSTANCE_ID!
export const CPU_INSTANCE_TYPE = process.env.CPU_INSTANCE_TYPE ?? 'c7i.8xlarge'
export const GPU_INSTANCE_TYPE = process.env.GPU_INSTANCE_TYPE ?? 'g6e.xlarge'
export const LOCK_TTL_SECONDS = Number(process.env.RUNNER_LOCK_TTL_SECONDS ?? '7200')
export const STARTING_STALE_SECONDS = Number(process.env.STARTING_STALE_SECONDS ?? '180')
const RUN_WORKFLOW_STATE_MACHINE_ARN = process.env.RUN_WORKFLOW_STATE_MACHINE_ARN ?? ''
const PROGRESS_PREFIX = 'KERNEL_BENCH_PROGRESS '
const SSM_OUTPUT_LOG_GROUP = process.env.SSM_OUTPUT_LOG_GROUP ?? '/kernelbench/ssm-output'

export function runnerInstanceType(runner: Runner): string {
  return runner === 'cpu' ? CPU_INSTANCE_TYPE : GPU_INSTANCE_TYPE
}

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
  return normalizeBenchmarkParams(benchmark, params, toInt)
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

export async function releaseRunnerLock(
  runner: string | undefined,
  runId: string,
  options: { cancelInFlight?: boolean } = {},
) {
  if (options.cancelInFlight ?? true) {
    await cancelInFlightWorkForRun(runId)
  }
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

function executionArnForRun(runId: string): string | undefined {
  if (!RUN_WORKFLOW_STATE_MACHINE_ARN) return undefined
  const m = RUN_WORKFLOW_STATE_MACHINE_ARN.match(/^arn:aws:states:([^:]+):([^:]+):stateMachine:(.+)$/)
  if (!m) return undefined
  const [, region, account, machineName] = m
  return `arn:aws:states:${region}:${account}:execution:${machineName}:${runId}`
}

async function cancelInFlightWorkForRun(runId: string) {
  const found = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  const item = found.Item as Record<string, any> | undefined
  if (!item) return

  const commandId = typeof item.commandId === 'string' ? item.commandId : undefined
  const instanceId = typeof item.instanceId === 'string' ? item.instanceId : undefined
  if (commandId && instanceId) {
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: instanceId }))
      const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
      if (!TERMINAL_STATUSES.has(mapped)) {
        await ssm.send(new CancelCommandCommand({ CommandId: commandId, InstanceIds: [instanceId] }))
      }
    } catch {}
  }

  const executionArn = executionArnForRun(runId)
  if (!executionArn) return
  try {
    const exec = await sfn.send(new DescribeExecutionCommand({ executionArn }))
    if (exec.status && !['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'].includes(exec.status)) {
      await sfn.send(new StopExecutionCommand({ executionArn, cause: `Runner lock released for run ${runId}` }))
    }
  } catch {}
}

async function getWorkflowExecutionStatus(runId: string): Promise<string | undefined> {
  const executionArn = executionArnForRun(runId)
  if (!executionArn) return undefined
  try {
    const exec = await sfn.send(new DescribeExecutionCommand({ executionArn }))
    return exec.status
  } catch {
    return undefined
  }
}

export async function reconcileWorkflowTerminal(item: Record<string, any>): Promise<Record<string, any> | undefined> {
  const status = await getWorkflowExecutionStatus(String(item.runId))
  if (!status) return undefined

  let mapped: 'FAILED' | 'CANCELLED' | undefined
  let reason: string | undefined
  if (status === 'TIMED_OUT') {
    mapped = 'FAILED'
    reason = 'Workflow execution timed out'
  } else if (status === 'FAILED') {
    mapped = 'FAILED'
    reason = 'Workflow execution failed'
  } else if (status === 'ABORTED') {
    mapped = 'CANCELLED'
    reason = 'Workflow execution was aborted'
  }

  if (!mapped) return undefined

  let latestProgress: Record<string, any> | undefined
  let latestSsmStatus: string | undefined
  let latestResponseCode: number | undefined
  if (item.commandId && item.instanceId) {
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: item.commandId, InstanceId: item.instanceId }))
      latestProgress = extractLatestProgress(inv.StandardOutputContent) ?? await extractLatestProgressFromLogs(item.commandId, item.instanceId)
      latestSsmStatus = inv.Status ?? 'Unknown'
      latestResponseCode = inv.ResponseCode ?? -1
    } catch {}
  }

  const now = nowIso()
  let updateExpression = 'SET #status = :status, #error = :error, reason = :reason, updatedAt = :updatedAt, completedAt = :completedAt'
  const expressionAttributeValues: Record<string, any> = {
    ':status': mapped,
    ':error': reason,
    ':reason': status === 'TIMED_OUT' ? 'WORKFLOW_TIMED_OUT' : status === 'ABORTED' ? 'WORKFLOW_ABORTED' : 'WORKFLOW_FAILED',
    ':updatedAt': now,
    ':completedAt': now,
  }
  if (latestProgress) {
    updateExpression += ', progress = :progress'
    expressionAttributeValues[':progress'] = latestProgress
  }
  if (latestSsmStatus !== undefined) {
    updateExpression += ', ssmStatus = :ssmStatus'
    expressionAttributeValues[':ssmStatus'] = latestSsmStatus
  }
  if (latestResponseCode !== undefined) {
    updateExpression += ', responseCode = :responseCode'
    expressionAttributeValues[':responseCode'] = latestResponseCode
  }
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: item.runId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: expressionAttributeValues,
  }))
  await releaseRunnerLock(item.runner, item.runId)
  await dispatchNextOrStopRunner(item.runner, item.instanceId)
  await emitTerminalMetrics(item, mapped)
  const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
  return (latest.Item as Record<string, any>) ?? item
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
      instanceType: item.instanceType,
      params: item.params ?? {},
      createdAt: item.createdAt,
      completedAt: item.completedAt,
      performance: normalizePerformance(item.performance),
    })
  }
  return item
}

export async function completeRunIfPerformanceAvailable(
  item: Record<string, any>,
  options: { ssmStatus?: string; responseCode?: number; progress?: Record<string, any> } = {},
): Promise<Record<string, any> | undefined> {
  const withPerformance = await attachPerformance(item)
  if (!withPerformance.performance) return undefined

  const now = nowIso()
  const values: Record<string, any> = {
    ':status': 'COMPLETED',
    ':reason': 'COMPLETED_WITH_UPLOADED_PERFORMANCE',
    ':ssmStatus': options.ssmStatus ?? withPerformance.ssmStatus ?? 'Unknown',
    ':updatedAt': now,
    ':responseCode': options.responseCode ?? withPerformance.responseCode ?? -1,
    ':completedAt': now,
  }
  let updateExpression = 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt'
  if (options.progress) {
    updateExpression += ', progress = :progress'
    values[':progress'] = options.progress
  }
  updateExpression += ' REMOVE #error'

  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: withPerformance.runId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: values,
  }))
  await releaseRunnerLock(withPerformance.runner, withPerformance.runId, { cancelInFlight: false })
  await dispatchNextOrStopRunner(withPerformance.runner, withPerformance.instanceId)
  await emitTerminalMetrics(withPerformance, 'COMPLETED')

  const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: withPerformance.runId } }))
  return attachPerformance((latest.Item as Record<string, any>) ?? withPerformance)
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function parseProgressLine(line: string): Record<string, any> | undefined {
  if (!line.startsWith(PROGRESS_PREFIX)) return undefined
  const body = line.slice(PROGRESS_PREFIX.length)
  const pairs = [...body.matchAll(/([a-zA-Z_]+)=("[^"]*"|\S+)/g)]
  if (pairs.length === 0) return undefined

  const fields: Record<string, string> = {}
  for (const m of pairs) {
    const key = m[1]
    let value = m[2]
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }

  return Object.fromEntries(Object.entries({
    op: fields.op,
    backend: fields.backend,
    status: fields.status,
    phase: fields.phase,
    detail: fields.detail,
    rowsDone: parseNumber(fields.rows_done),
    totalRows: parseNumber(fields.total_rows),
    elementsDone: parseNumber(fields.elements_done),
    totalElements: parseNumber(fields.total_elements),
    percent: parseNumber(fields.percent),
    elapsedMs: parseNumber(fields.elapsed_ms),
    elapsedS: parseNumber(fields.elapsed_s),
    etaS: parseNumber(fields.eta_s),
    heartbeat: parseNumber(fields.heartbeat),
    detailed: parseNumber(fields.detailed),
    observedAt: nowIso(),
  }).filter(([, value]) => value !== undefined))
}

export function extractLatestProgress(standardOutputContent?: string): Record<string, any> | undefined {
  if (!standardOutputContent) return undefined
  const lines = standardOutputContent.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    const parsed = parseProgressLine(line)
    if (parsed) return parsed
  }
  return undefined
}

export async function extractLatestProgressFromLogs(commandId?: string, instanceId?: string): Promise<Record<string, any> | undefined> {
  if (!commandId || !instanceId) return undefined
  const streamNames = [
    `${commandId}/${instanceId}/aws-runShellScript/stdout`,
    `${commandId}/${instanceId}/aws-runShellScript/stderr`,
  ]

  for (const logStreamName of streamNames) {
    try {
      const resp = await cloudwatchLogs.send(new GetLogEventsCommand({
        logGroupName: SSM_OUTPUT_LOG_GROUP,
        logStreamName,
        startFromHead: false,
        limit: 50,
      }))
      const events = [...(resp.events ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      for (const event of events) {
        const lines = String(event.message ?? '').split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          const parsed = parseProgressLine(lines[i]?.trim() ?? '')
          if (parsed) return parsed
        }
      }
    } catch {}
  }
  return undefined
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

  const workflowTerminal = await reconcileWorkflowTerminal(item)
  if (workflowTerminal) return workflowTerminal

  if (item.status === 'STARTING' && !item.commandId && createdTooOld(item.createdAt)) {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
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
    await releaseRunnerLock(item.runner, item.runId)
    const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
    return (latest.Item as Record<string, any>) ?? item
  }

  if (!item.commandId || !item.instanceId) return item

  try {
    const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: item.commandId, InstanceId: item.instanceId }))
    const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
    const latestProgress = extractLatestProgress(inv.StandardOutputContent) ?? await extractLatestProgressFromLogs(item.commandId, item.instanceId)
    if (latestProgress) {
      item = { ...item, progress: latestProgress }
    }
    if (mapped === 'RUNNING') {
      const state = await getState(item.instanceId)
      if (!['stopped', 'stopping', 'shutting-down', 'terminated'].includes(state)) {
        return item
      }

      // SSM status can lag briefly while the runner script is finishing and stopping the instance.
      // Re-check once before converting to FAILED.
      const invRetry = await ssm.send(new GetCommandInvocationCommand({ CommandId: item.commandId, InstanceId: item.instanceId }))
      const mappedRetry = mapSsmStatus(invRetry.Status ?? 'Unknown')
      if (mappedRetry === 'COMPLETED' || mappedRetry === 'FAILED' || mappedRetry === 'CANCELLED') {
        const retryProgress = extractLatestProgress(invRetry.StandardOutputContent)
        const values: Record<string, any> = {
          ':status': mappedRetry,
          ':reason': reasonFromSsm(mappedRetry, invRetry.Status ?? 'Unknown', invRetry.ResponseCode ?? -1),
          ':ssmStatus': invRetry.Status ?? 'Unknown',
          ':updatedAt': nowIso(),
          ':responseCode': invRetry.ResponseCode ?? -1,
          ':completedAt': nowIso(),
        }
        let updateExpression = 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt'
        if (retryProgress) {
          updateExpression += ', progress = :progress'
          values[':progress'] = retryProgress
        }
        await ddb.send(new UpdateCommand({
          TableName: RUNS_TABLE_NAME,
          Key: { runId: item.runId },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: values,
        }))
        await releaseRunnerLock(item.runner, item.runId)
        await dispatchNextOrStopRunner(item.runner, item.instanceId)
        await emitTerminalMetrics(item, mappedRetry)
        const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
        return (latest.Item as Record<string, any>) ?? item
      }

      const completedFromPerformance = await completeRunIfPerformanceAvailable(item, {
        ssmStatus: invRetry.Status ?? inv.Status ?? 'Unknown',
        responseCode: invRetry.ResponseCode ?? inv.ResponseCode ?? -1,
        progress: latestProgress,
      })
      if (completedFromPerformance) {
        return completedFromPerformance
      }

      if (state === 'stopping' || state === 'shutting-down') {
        return item
      }

      await ddb.send(new UpdateCommand({
        TableName: RUNS_TABLE_NAME,
        Key: { runId: item.runId },
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
      await releaseRunnerLock(item.runner, item.runId)
      await emitTerminalMetrics(item, 'FAILED')
      const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId: item.runId } }))
      return (latest.Item as Record<string, any>) ?? item
    }

    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
      UpdateExpression: 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': mapped,
        ':reason': reasonFromSsm(mapped, inv.Status ?? 'Unknown', inv.ResponseCode ?? -1),
        ':ssmStatus': inv.Status ?? 'Unknown',
        ':updatedAt': nowIso(),
        ':responseCode': inv.ResponseCode ?? -1,
        ':completedAt': nowIso(),
      },
    }))
    await releaseRunnerLock(item.runner, item.runId, { cancelInFlight: false })
    await dispatchNextOrStopRunner(item.runner, item.instanceId)
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

export { ddb, ec2, ssm, mapSsmStatus, nowIso, publicRunView, queryHistory, JsonRpcError, putMetric, TERMINAL_STATUSES, reasonFromSsm, dispatchNextOrStopRunner }
