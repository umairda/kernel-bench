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
