import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('run_queue', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.RUN_WORKFLOW_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:kb'
  })

  it('dispatches the oldest queued run for a runner', async () => {
    const ddb = { send: vi.fn() }
    const sfn = { send: vi.fn().mockResolvedValue({}) }
    const putMetric = vi.fn().mockResolvedValue(undefined)
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ScanCommand') {
        return {
          Items: [
            queuedRun('newer-run', 'cpu', '2026-05-03T10:01:00Z'),
            queuedRun('older-run', 'cpu', '2026-05-03T10:00:00Z'),
          ],
        }
      }
      return {}
    })
    vi.doMock('../../lambda/aws', () => ({ ddb, sfn, putMetric }))

    const { dispatchNextQueuedRun } = await import('../../lambda/run_queue')
    const out = await dispatchNextQueuedRun('cpu')

    expect(out).toMatchObject({ started: true, runId: 'older-run', reason: 'started' })
    expect(sfn.send).toHaveBeenCalledTimes(1)
    expect(sfn.send.mock.calls[0][0].input.name).toBe('older-run')
  })

  it('leaves queued work untouched when the runner lock is busy', async () => {
    const ddb = { send: vi.fn() }
    const sfn = { send: vi.fn() }
    const putMetric = vi.fn()
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ScanCommand') {
        return { Items: [queuedRun('queued-run', 'gpu', '2026-05-03T10:00:00Z')] }
      }
      if (command.constructor.name === 'UpdateCommand') {
        throw Object.assign(new Error('conditional failed'), { name: 'ConditionalCheckFailedException' })
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: { ownerRunId: 'active-run' } }
      }
      return {}
    })
    vi.doMock('../../lambda/aws', () => ({ ddb, sfn, putMetric }))

    const { dispatchNextQueuedRun } = await import('../../lambda/run_queue')
    const out = await dispatchNextQueuedRun('gpu')

    expect(out).toMatchObject({ started: false, runId: 'queued-run', reason: 'busy' })
    expect(sfn.send).not.toHaveBeenCalled()
  })

  it('does not stop an instance when a new run claimed the lock after the empty queue check', async () => {
    const ddb = { send: vi.fn() }
    const sfn = { send: vi.fn() }
    const ec2 = { send: vi.fn() }
    const putMetric = vi.fn()
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ScanCommand') {
        return { Items: [] }
      }
      if (command.constructor.name === 'UpdateCommand') {
        throw Object.assign(new Error('conditional failed'), { name: 'ConditionalCheckFailedException' })
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: { ownerRunId: 'new-run' } }
      }
      return {}
    })
    vi.doMock('../../lambda/aws', () => ({ ddb, sfn, ec2, putMetric }))

    const { dispatchNextOrStopRunner } = await import('../../lambda/run_queue')
    const out = await dispatchNextOrStopRunner('cpu', 'i-cpu')

    expect(out).toMatchObject({ started: false, runId: 'new-run', reason: 'idle-stop-busy' })
    expect(ec2.send).not.toHaveBeenCalled()
    expect(sfn.send).not.toHaveBeenCalled()
  })

  it('uses a temporary idle-stop lock before stopping an idle runner', async () => {
    const ddb = { send: vi.fn() }
    const sfn = { send: vi.fn() }
    const ec2 = { send: vi.fn().mockResolvedValue({}) }
    const putMetric = vi.fn()
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ScanCommand') {
        return { Items: [] }
      }
      return {}
    })
    vi.doMock('../../lambda/aws', () => ({ ddb, sfn, ec2, putMetric }))

    const { dispatchNextOrStopRunner } = await import('../../lambda/run_queue')
    const out = await dispatchNextOrStopRunner('gpu', 'i-gpu')

    expect(out).toMatchObject({ started: false, reason: 'stopped' })
    expect(ec2.send).toHaveBeenCalledTimes(1)
    const lockUpdate = ddb.send.mock.calls.find(([command]: any[]) => command.constructor.name === 'UpdateCommand')?.[0]
    expect(lockUpdate.input.ExpressionAttributeValues[':owner']).toMatch(/^IDLE_STOP#gpu#/)
  })
})

function queuedRun(runId: string, runner: 'cpu' | 'gpu', queuedAt: string) {
  return {
    runId,
    runner,
    benchmark: 'vector',
    params: { vectorLength: 1 },
    status: 'QUEUED',
    instanceId: runner === 'cpu' ? 'i-cpu' : 'i-gpu',
    instanceType: runner === 'cpu' ? 'c7i.8xlarge' : 'g6e.xlarge',
    s3Prefix: `kernel-bench/vector/test/${runId}/`,
    createdAt: queuedAt,
    queuedAt,
    updatedAt: queuedAt,
  }
}
