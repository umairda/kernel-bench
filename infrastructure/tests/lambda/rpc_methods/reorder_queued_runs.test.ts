import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/reorder_queued_runs', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
  })

  it('rewrites queued timestamps in requested priority order', async () => {
    const ddb = { send: vi.fn() }
    const runs: Record<string, any> = {
      'run-1': { runId: 'run-1', runner: 'cpu', status: 'QUEUED', queuedAt: '2026-05-03T10:00:00.000Z', createdAt: '2026-05-03T10:00:00.000Z' },
      'run-2': { runId: 'run-2', runner: 'cpu', status: 'QUEUED', queuedAt: '2026-05-03T10:01:00.000Z', createdAt: '2026-05-03T10:01:00.000Z' },
    }
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'GetCommand') {
        return { Item: runs[command.input.Key.runId] }
      }
      return {}
    })
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb }
    })

    const { rpcReorderQueuedRuns } = await import('../../../lambda/rpc_methods/reorder_queued_runs')
    const out = await rpcReorderQueuedRuns({ runIds: ['run-2', 'run-1'] })

    expect(out).toMatchObject({ ok: true })
    const updateInputs = ddb.send.mock.calls
      .map(([command]: any[]) => command)
      .filter((command: any) => command.constructor.name === 'UpdateCommand')
      .map((command: any) => command.input)
    expect(updateInputs).toHaveLength(2)
    expect(updateInputs[0]).toMatchObject({
      Key: { runId: 'run-2' },
      ExpressionAttributeValues: expect.objectContaining({ ':priority': 1 }),
    })
    expect(updateInputs[1]).toMatchObject({
      Key: { runId: 'run-1' },
      ExpressionAttributeValues: expect.objectContaining({ ':priority': 2 }),
    })
    expect(updateInputs[0].ExpressionAttributeValues[':queuedAt'].localeCompare(updateInputs[1].ExpressionAttributeValues[':queuedAt'])).toBeLessThan(0)
  })

  it('rejects non-queued runs', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({ Item: { runId: 'run-1', runner: 'cpu', status: 'RUNNING' } }) }
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb }
    })

    const { rpcReorderQueuedRuns } = await import('../../../lambda/rpc_methods/reorder_queued_runs')
    await expect(rpcReorderQueuedRuns({ runIds: ['run-1'] })).rejects.toMatchObject({
      code: -32011,
      message: 'only queued runs can be reordered',
    })
  })
})
