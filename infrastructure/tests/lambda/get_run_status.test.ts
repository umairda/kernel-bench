import { describe, expect, it, vi } from 'vitest'
import { baseEvent, makeAwsMocks, setupEnv } from './_test_utils'

describe('get_run_status', () => {
  setupEnv()

  it('returns 404 when run is missing', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({ Item: undefined })
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/get_run_status')
    const res = await handler(baseEvent({ pathParameters: { runId: 'r1' } }))
    expect(res.statusCode).toBe(404)
  })

  it('returns terminal run immediately', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({ Item: { runId: 'r1', status: 'COMPLETED', runner: 'cpu', benchmark: 'vector', params: {} } })
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/get_run_status')
    const res = await handler(baseEvent({ pathParameters: { runId: 'r1' } }))
    expect(res.statusCode).toBe(200)
    expect(String(res.body)).toContain('"status":"COMPLETED"')
  })
})
