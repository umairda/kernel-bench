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

  it('starts execution on valid request', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({}) }
    const sfn = { send: vi.fn().mockResolvedValue({}) }
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return {
        ...actual,
        acquireRunnerLock: vi.fn().mockResolvedValue({ ok: true }),
        getState: vi.fn().mockResolvedValue('stopped'),
      }
    })
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb, sfn, putMetric: vi.fn().mockResolvedValue(undefined) }
    })
    const { rpcStartRun } = await import('../../../lambda/rpc_methods/start_run')
    const res = await rpcStartRun({ runner: 'cpu', benchmark: 'vector', params: { vectorLength: 2 } } as any)
    expect(res.status).toBe('STARTING')
    expect(sfn.send).toHaveBeenCalled()
  })
})
