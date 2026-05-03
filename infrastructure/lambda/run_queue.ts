import { DeleteCommand, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { StartExecutionCommand } from '@aws-sdk/client-sfn'
import { StopInstancesCommand } from '@aws-sdk/client-ec2'
import { ddb, ec2, putMetric, sfn } from './aws'
import { nowIso } from './common'
import type { Benchmark } from './benchmark_registry'

const RUNS_TABLE_NAME = process.env.RUNS_TABLE_NAME!
const RUN_WORKFLOW_STATE_MACHINE_ARN = process.env.RUN_WORKFLOW_STATE_MACHINE_ARN ?? ''
const LOCK_TTL_SECONDS = Number(process.env.RUNNER_LOCK_TTL_SECONDS ?? '7200')

export type Runner = 'cpu' | 'gpu'

export type QueuedRunItem = {
  runId: string
  runner: Runner
  benchmark: Benchmark
  params: Record<string, number>
  status: string
  instanceId: string
  instanceType?: string
  s3Prefix: string
  createdAt: string
  updatedAt: string
  queuedAt?: string
}

export type QueueDispatchResult = {
  started: boolean
  runId?: string
  reason: 'empty' | 'busy' | 'started' | 'lost-race' | 'failed' | 'missing-state-machine' | 'idle-stop-busy' | 'stopped' | 'unknown-runner'
  error?: string
}

function runnerLockKey(runner: Runner) {
  return `RUNNER_LOCK#${runner}`
}

function isConditionalFailure(error: unknown) {
  return String((error as any)?.name ?? '').includes('ConditionalCheckFailed')
}

async function acquireRunnerLock(runner: Runner, runId: string): Promise<{ ok: boolean; activeRunId?: string }> {
  const now = Math.floor(Date.now() / 1000)
  try {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: runnerLockKey(runner) },
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
    const existing = await ddb.send(new GetCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: runnerLockKey(runner) },
    }))
    return { ok: false, activeRunId: (existing.Item as any)?.ownerRunId }
  }
}

async function releaseRunnerLockOnly(runner: Runner, runId: string) {
  try {
    await ddb.send(new DeleteCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: runnerLockKey(runner) },
      ConditionExpression: 'ownerRunId = :owner',
      ExpressionAttributeValues: { ':owner': runId },
    }))
  } catch {}
}

function idleStopOwner(runner: Runner) {
  return `IDLE_STOP#${runner}#${Date.now()}#${Math.random().toString(36).slice(2)}`
}

async function stopInstance(instanceId?: string) {
  if (!instanceId) return
  try {
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }))
  } catch {}
}

export async function getQueuedRuns(runner: Runner): Promise<QueuedRunItem[]> {
  const items: QueuedRunItem[] = []
  let ExclusiveStartKey: Record<string, any> | undefined
  do {
    const resp = await ddb.send(new ScanCommand({
      TableName: RUNS_TABLE_NAME,
      FilterExpression: 'runner = :runner AND #status = :queued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':runner': runner, ':queued': 'QUEUED' },
      ExclusiveStartKey,
    }))
    items.push(...((resp.Items ?? []) as QueuedRunItem[]))
    ExclusiveStartKey = resp.LastEvaluatedKey as Record<string, any> | undefined
  } while (ExclusiveStartKey)

  items.sort((a, b) => {
    const aTime = String(a.queuedAt ?? a.createdAt ?? '')
    const bTime = String(b.queuedAt ?? b.createdAt ?? '')
    const byTime = aTime.localeCompare(bTime)
    return byTime !== 0 ? byTime : String(a.runId).localeCompare(String(b.runId))
  })
  return items
}

export async function queuedRunCount(runner: Runner): Promise<number> {
  return (await getQueuedRuns(runner)).length
}

export async function hasQueuedRuns(runner: Runner): Promise<boolean> {
  return (await queuedRunCount(runner)) > 0
}

