import { describe, expect, it, vi } from 'vitest'
import { baseEvent, makeAwsMocks, setupEnv } from './_test_utils'

describe('list_running_runs', () => {
  setupEnv()

  it('returns empty list', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({ Items: [] })
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/list_running_runs')
    const res = await handler(baseEvent())
    expect(res.statusCode).toBe(200)
    expect(String(res.body)).toContain('"items":[]')
  })
})
