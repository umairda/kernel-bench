import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('history', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.HISTORY_TABLE_NAME = 'History'
  })

  it('writeHistoryRecord is a no-op without completedAt/performance', async () => {
    const ddb = { send: vi.fn() }
    vi.doMock('../../lambda/aws', () => ({ ddb }))
    const { writeHistoryRecord } = await import('../../lambda/history')
    await writeHistoryRecord({ runId: 'r', benchmark: 'vector', runner: 'cpu', params: {} as any })
    expect(ddb.send).not.toHaveBeenCalled()
  })

  it('queryHistory merges/sorts cpu and gpu', async () => {
    const ddb = { send: vi.fn() }
    ddb.send
      .mockResolvedValueOnce({ Items: [{ completedAt: '2026-01-01T00:00:01Z', runner: 'cpu' }] })
      .mockResolvedValueOnce({ Items: [{ completedAt: '2026-01-01T00:00:02Z', runner: 'gpu' }] })
    vi.doMock('../../lambda/aws', () => ({ ddb }))
    const { queryHistory } = await import('../../lambda/history')
    const out = await queryHistory('vector', 'all')
    expect(out).toHaveLength(2)
    expect(out[1].runner).toBe('gpu')
  })
})

