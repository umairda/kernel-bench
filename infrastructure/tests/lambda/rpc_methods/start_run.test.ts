import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/start_run', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.CPU_INSTANCE_ID = 'i-cpu'
    process.env.GPU_INSTANCE_ID = 'i-gpu'
    process.env.RUN_WORKFLOW_STATE_MACHINE_ARN = 'arn:workflow'
  })

  it('throws validation error for bad runner', async () => {
    const { rpcStartRun } = await import('../../../lambda/rpc_methods/start_run')
    await expect(rpcStartRun({ runner: 'bad', benchmark: 'vector', params: { vectorLength: 1 } } as any)).rejects.toBeTruthy()
  })

  it('queues a valid request and kicks the queue dispatcher', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({}) }
    const dispatchNextQueuedRun = vi.fn().mockResolvedValue({ started: true, reason: 'started', runId: 'run-1' })
    vi.doMock('../../../lambda/run_queue', () => ({ dispatchNextQueuedRun }))
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb, putMetric: vi.fn().mockResolvedValue(undefined) }
    })
    const { rpcStartRun } = await import('../../../lambda/rpc_methods/start_run')
    const res = await rpcStartRun({ runner: 'cpu', benchmark: 'vector', params: { vectorLength: 2 } } as any)
    expect(res.status).toBe('QUEUED')
    expect(dispatchNextQueuedRun).toHaveBeenCalledWith('cpu')
  })

  it('queues a gpu run without checking current instance state', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({}) }
    const dispatchNextQueuedRun = vi.fn().mockResolvedValue({ started: false, reason: 'busy', runId: 'run-1' })
    vi.doMock('../../../lambda/run_queue', () => ({ dispatchNextQueuedRun }))
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb, putMetric: vi.fn().mockResolvedValue(undefined) }
    })
    const { rpcStartRun } = await import('../../../lambda/rpc_methods/start_run')
    const res = await rpcStartRun({ runner: 'gpu', benchmark: 'vector', params: { vectorLength: 2 } } as any)
    expect(res.status).toBe('QUEUED')
    expect(dispatchNextQueuedRun).toHaveBeenCalledWith('gpu')
  })
})
