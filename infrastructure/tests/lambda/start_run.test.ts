import { describe, expect, it, vi } from 'vitest'
import { baseEvent, makeAwsMocks, setupEnv } from './_test_utils'

describe('start_run', () => {
  setupEnv()

  it('returns 400 for invalid runner', async () => {
    const aws = makeAwsMocks()
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/start_run')
    const res = await handler(baseEvent({ body: JSON.stringify({ runner: 'bad', benchmark: 'vector', params: { vectorLength: 1 } }) }))
    expect(res.statusCode).toBe(400)
  })

  it('happy path starts workflow', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValueOnce({}).mockResolvedValueOnce({})
    aws.sfn.send.mockResolvedValue({})
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/start_run')
    const res = await handler(baseEvent({ body: JSON.stringify({ runner: 'cpu', benchmark: 'vector', params: { vectorLength: 10 } }) }))
    expect(res.statusCode).toBe(200)
    expect(aws.sfn.send).toHaveBeenCalledTimes(1)
  })
})
