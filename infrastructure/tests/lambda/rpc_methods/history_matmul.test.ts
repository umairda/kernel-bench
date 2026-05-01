import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/history_matmul', () => {
  beforeEach(() => vi.resetModules())

  it('filters squareOnly by default', async () => {
    const queryHistory = vi.fn().mockResolvedValue([
      { runId: 'r1', runner: 'cpu', completedAt: 't1', isSquare: true, squareSize: 4, inputRows: 4, inputCols: 4, outputCols: 4, opMs: { matmul: 1 } },
      { runId: 'r2', runner: 'cpu', completedAt: 't2', isSquare: false, inputRows: 2, inputCols: 3, outputCols: 4, opMs: { matmul: 2 } },
    ])
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, queryHistory }
    })
    const { rpcHistoryMatmul } = await import('../../../lambda/rpc_methods/history_matmul')
    const out = await rpcHistoryMatmul({})
    expect(out.items).toHaveLength(1)
    expect(out.items[0].runId).toBe('r1')
  })
})

