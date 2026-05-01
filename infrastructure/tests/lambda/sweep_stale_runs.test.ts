import { describe, expect, it, vi } from 'vitest'
import { makeAwsMocks, setupEnv } from './_test_utils'

describe('sweep_stale_runs', () => {
  setupEnv()

  it('returns summary payload', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({ Items: [] })
    aws.ec2.send.mockResolvedValue({ Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }] })
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/sweep_stale_runs')
    const out = await handler({} as any)
    expect(out.ok).toBe(true)
    expect(out.staleRunsFailed).toBe(0)
  })
})
