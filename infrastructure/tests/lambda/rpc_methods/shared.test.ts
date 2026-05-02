import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('rpc_methods/shared', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.ARTIFACT_BUCKET_NAME = 'Artifacts'
    process.env.CPU_INSTANCE_ID = 'i-cpu'
    process.env.GPU_INSTANCE_ID = 'i-gpu'
    process.env.STARTING_STALE_SECONDS = '1'
    process.env.RUN_WORKFLOW_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:kb'
  })

  it('validates object params and integers', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    expect(() => shared.asObject({ a: 1 })).not.toThrow()
    expect(() => shared.toInt({ x: 3 }, 'x', 1)).not.toThrow()
    expect(() => shared.toInt({ x: 0 }, 'x', 1)).toThrow()
  })

  it('parses run ids and runners', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    expect(shared.parseRunId({ runId: 'r1' })).toBe('r1')
    expect(shared.parseRunner('cpu')).toBe('cpu')
    expect(() => shared.parseRunner('bad')).toThrow()
  })

  it('can release a runner lock without aborting in-flight workflow execution', async () => {
    const ddb = { send: vi.fn().mockResolvedValue(undefined) }
    const ssm = { send: vi.fn() }
    const sfn = { send: vi.fn() }
    const ec2 = { send: vi.fn() }
    const s3 = { send: vi.fn() }
    const putMetric = vi.fn()

    vi.doMock('../../../lambda/aws', () => ({ ddb, ssm, sfn, ec2, s3, putMetric }))

    const shared = await import('../../../lambda/rpc_methods/shared')
    await shared.releaseRunnerLock('gpu', 'run-1', { cancelInFlight: false })

    expect(ddb.send).toHaveBeenCalledTimes(1)
    expect(ssm.send).not.toHaveBeenCalled()
    expect(sfn.send).not.toHaveBeenCalled()
  })
})
