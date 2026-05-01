import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/run_history', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns terminal run items and excludes runner locks', async () => {
    const ddb = {
      send: vi.fn().mockResolvedValue({
        Items: [
          { runId: 'RUNNER_LOCK#gpu', status: 'RUNNING' },
          { runId: 'run-1', status: 'COMPLETED', createdAt: '2026-05-01T00:00:00Z', runner: 'cpu', benchmark: 'vector', params: {} },
          { runId: 'run-2', status: 'FAILED', createdAt: '2026-05-02T00:00:00Z', runner: 'gpu', benchmark: 'convolution', params: {} },
          { runId: 'run-3', status: 'RUNNING', createdAt: '2026-05-03T00:00:00Z', runner: 'gpu', benchmark: 'vector', params: {} },
        ],
      }),
    }

    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, ddb, attachPerformance: vi.fn(async (item: any) => item) }
    })

    const { rpcRunHistory } = await import('../../../lambda/rpc_methods/run_history')
    const out = await rpcRunHistory()

    expect(out.items).toHaveLength(2)
    expect(out.items[0].runId).toBe('run-2')
    expect(out.items[1].runId).toBe('run-1')
  })
})
