import { describe, expect, it, vi } from 'vitest'
import { makeAwsMocks, setupEnv } from './_test_utils'

describe('ssm_command_event', () => {
  setupEnv()

  it('returns early when command-id is missing', async () => {
    const aws = makeAwsMocks()
    vi.doMock('../../lambda/aws', () => aws)
    const { handler } = await import('../../lambda/instance_actions/ssm_command_event')
    const out = await handler({ detail: {} } as any)
    expect(out).toEqual({ ok: true, reason: 'missing command-id' })
  })
})
