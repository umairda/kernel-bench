import type { Context } from 'aws-lambda'
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DescribeInstanceStatusCommand, DescribeInstancesCommand, StartInstancesCommand } from '@aws-sdk/client-ec2'
import { GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { DescribeInstanceInformationCommand, GetCommandInvocationCommand, SendCommandCommand } from '@aws-sdk/client-ssm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { cloudwatchLogs, ddb, ec2, putMetric, s3, ssm } from '../aws'
import { estimateBenchmarkTimeoutSeconds, type Benchmark } from '../benchmark_registry'
import { mapSsmStatus, normalizePerformance, nowIso, reasonFromSsm, TERMINAL_STATUSES } from '../common'
import { writeHistoryRecord } from '../history'
import { dispatchNextOrStopRunner } from '../run_queue'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const ARTIFACT_BUCKET_NAME = process.env.ARTIFACT_BUCKET_NAME!
const SOURCE_ARCHIVE_KEY = process.env.SOURCE_ARCHIVE_KEY!
const BASE_COMMAND_TIMEOUT_SECONDS = Number(process.env.BASE_COMMAND_TIMEOUT_SECONDS ?? String(90 * 60))
const MAX_COMMAND_TIMEOUT_SECONDS = Number(process.env.MAX_COMMAND_TIMEOUT_SECONDS ?? String(6 * 60 * 60))
const SSM_OUTPUT_LOG_GROUP = process.env.SSM_OUTPUT_LOG_GROUP ?? '/kernelbench/ssm-output'

type WorkflowInput = {
  action: 'START_AND_WAIT' | 'DISPATCH' | 'POLL' | 'FINALIZE' | 'FAIL'
  runId: string
  runner: 'cpu' | 'gpu'
  instanceType?: string
  benchmark: Benchmark
  params: Record<string, number>
  instanceId: string
  s3Prefix: string
  createdAt: string
  dispatchStartedAt?: string
  commandId?: string
  launchTiming?: Record<string, number>
  startup?: { isReady: boolean; phase?: string }
  poll?: { isTerminal: boolean; mappedStatus?: string; ssmStatus?: string; responseCode?: number }
  errorMessage?: string
}

const PROGRESS_PREFIX = 'KERNEL_BENCH_PROGRESS '

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function parseProgressLine(line: string): Record<string, any> | undefined {
  if (!line.startsWith(PROGRESS_PREFIX)) return undefined
  const body = line.slice(PROGRESS_PREFIX.length)
  const pairs = [...body.matchAll(/([a-zA-Z_]+)=("[^"]*"|\S+)/g)]
  if (pairs.length === 0) return undefined

  const fields: Record<string, string> = {}
  for (const m of pairs) {
    const key = m[1]
    let value = m[2]
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
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

function extractLatestProgress(standardOutputContent?: string): Record<string, any> | undefined {
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

async function extractLatestProgressFromLogs(commandId?: string, instanceId?: string): Promise<Record<string, any> | undefined> {
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

function computeCommandTimeoutSeconds(input: WorkflowInput): number {
  return estimateBenchmarkTimeoutSeconds(
    input.benchmark,
    input.params,
    BASE_COMMAND_TIMEOUT_SECONDS,
    MAX_COMMAND_TIMEOUT_SECONDS,
  )
}

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

async function currentState(instanceId: string): Promise<string | undefined> {
  const d = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
  return d.Reservations?.[0]?.Instances?.[0]?.State?.Name
}

async function getInstanceHealth(instanceId: string): Promise<{ instanceStatus?: string; systemStatus?: string }> {
  const resp = await ec2.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId], IncludeAllInstances: true }))
  const st = resp.InstanceStatuses?.[0]
  return { instanceStatus: st?.InstanceStatus?.Status, systemStatus: st?.SystemStatus?.Status }
}

function elapsedMsSince(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, Date.now() - t)
}

function elapsedMsBetween(startIso: string | undefined, endIso: string | undefined): number | undefined {
  if (!startIso || !endIso) return undefined
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  return Math.max(0, end - start)
}

function startupNotReady(input: WorkflowInput, phase: string) {
  return { ...input, status: 'STARTING', startup: { isReady: false, phase } }
}

async function writeStartupProgress(runId: string, progress: Record<string, string>) {
  const observedAt = progress.observedAt ?? nowIso()
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId },
    UpdateExpression: 'SET startupProgress.#phase = :phase, startupProgress.ec2State = :ec2State, startupProgress.instanceStatus = :instanceStatus, startupProgress.systemStatus = :systemStatus, startupProgress.ssmPingStatus = :ssmPingStatus, startupProgress.detail = :detail, startupProgress.observedAt = :observedAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#phase': 'phase' },
    ExpressionAttributeValues: {
      ':phase': progress.phase ?? 'UNKNOWN',
      ':ec2State': progress.ec2State ?? 'unknown',
      ':instanceStatus': progress.instanceStatus ?? 'unknown',
      ':systemStatus': progress.systemStatus ?? 'unknown',
      ':ssmPingStatus': progress.ssmPingStatus ?? 'unknown',
      ':detail': progress.detail ?? '',
      ':observedAt': observedAt,
      ':updatedAt': observedAt,
    },
  }))
}

