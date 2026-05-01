import { describe, expect, it, vi } from 'vitest'
import { makeAwsMocks, setupEnv } from './_test_utils'

describe('run_workflow_step', () => {
  setupEnv()

  it('FAIL action marks run failed', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({})
    aws.ec2.send.mockResolvedValue({})
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'FAIL',
      runId: 'r1',
      runner: 'cpu',
      benchmark: 'vector',
      params: { vectorLength: 10 },
      instanceId: 'i-cpu',
      s3Prefix: 'x/',
      createdAt: '2026-01-01T00:00:00Z',
      errorMessage: 'boom',
    } as any, {} as any)
    expect(out.status).toBe('FAILED')
  })
})
