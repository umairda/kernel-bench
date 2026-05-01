import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/run_status', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
  })

  it('throws when run missing', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({ Item: undefined }) }
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, ddb }
    })
    const { rpcRunStatus } = await import('../../../lambda/rpc_methods/run_status')
    await expect(rpcRunStatus({ runId: 'r1' })).rejects.toBeTruthy()
  })
})

