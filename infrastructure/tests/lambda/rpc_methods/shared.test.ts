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

  it('parses progress lines without undefined fields', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    const progress = shared.parseProgressLine('KERNEL_BENCH_PROGRESS op=matmul backend=cpu status=running heartbeat=1 rows_done=81 total_rows=10000')

    expect(progress).toMatchObject({
      op: 'matmul',
      backend: 'cpu',
      status: 'running',
      heartbeat: 1,
      rowsDone: 81,
      totalRows: 10000,
    })
    expect(Object.values(progress ?? {})).not.toContain(undefined)
  })

  it('parses vector element progress lines', async () => {
    const shared = await import('../../../lambda/rpc_methods/shared')
    const progress = shared.parseProgressLine('KERNEL_BENCH_PROGRESS op=vector-add backend=cpu status=running heartbeat=1 elements_done=1000000 total_elements=10000000')

    expect(progress).toMatchObject({
      op: 'vector-add',
      backend: 'cpu',
      status: 'running',
      heartbeat: 1,
      elementsDone: 1000000,
      totalElements: 10000000,
    })
  })

  it('reads latest progress from the exact SSM stdout log stream', async () => {
    const cloudwatchLogs = {
      send: vi.fn().mockResolvedValue({
        events: [
          {
            timestamp: 100,
            message: 'KERNEL_BENCH_PROGRESS op=matmul backend=cpu status=running rows_done=10 total_rows=100\n',
          },
          {
            timestamp: 200,
            message: 'KERNEL_BENCH_PROGRESS op=matmul backend=cpu status=running rows_done=25 total_rows=100\n',
          },
        ],
      }),
    }

    vi.doMock('../../../lambda/aws', () => ({
      cloudwatchLogs,
      ddb: { send: vi.fn() },
      ec2: { send: vi.fn() },
      putMetric: vi.fn(),
      s3: { send: vi.fn() },
      sfn: { send: vi.fn() },
      ssm: { send: vi.fn() },
    }))

    const shared = await import('../../../lambda/rpc_methods/shared')
    const progress = await shared.extractLatestProgressFromLogs('cmd-1', 'i-123')

    expect(cloudwatchLogs.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        logGroupName: '/kernelbench/ssm-output',
        logStreamName: 'cmd-1/i-123/aws-runShellScript/stdout',
        startFromHead: false,
        limit: 50,
      }),
    }))
    expect(progress).toMatchObject({
      op: 'matmul',
      backend: 'cpu',
      status: 'running',
      rowsDone: 25,
      totalRows: 100,
    })
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
