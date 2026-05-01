import { describe, expect, it, vi } from 'vitest'
import { cloudwatch, putMetric } from '../../lambda/aws'

describe('aws module', () => {
  it('putMetric does not throw when cloudwatch send fails', async () => {
    vi.spyOn(cloudwatch, 'send').mockRejectedValueOnce(new Error('boom'))
    await expect(putMetric('X', 1, 'cpu', 'vector')).resolves.toBeUndefined()
  })
})

