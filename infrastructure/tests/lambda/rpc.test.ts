import { describe, expect, it } from 'vitest'
import { baseEvent, setupEnv } from './_test_utils'

describe('rpc', () => {
  setupEnv()

  it('returns method-not-found error for unknown method', async () => {
    const { handler } = await import('../../lambda/rpc_handler')
    const res = await handler(baseEvent({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nope', params: {} }) }))
    expect(res.statusCode).toBe(200)
    expect(String(res.body)).toContain('"code":-32601')
  })
})