async function startAndWait(input: WorkflowInput) {
  let state = await currentState(input.instanceId)

  if (state === 'pending') {
    await writeStartupProgress(input.runId, { phase: 'WAITING_FOR_INSTANCE_RUNNING', ec2State: 'pending', detail: 'Instance is pending' })
    return startupNotReady(input, 'WAITING_FOR_INSTANCE_RUNNING')
  } else if (state === 'stopping') {
    await writeStartupProgress(input.runId, { phase: 'WAITING_FOR_INSTANCE_STOPPED', ec2State: 'stopping', detail: 'Waiting for stop before start' })
    return startupNotReady(input, 'WAITING_FOR_INSTANCE_STOPPED')
  } else if (state === 'shutting-down' || state === 'terminated') {
    throw new Error(`Instance ${input.instanceId} cannot be started from state ${state}`)
  } else if (state === 'stopped') {
    await writeStartupProgress(input.runId, { phase: 'STARTING_INSTANCE', ec2State: 'stopped', detail: 'Sending StartInstances command' })
    await ec2.send(new StartInstancesCommand({ InstanceIds: [input.instanceId] }))
    return startupNotReady(input, 'STARTING_INSTANCE')
  } else if (state !== 'running') {
    await writeStartupProgress(input.runId, { phase: 'STARTING_INSTANCE', ec2State: state ?? 'unknown', detail: 'Sending StartInstances command' })
    await ec2.send(new StartInstancesCommand({ InstanceIds: [input.instanceId] }))
    return startupNotReady(input, 'STARTING_INSTANCE')
  }

  const health = await getInstanceHealth(input.instanceId)
  const r = await ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [input.instanceId] }], MaxResults: 5 }))
  const ping = r.InstanceInformationList?.[0]?.PingStatus ?? 'Offline'
  await writeStartupProgress(input.runId, {
    phase: ping === 'Online' ? 'RUNNER_READY' : 'WAITING_FOR_SSM_ONLINE',
    ec2State: state,
    instanceStatus: health.instanceStatus ?? 'unknown',
    systemStatus: health.systemStatus ?? 'unknown',
    ssmPingStatus: ping,
    detail: ping === 'Online' ? 'Runner instance is ready for SSM command dispatch' : 'Waiting for SSM agent to become online',
  })
  if (ping !== 'Online') {
    return startupNotReady(input, 'WAITING_FOR_SSM_ONLINE')
  }

  const startupMs = elapsedMsSince(input.dispatchStartedAt ?? input.createdAt)
  const queuedMs = elapsedMsBetween(input.createdAt, input.dispatchStartedAt)
  return {
    ...input,
    status: 'STARTING',
    startup: { isReady: true, phase: 'RUNNER_READY' },
    launchTiming: {
      ...(input.launchTiming ?? {}),
      ...(queuedMs === undefined ? {} : { queueStartRequestMs: queuedMs }),
      ...(startupMs === undefined ? {} : { instanceBootSsmReadyMs: startupMs }),
    },
  }
}

