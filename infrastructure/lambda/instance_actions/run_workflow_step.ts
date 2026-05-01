import type { Context } from 'aws-lambda'
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DescribeInstanceStatusCommand, DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand, waitUntilInstanceRunning, waitUntilInstanceStopped } from '@aws-sdk/client-ec2'
import { DescribeInstanceInformationCommand, GetCommandInvocationCommand, SendCommandCommand } from '@aws-sdk/client-ssm'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { ddb, ec2, putMetric, s3, ssm } from '../aws'
import { mapSsmStatus, normalizePerformance, nowIso, TERMINAL_STATUSES } from '../common'
import { writeHistoryRecord } from '../history'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const ARTIFACT_BUCKET_NAME = process.env.ARTIFACT_BUCKET_NAME!
const SOURCE_ARCHIVE_KEY = process.env.SOURCE_ARCHIVE_KEY!

type WorkflowInput = {
  action: 'START_AND_WAIT' | 'DISPATCH' | 'POLL' | 'FINALIZE' | 'FAIL'
  runId: string
  runner: 'cpu' | 'gpu'
  benchmark: 'vector' | 'matrix-multiplication' | 'convolution'
  params: Record<string, number>
  instanceId: string
  s3Prefix: string
  createdAt: string
  commandId?: string
  launchTiming?: Record<string, number>
  poll?: { isTerminal: boolean; mappedStatus?: string; ssmStatus?: string; responseCode?: number }
  errorMessage?: string
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
  const requestStart = performance.now()
  const bootStart = performance.now()
  let state = await currentState(input.instanceId)
  if (state === 'pending') {
    await writeStartupProgress(input.runId, { phase: 'WAITING_FOR_INSTANCE_RUNNING', ec2State: 'pending', detail: 'Instance is pending' })
    await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [input.instanceId] })
  } else if (state === 'stopping') {
    await writeStartupProgress(input.runId, { phase: 'WAITING_FOR_INSTANCE_STOPPED', ec2State: 'stopping', detail: 'Waiting for stop before start' })
    await waitUntilInstanceStopped({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [input.instanceId] })
    await writeStartupProgress(input.runId, { phase: 'STARTING_INSTANCE', ec2State: 'stopped', detail: 'Sending StartInstances command' })
    await ec2.send(new StartInstancesCommand({ InstanceIds: [input.instanceId] }))
    await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [input.instanceId] })
  } else if (state !== 'running') {
    await writeStartupProgress(input.runId, { phase: 'STARTING_INSTANCE', ec2State: state ?? 'unknown', detail: 'Sending StartInstances command' })
    await ec2.send(new StartInstancesCommand({ InstanceIds: [input.instanceId] }))
    await writeStartupProgress(input.runId, { phase: 'WAITING_FOR_INSTANCE_RUNNING', ec2State: 'pending', detail: 'Waiting for running state' })
    await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [input.instanceId] })
  }

  const start = Date.now()
  let online = false
  while (Date.now() - start < 300000) {
    const ec2State = await currentState(input.instanceId)
    const health = await getInstanceHealth(input.instanceId)
    const r = await ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [input.instanceId] }], MaxResults: 5 }))
    const ping = r.InstanceInformationList?.[0]?.PingStatus ?? 'Offline'
    await writeStartupProgress(input.runId, {
      phase: 'WAITING_FOR_SSM_ONLINE',
      ec2State: ec2State ?? 'unknown',
      instanceStatus: health.instanceStatus ?? 'unknown',
      systemStatus: health.systemStatus ?? 'unknown',
      ssmPingStatus: ping,
      detail: ping === 'Online' ? 'SSM agent is online' : 'Waiting for SSM agent to become online',
    })
    if (ping === 'Online') {
      online = true
      break
    }
    await new Promise((res) => setTimeout(res, 5000))
  }
  if (!online) throw new Error(`SSM agent did not become Online for instance ${input.instanceId}`)

  const bootEnd = performance.now()
  return {
    ...input,
    launchTiming: {
      queueStartRequestMs: Number((performance.now() - requestStart).toFixed(3)),
      instanceBootSsmReadyMs: Number((bootEnd - bootStart).toFixed(3)),
    },
  }
}

