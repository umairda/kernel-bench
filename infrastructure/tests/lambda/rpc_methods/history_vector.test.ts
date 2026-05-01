import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/history_vector', () => {
  beforeEach(() => vi.resetModules())

  it('maps vector history items', async () => {
    const queryHistory = vi.fn().mockResolvedValue([{ runId: 'r', runner: 'cpu', completedAt: 't', vectorLength: 10, opMs: { add: 1 } }])
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, queryHistory }
    })
    const { rpcHistoryVector } = await import('../../../lambda/rpc_methods/history_vector')
    const out = await rpcHistoryVector({})
    expect(out.items[0].runId).toBe('r')
  })
})