async function dispatch(input: WorkflowInput) {
  const timeoutSeconds = computeCommandTimeoutSeconds(input)
  const paramsB64 = Buffer.from(JSON.stringify(input.params)).toString('base64')
  const launchTimingB64 = Buffer.from(JSON.stringify({
    ...(input.launchTiming ?? {}),
    requestReceivedAt: input.createdAt,
    commandDispatchAt: nowIso(),
  })).toString('base64')

  const commands = [
    'set -eu',
    'echo STEP_01_MKDIR_RUN',
    `mkdir -p /opt/kernel-bench/runs/${input.runId}`,
    'echo STEP_02_CD_RUN',
    `cd /opt/kernel-bench/runs/${input.runId}`,
    'echo STEP_03_DOWNLOAD_SOURCE',
    `aws s3 cp s3://${ARTIFACT_BUCKET_NAME}/${SOURCE_ARCHIVE_KEY} source.tar.gz`,
    'echo STEP_04_MKDIR_WORKSPACE',
    'mkdir -p workspace',
    'echo STEP_05_TAR_EXTRACT',
    'tar --warning=no-unknown-keyword -xzf source.tar.gz -C workspace',
    'echo STEP_06_CD_WORKSPACE',
    'cd workspace',
    'echo STEP_07_VERIFY_SCRIPT',
    'test -f ./infrastructure/scripts/remote_kernel_benchmark.sh',
    'echo STEP_08_CHMOD_SCRIPT',
    'chmod +x ./infrastructure/scripts/remote_kernel_benchmark.sh',
    'echo STEP_09_RUN_BENCHMARK_SCRIPT',
    `bash ./infrastructure/scripts/remote_kernel_benchmark.sh '${input.runner}' '${input.benchmark}' '${paramsB64}' '${input.runId}' '${ARTIFACT_BUCKET_NAME}' '${input.s3Prefix}' '${launchTimingB64}'`,
  ]

  const send = await ssm.send(new SendCommandCommand({
    InstanceIds: [input.instanceId],
    DocumentName: 'AWS-RunShellScript',
    Comment: `KernelBench benchmark run ${input.runId}`,
    TimeoutSeconds: timeoutSeconds,
    CloudWatchOutputConfig: {
      CloudWatchLogGroupName: SSM_OUTPUT_LOG_GROUP,
      CloudWatchOutputEnabled: true,
    },
    Parameters: {
      commands,
      executionTimeout: [String(timeoutSeconds)],
    },
  }))
  const commandId = send.Command?.CommandId
  if (!commandId) throw new Error('missing command id from SSM')

  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: 'SET #status = :status, commandId = :commandId, ssmTimeoutSeconds = :ssmTimeoutSeconds, startupProgress.#phase = :phase, startupProgress.detail = :detail, startupProgress.observedAt = :observedAt, updatedAt = :updatedAt REMOVE #error, #reason',
    ExpressionAttributeNames: { '#status': 'status', '#phase': 'phase', '#error': 'error', '#reason': 'reason' },
    ExpressionAttributeValues: {
      ':status': 'RUNNING',
      ':commandId': commandId,
      ':ssmTimeoutSeconds': timeoutSeconds,
      ':phase': 'COMMAND_DISPATCHED',
      ':detail': 'SSM command dispatched to runner instance',
      ':observedAt': nowIso(),
      ':updatedAt': nowIso(),
    },
  }))
  return { ...input, commandId }
}

async function poll(input: WorkflowInput) {
  if (!input.commandId) throw new Error('missing commandId for poll')
  const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: input.commandId, InstanceId: input.instanceId }))
  const mapped = mapSsmStatus(inv.Status ?? 'Unknown')
  const responseCode = inv.ResponseCode ?? -1
  const isTerminal = TERMINAL_STATUSES.has(mapped)
  const latestProgress = extractLatestProgress(inv.StandardOutputContent) ?? await extractLatestProgressFromLogs(input.commandId, input.instanceId)
  if (!isTerminal) {
    const now = nowIso()
    let updateExpression = 'SET ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode'
    const expressionAttributeValues: Record<string, any> = {
      ':ssmStatus': inv.Status ?? 'Unknown',
      ':updatedAt': now,
      ':responseCode': responseCode,
    }
    if (latestProgress) {
      updateExpression += ', progress = :progress'
      expressionAttributeValues[':progress'] = latestProgress
    }
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: input.runId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    }))
  }
  return { ...input, poll: { isTerminal, mappedStatus: mapped, ssmStatus: inv.Status ?? 'Unknown', responseCode } }
}

async function attachPerformance(runId: string, s3Prefix: string): Promise<Record<string, any> | undefined> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET_NAME, Key: `${s3Prefix}performance.json` }))
    const txt = await obj.Body?.transformToString()
    if (!txt) return undefined
    const perf = JSON.parse(txt)
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId },
      UpdateExpression: 'SET performance = :performance',
      ExpressionAttributeValues: { ':performance': perf },
    }))
    return perf
  } catch {
    return undefined
  }
}

