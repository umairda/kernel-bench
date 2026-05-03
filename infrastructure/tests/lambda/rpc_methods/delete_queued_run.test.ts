import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/delete_queued_run', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.RUN_WORKFLOW_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:kb'
  })

  it('deletes a queued run and kicks the dispatcher', async () => {
    const ddb = { send: vi.fn() }
    const dispatchNextQueuedRun = vi.fn().mockResolvedValue({ started: false, reason: 'empty' })
    ddb.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'GetCommand') {
        return { Item: { runId: 'run-1', runner: 'cpu', status: 'QUEUED' } }
      }
      return {}
    })
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb }
    })
    vi.doMock('../../../lambda/run_queue', () => ({ dispatchNextQueuedRun }))

    const { rpcDeleteQueuedRun } = await import('../../../lambda/rpc_methods/delete_queued_run')
    const out = await rpcDeleteQueuedRun({ runId: 'run-1' })

    expect(out).toEqual({ ok: true, runId: 'run-1', runner: 'cpu' })
    expect(ddb.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(['GetCommand', 'DeleteCommand'])
    expect(dispatchNextQueuedRun).toHaveBeenCalledWith('cpu')
  })

  it('rejects non-queued runs', async () => {
    const ddb = { send: vi.fn().mockResolvedValue({ Item: { runId: 'run-1', runner: 'cpu', status: 'RUNNING' } }) }
    vi.doMock('../../../lambda/aws', async () => {
      const actual = await vi.importActual<any>('../../../lambda/aws')
      return { ...actual, ddb }
    })
    vi.doMock('../../../lambda/run_queue', () => ({ dispatchNextQueuedRun: vi.fn() }))

    const { rpcDeleteQueuedRun } = await import('../../../lambda/rpc_methods/delete_queued_run')
    await expect(rpcDeleteQueuedRun({ runId: 'run-1' })).rejects.toMatchObject({
      code: -32011,
      message: 'only queued runs can be deleted',
    })
  })
})