async function dispatch(input: WorkflowInput) {
  const paramsB64 = Buffer.from(JSON.stringify(input.params)).toString('base64')
  const launchTimingB64 = Buffer.from(JSON.stringify({
    ...(input.launchTiming ?? {}),
    requestReceivedAt: input.createdAt,
    commandDispatchAt: nowIso(),
  })).toString('base64')

  const commands = [
    'set -euo pipefail',
    `mkdir -p /opt/kernel-bench/runs/${input.runId}`,
    `cd /opt/kernel-bench/runs/${input.runId}`,
    `aws s3 cp s3://${ARTIFACT_BUCKET_NAME}/${SOURCE_ARCHIVE_KEY} source.tar.gz`,
    'mkdir -p workspace',
    'tar -xzf source.tar.gz -C workspace',
    'cd workspace',
    'chmod +x ./infrastructure/scripts/remote_kernel_benchmark.sh',
    `bash ./infrastructure/scripts/remote_kernel_benchmark.sh '${input.runner}' '${input.benchmark}' '${paramsB64}' '${input.runId}' '${ARTIFACT_BUCKET_NAME}' '${input.s3Prefix}' '${launchTimingB64}'`,
  ]

  const send = await ssm.send(new SendCommandCommand({
    InstanceIds: [input.instanceId],
    DocumentName: 'AWS-RunShellScript',
    Comment: `KernelBench benchmark run ${input.runId}`,
    Parameters: { commands },
  }))
  const commandId = send.Command?.CommandId
  if (!commandId) throw new Error('missing command id from SSM')

  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: 'SET #status = :status, commandId = :commandId, startupProgress.#phase = :phase, startupProgress.detail = :detail, startupProgress.observedAt = :observedAt, updatedAt = :updatedAt REMOVE #error',
    ExpressionAttributeNames: { '#status': 'status', '#phase': 'phase', '#error': 'error' },
    ExpressionAttributeValues: {
      ':status': 'RUNNING',
      ':commandId': commandId,
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
  if (!isTerminal) {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: input.runId },
      UpdateExpression: 'SET ssmStatus = :ssmStatus, updatedAt = :updatedAt, responseCode = :responseCode',
      ExpressionAttributeValues: { ':ssmStatus': inv.Status ?? 'Unknown', ':updatedAt': nowIso(), ':responseCode': responseCode },
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

async function finalize(input: WorkflowInput) {
  const mapped = input.poll?.mappedStatus ?? 'FAILED'
  const ssmStatus = input.poll?.ssmStatus ?? 'Unknown'
  const responseCode = input.poll?.responseCode ?? -1
  const now = nowIso()
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: 'SET #status = :status, ssmStatus = :ssmStatus, responseCode = :responseCode, completedAt = :completedAt, updatedAt = :updatedAt REMOVE #error',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: { ':status': mapped, ':ssmStatus': ssmStatus, ':responseCode': responseCode, ':completedAt': now, ':updatedAt': now },
  }))
  const performance = await attachPerformance(input.runId, input.s3Prefix)
  if (mapped === 'COMPLETED' && performance) {
    await writeHistoryRecord({
      runId: input.runId,
      benchmark: input.benchmark,
      runner: input.runner,
      params: input.params,
      createdAt: input.createdAt,
      completedAt: now,
      performance: normalizePerformance(performance),
    })
  }
  try { await ec2.send(new StopInstancesCommand({ InstanceIds: [input.instanceId] })) } catch {}
  await releaseRunnerLock(input.runner, input.runId)
  if (mapped === 'COMPLETED') await putMetric('RunCompleted', 1, input.runner, input.benchmark)
  if (mapped === 'FAILED') await putMetric('RunFailed', 1, input.runner, input.benchmark)
  if (mapped === 'CANCELLED') await putMetric('RunCancelled', 1, input.runner, input.benchmark)
  return { ...input, status: mapped }
}

async function fail(input: WorkflowInput, err: string) {
  const now = nowIso()
  await ddb.send(new UpdateCommand({
    TableName: RUNS_TABLE_NAME,
    Key: { runId: input.runId },
    UpdateExpression: 'SET #status = :status, #error = :error, completedAt = :completedAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: { ':status': 'FAILED', ':error': err, ':completedAt': now, ':updatedAt': now },
  }))
  try { await ec2.send(new StopInstancesCommand({ InstanceIds: [input.instanceId] })) } catch {}
  await releaseRunnerLock(input.runner, input.runId)
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
