import { beforeEach, describe, expect, it } from 'vitest'

describe('rpc_methods/shared', () => {
  beforeEach(() => {
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.ARTIFACT_BUCKET_NAME = 'Artifacts'
    process.env.CPU_INSTANCE_ID = 'i-cpu'
    process.env.GPU_INSTANCE_ID = 'i-gpu'
    process.env.STARTING_STALE_SECONDS = '1'
  })

  it('validates object params and integers', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    expect(() => shared.asObject({ a: 1 })).not.toThrow()
    expect(() => shared.toInt({ x: 3 }, 'x', 1)).not.toThrow()
    expect(() => shared.toInt({ x: 0 }, 'x', 1)).toThrow()
  })

  it('parses run ids and runners', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    expect(shared.parseRunId({ runId: 'r1' })).toBe('r1')
    expect(shared.parseRunner('cpu')).toBe('cpu')
    expect(() => shared.parseRunner('bad')).toThrow()
  })
})

