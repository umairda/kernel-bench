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

  it('writeHistoryRecord uses a stable per-run sort key', async () => {
    const ddb = { send: vi.fn() }
    vi.doMock('../../lambda/aws', () => ({ ddb }))
    const { writeHistoryRecord } = await import('../../lambda/history')

    await writeHistoryRecord({
      runId: 'run-1',
      benchmark: 'vector',
      runner: 'cpu',
      params: { vectorLength: 10 },
      createdAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:10Z',
      performance: {
        totalDurationMs: 1,
        operationDurations: [{ name: 'vector-add', durationMs: 1 }],
      },
    })

    expect(ddb.send).toHaveBeenCalledOnce()
    expect(ddb.send.mock.calls[0][0].input.Item.completedAtRunId).toBe('2026-01-01T00:00:00Z#run-1')
  })

  it('queryHistory dedupes repeated writes for the same run', async () => {
    const ddb = { send: vi.fn() }
    ddb.send
      .mockResolvedValueOnce({
        Items: [
          { runId: 'r1', completedAt: '2026-01-01T00:00:01Z', runner: 'cpu', value: 'old' },
          { runId: 'r1', completedAt: '2026-01-01T00:00:02Z', runner: 'cpu', value: 'new' },
        ],
      })
    vi.doMock('../../lambda/aws', () => ({ ddb }))
    const { queryHistory } = await import('../../lambda/history')

    const out = await queryHistory('vector', 'cpu')

    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('new')
  })
})
