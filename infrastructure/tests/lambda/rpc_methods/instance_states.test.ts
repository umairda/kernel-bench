import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/instance_states', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.CPU_INSTANCE_ID = 'i-cpu'
    process.env.GPU_INSTANCE_ID = 'i-gpu'
  })

  it('returns cpu/gpu states', async () => {
    const getState = vi.fn().mockResolvedValueOnce('stopped').mockResolvedValueOnce('running')
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, getState }
    })
    const { rpcInstanceStates } = await import('../../../lambda/rpc_methods/instance_states')
    const out = await rpcInstanceStates()
    expect(out).toEqual({ cpu: 'stopped', gpu: 'running' })
  })
})

