import type { ScheduledEvent } from 'aws-lambda'
import { ScanCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { DescribeInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2'
import { ListCommandInvocationsCommand } from '@aws-sdk/client-ssm'
import { ddb, ec2, ssm } from '../aws'
import { nowIso } from '../common'
import { dispatchNextQueuedRun, hasQueuedRuns, type Runner } from '../run_queue'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const STALE_MINUTES = Number(process.env.RUN_STALE_MINUTES ?? '45')
const IDLE_INSTANCE_MINUTES = Number(process.env.IDLE_INSTANCE_MINUTES ?? '10')
const CPU_INSTANCE_ID = process.env.CPU_INSTANCE_ID
const GPU_INSTANCE_ID = process.env.GPU_INSTANCE_ID

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

async function dispatchNextOrStopRunner(runner: string | undefined, instanceId?: string) {
  if (runner !== 'cpu' && runner !== 'gpu') {
    await stopInstance(instanceId)
    return
  }
  const dispatch = await dispatchNextQueuedRun(runner)
  if (!dispatch.started && dispatch.reason === 'empty' && !await hasQueuedRuns(runner)) {
    await stopInstance(instanceId)
  }
}

function parseIso(v?: string): number | undefined {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : t
}

async function hasActiveSsmCommand(instanceId: string): Promise<boolean> {
  const resp = await ssm.send(
    new ListCommandInvocationsCommand({
      Details: false,
      MaxResults: 25,
      InstanceId: instanceId,
    }),
  )

  for (const inv of resp.CommandInvocations ?? []) {
    const status = inv.Status
    if (status && ['Pending', 'InProgress', 'Delayed'].includes(status)) {
      return true
    }
  }
  return false
}

async function hasActiveRunnerLock(runner: string): Promise<boolean> {
  try {
    const found = await ddb.send(new GetCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: `RUNNER_LOCK#${runner}` },
    }))
    return Boolean(found.Item?.ownerRunId)
  } catch {
    return false
  }
}

async function reapIdleRunner(runner: Runner, instanceId?: string): Promise<number> {
  if (!instanceId) return 0
  if (await hasQueuedRuns(runner) || await hasActiveRunnerLock(runner)) return 0

  const desc = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }))
  const instance = desc.Reservations?.[0]?.Instances?.[0]
  const state = instance?.State?.Name
  if (state !== 'running') return 0

  if (await hasActiveSsmCommand(instanceId)) return 0

  const launch = instance?.LaunchTime
  const runningMinutes = launch ? (Date.now() - new Date(launch).getTime()) / 60000 : 0
  if (runningMinutes < IDLE_INSTANCE_MINUTES) return 0

  await stopInstance(instanceId)
  return 1
}

async function reapIdleInstances(): Promise<number> {
  const cpuStopped = await reapIdleRunner('cpu', CPU_INSTANCE_ID)
  const gpuStopped = await reapIdleRunner('gpu', GPU_INSTANCE_ID)
  return cpuStopped + gpuStopped
}

export async function handler(_event: ScheduledEvent) {
  const staleBefore = Date.now() - STALE_MINUTES * 60 * 1000
  const scan = await ddb.send(new ScanCommand({
    TableName: RUNS_TABLE_NAME,
    ProjectionExpression: 'runId, #status, runner, instanceId, createdAt, updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
  }))

  let count = 0
  for (const item of (scan.Items ?? []) as Record<string, any>[]) {
    if (!['STARTING', 'RUNNING'].includes(item.status)) continue
    const ts = parseIso(item.updatedAt) ?? parseIso(item.createdAt)
    if (!ts || ts >= staleBefore) continue

    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: item.runId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, #error = :error, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':updatedAt': nowIso(),
        ':completedAt': nowIso(),
        ':error': `Run timed out by sweeper after ${STALE_MINUTES} minutes without terminal status`,
      },
    }))
    await releaseRunnerLock(item.runner as string | undefined, item.runId as string)
    await dispatchNextOrStopRunner(item.runner as string | undefined, item.instanceId as string | undefined)
    count++
  }

  const queueDispatches = [
    await dispatchNextQueuedRun('cpu'),
    await dispatchNextQueuedRun('gpu'),
  ]
  const idleInstancesStopped = await reapIdleInstances()
  return {
    ok: true,
    staleRunsFailed: count,
    staleMinutes: STALE_MINUTES,
    queueDispatches,
    idleInstancesStopped,
    idleInstanceMinutes: IDLE_INSTANCE_MINUTES,
  }
}
