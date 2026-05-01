import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/in_progress_runs', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns empty items when no running records', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({ Items: [] }) }
    vi.doMock('../../../lambda/rpc_methods/shared', async () => {
      const actual = await vi.importActual<any>('../../../lambda/rpc_methods/shared')
      return { ...actual, ddb }
    })
    const { rpcInProgressRuns } = await import('../../../lambda/rpc_methods/in_progress_runs')
    const out = await rpcInProgressRuns()
    expect(out).toEqual({ items: [] })
  })
})

