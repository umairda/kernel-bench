import { describe, expect, it, vi } from 'vitest'
import { baseEvent, makeAwsMocks, setupEnv } from './_test_utils'

describe('instance_states', () => {
  setupEnv()

  it('returns cpu and gpu states', async () => {
    const aws = makeAwsMocks()
    aws.ec2.send
      .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }] })
      .mockResolvedValueOnce({ Reservations: [{ Instances: [{ State: { Name: 'running' } }] }] })
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/instance_states')
    const res = await handler(baseEvent())
    expect(res.statusCode).toBe(200)
    expect(String(res.body)).toContain('"cpu":"stopped"')
    expect(String(res.body)).toContain('"gpu":"running"')
  })
})
