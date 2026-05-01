import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/history_convolution', () => {
  beforeEach(() => vi.resetModules())

  it('maps convolution history items', async () => {
    const queryHistory = vi.fn().mockResolvedValue([
      { runId: 'r1', runner: 'gpu', completedAt: 't', inputN: 1, inputC: 3, inputH: 64, inputW: 64, filterOutC: 16, filterH: 3, filterW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1, inputArea: 4096, filterArea: 9, opMs: { convolution: 1 } },
    ])
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, queryHistory }
    })
    const { rpcHistoryConvolution } = await import('../../../lambda/rpc_methods/history_convolution')
    const out = await rpcHistoryConvolution({})
    expect(out.items[0].runId).toBe('r1')
  })
})