export async function dispatchNextQueuedRun(runner: Runner): Promise<QueueDispatchResult> {
  if (!RUN_WORKFLOW_STATE_MACHINE_ARN) {
    return { started: false, reason: 'missing-state-machine' }
  }

  const [next] = await getQueuedRuns(runner)
  if (!next) {
    return { started: false, reason: 'empty' }
  }

  const lock = await acquireRunnerLock(runner, next.runId)
  if (!lock.ok) {
    return { started: false, runId: next.runId, reason: 'busy' }
  }

  const now = nowIso()
  const startedItem = {
    ...next,
    status: 'STARTING',
    updatedAt: now,
    dispatchStartedAt: now,
    startupProgress: {
      phase: 'QUEUED_DISPATCHED',
      ec2State: 'unknown',
      instanceStatus: 'unknown',
      systemStatus: 'unknown',
      ssmPingStatus: 'unknown',
      detail: 'Queued run claimed by dispatcher',
      observedAt: now,
    },
  }

  try {
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: next.runId },
      UpdateExpression: 'SET #status = :starting, dispatchStartedAt = :now, updatedAt = :now, startupProgress = :startupProgress REMOVE #error, #reason',
      ConditionExpression: '#status = :queued',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error', '#reason': 'reason' },
      ExpressionAttributeValues: {
        ':starting': 'STARTING',
        ':queued': 'QUEUED',
        ':now': now,
        ':startupProgress': startedItem.startupProgress,
      },
    }))
  } catch (error) {
    await releaseRunnerLockOnly(runner, next.runId)
    if (isConditionalFailure(error)) {
      return { started: false, runId: next.runId, reason: 'lost-race' }
    }
    return { started: false, runId: next.runId, reason: 'failed', error: String((error as any)?.message ?? error) }
  }

  try {
    await sfn.send(new StartExecutionCommand({
      stateMachineArn: RUN_WORKFLOW_STATE_MACHINE_ARN,
      name: next.runId,
      input: JSON.stringify(startedItem),
    }))
    await putMetric('RunStarted', 1, runner, next.benchmark)
    return { started: true, runId: next.runId, reason: 'started' }
  } catch (error) {
    if (String((error as any)?.name ?? '').includes('ExecutionAlreadyExists')) {
      return { started: true, runId: next.runId, reason: 'started' }
    }

    const failedAt = nowIso()
    await ddb.send(new UpdateCommand({
      TableName: RUNS_TABLE_NAME,
      Key: { runId: next.runId },
      UpdateExpression: 'SET #status = :failed, #error = :error, reason = :reason, updatedAt = :updatedAt, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':failed': 'FAILED',
        ':error': `Failed to start queued workflow: ${String((error as any)?.message ?? error)}`,
        ':reason': 'QUEUE_DISPATCH_START_EXECUTION_FAILED',
        ':updatedAt': failedAt,
        ':completedAt': failedAt,
      },
    }))
    await releaseRunnerLockOnly(runner, next.runId)
    await putMetric('RunFailed', 1, runner, next.benchmark)
    return { started: false, runId: next.runId, reason: 'failed', error: String((error as any)?.message ?? error) }
  }
}

export async function dispatchNextOrStopRunner(runner: string | undefined, instanceId?: string): Promise<QueueDispatchResult> {
  if (runner !== 'cpu' && runner !== 'gpu') {
    await stopInstance(instanceId)
    return { started: false, reason: 'unknown-runner' }
  }

  const dispatch = await dispatchNextQueuedRun(runner)
  if (dispatch.started || dispatch.reason !== 'empty' || await hasQueuedRuns(runner)) {
    return dispatch
  }

  const idleOwner = idleStopOwner(runner)
  const lock = await acquireRunnerLock(runner, idleOwner)
  if (!lock.ok) {
    return { started: false, runId: lock.activeRunId, reason: 'idle-stop-busy' }
  }

  let shouldDispatchAfterRelease = false
  let result: QueueDispatchResult = { started: false, reason: 'stopped' }
  try {
    if (await hasQueuedRuns(runner)) {
      shouldDispatchAfterRelease = true
      result = { started: false, reason: 'lost-race' }
    } else {
      await stopInstance(instanceId)
      shouldDispatchAfterRelease = await hasQueuedRuns(runner)
    }
  } finally {
    await releaseRunnerLockOnly(runner, idleOwner)
  }

  if (shouldDispatchAfterRelease) {
    return dispatchNextQueuedRun(runner)
  }
  return result
}