function buildFallbackPerformance(input: WorkflowInput, completedAt: string): Record<string, any> | undefined {
  const createdMs = new Date(input.createdAt).getTime()
  const completedMs = new Date(completedAt).getTime()
  if (!Number.isFinite(createdMs) || !Number.isFinite(completedMs)) return undefined

  const phaseDurationsMs = Object.fromEntries(Object.entries({
    queueStartRequestMs: input.launchTiming?.queueStartRequestMs,
    instanceBootSsmReadyMs: input.launchTiming?.instanceBootSsmReadyMs,
  }).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)))

  return {
    totalDurationMs: Math.max(0, completedMs - createdMs),
    phaseDurationsMs,
    operationDurations: [],
  }
}

async function storeFallbackPerformance(input: WorkflowInput, completedAt: string): Promise<Record<string, any> | undefined> {
  const fallback = buildFallbackPerformance(input, completedAt)
  if (!fallback) return undefined
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: 'SET performance = :performance',
    ExpressionAttributeValues: { ':performance': fallback },
  }))
  return fallback
}

async function finalize(input: WorkflowInput) {
  const mapped = input.poll?.mappedStatus ?? 'FAILED'
  const ssmStatus = input.poll?.ssmStatus ?? 'Unknown'
  const responseCode = input.poll?.responseCode ?? -1
  const now = nowIso()
  let terminalProgress: Record<string, any> | undefined
  if (input.commandId) {
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: input.commandId, InstanceId: input.instanceId }))
      terminalProgress = extractLatestProgress(inv.StandardOutputContent) ?? await extractLatestProgressFromLogs(input.commandId, input.instanceId)
    } catch {}
  }
  const values: Record<string, any> = {
    ':status': mapped,
    ':reason': reasonFromSsm(mapped, ssmStatus, responseCode),
    ':ssmStatus': ssmStatus,
    ':responseCode': responseCode,
    ':completedAt': now,
    ':updatedAt': now,
  }
  let updateExpression = 'SET #status = :status, reason = :reason, ssmStatus = :ssmStatus, responseCode = :responseCode, completedAt = :completedAt, updatedAt = :updatedAt'
  if (terminalProgress) {
    updateExpression += ', progress = :progress'
    values[':progress'] = terminalProgress
  }
  updateExpression += ' REMOVE #error'
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: values,
  }))
  const performance = await attachPerformance(input.runId, input.s3Prefix)
  if (!performance) {
    await storeFallbackPerformance(input, now)
  }
  if (mapped === 'COMPLETED' && performance) {
    await writeHistoryRecord({
      runId: input.runId,
      benchmark: input.benchmark,
      runner: input.runner,
      instanceType: input.instanceType,
      params: input.params,
      createdAt: input.createdAt,
      completedAt: now,
      performance: normalizePerformance(performance),
    })
  }
  await releaseRunnerLock(input.runner, input.runId)
  await dispatchNextOrStopRunner(input.runner, input.instanceId)
  if (mapped === 'COMPLETED') await putMetric('RunCompleted', 1, input.runner, input.benchmark)
  if (mapped === 'FAILED') await putMetric('RunFailed', 1, input.runner, input.benchmark)
  if (mapped === 'CANCELLED') await putMetric('RunCancelled', 1, input.runner, input.benchmark)
  return { ...input, status: mapped }
}

async function fail(input: WorkflowInput, err: string) {
  const now = nowIso()
  const fallbackPerformance = buildFallbackPerformance(input, now)
  const values: Record<string, any> = {
    ':status': 'FAILED',
    ':error': err,
    ':reason': 'WORKFLOW_STEP_EXCEPTION',
    ':completedAt': now,
    ':updatedAt': now,
  }
  let updateExpression = 'SET #status = :status, #error = :error, reason = :reason, completedAt = :completedAt, updatedAt = :updatedAt'
  if (fallbackPerformance) {
    updateExpression += ', performance = :performance'
    values[':performance'] = fallbackPerformance
  }
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: values,
  }))
  await releaseRunnerLock(input.runner, input.runId)
  await dispatchNextOrStopRunner(input.runner, input.instanceId)
  await putMetric('RunFailed', 1, input.runner, input.benchmark)
  return { ...input, status: 'FAILED', errorMessage: err }
}

export async function handler(event: WorkflowInput, _context: Context) {
  try {
    if (event.action === 'START_AND_WAIT') return await startAndWait(event)
    if (event.action === 'DISPATCH') return await dispatch(event)
    if (event.action === 'POLL') return await poll(event)
    if (event.action === 'FINALIZE') return await finalize(event)
    if (event.action === 'FAIL') return await fail(event, event.errorMessage ?? 'Workflow failed')
    throw new Error(`unsupported action: ${event.action}`)
  } catch (e: any) {
    if (event.action === 'FAIL') throw e
    return await fail(event, String(e?.message ?? e))
  }
}
