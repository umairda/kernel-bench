import { describe, expect, it, vi } from 'vitest'
import { makeAwsMocks, setupEnv } from './_test_utils'

describe('run_workflow_step', () => {
  setupEnv()

  it('START_AND_WAIT returns not-ready while instance is stopping', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({})
    aws.ec2.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return { Reservations: [{ Instances: [{ State: { Name: 'stopping' } }] }] }
      }
      throw new Error(`unexpected EC2 command: ${command.constructor.name}`)
    })
    vi.doMock('../../lambda/aws', () => aws)

    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'START_AND_WAIT',
      runId: 'r1',
      runner: 'gpu',
      benchmark: 'vector',
      params: { vectorLength: 10 },
      instanceId: 'i-gpu',
      s3Prefix: 'x/',
      createdAt: '2026-01-01T00:00:00Z',
      dispatchStartedAt: '2026-01-01T00:00:00Z',
    } as any, {} as any)

    expect(out.status).toBe('STARTING')
    expect(out.startup).toEqual({ isReady: false, phase: 'WAITING_FOR_INSTANCE_STOPPED' })
    expect(aws.ssm.send).not.toHaveBeenCalled()
  })

  it('START_AND_WAIT starts stopped instances and asks workflow to retry', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({})
    aws.ec2.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return { Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }] }
      }
      if (command.constructor.name === 'StartInstancesCommand') {
        return {}
      }
      throw new Error(`unexpected EC2 command: ${command.constructor.name}`)
    })
    vi.doMock('../../lambda/aws', () => aws)

    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'START_AND_WAIT',
      runId: 'r1',
      runner: 'gpu',
      benchmark: 'vector',
      params: { vectorLength: 10 },
      instanceId: 'i-gpu',
      s3Prefix: 'x/',
      createdAt: '2026-01-01T00:00:00Z',
      dispatchStartedAt: '2026-01-01T00:00:00Z',
    } as any, {} as any)

    expect(out.status).toBe('STARTING')
    expect(out.startup).toEqual({ isReady: false, phase: 'STARTING_INSTANCE' })
    expect(aws.ec2.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ InstanceIds: ['i-gpu'] }),
    }))
    expect(aws.ssm.send).not.toHaveBeenCalled()
  })

  it('START_AND_WAIT returns ready when EC2 is running and SSM is online', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({})
    aws.ec2.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'DescribeInstancesCommand') {
        return { Reservations: [{ Instances: [{ State: { Name: 'running' } }] }] }
      }
      if (command.constructor.name === 'DescribeInstanceStatusCommand') {
        return { InstanceStatuses: [{ InstanceStatus: { Status: 'ok' }, SystemStatus: { Status: 'ok' } }] }
      }
      throw new Error(`unexpected EC2 command: ${command.constructor.name}`)
    })
    aws.ssm.send.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'DescribeInstanceInformationCommand') {
        return { InstanceInformationList: [{ PingStatus: 'Online' }] }
      }
      throw new Error(`unexpected SSM command: ${command.constructor.name}`)
    })
    vi.doMock('../../lambda/aws', () => aws)

    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'START_AND_WAIT',
      runId: 'r1',
      runner: 'gpu',
      benchmark: 'vector',
      params: { vectorLength: 10 },
      instanceId: 'i-gpu',
      s3Prefix: 'x/',
      createdAt: new Date(Date.now() - 1000).toISOString(),
      dispatchStartedAt: new Date(Date.now() - 1000).toISOString(),
    } as any, {} as any)

    expect(out.status).toBe('STARTING')
    expect(out.startup).toEqual({ isReady: true, phase: 'RUNNER_READY' })
    expect(out.launchTiming.instanceBootSsmReadyMs).toBeGreaterThanOrEqual(0)
  })

  it('DISPATCH applies the computed timeout to the shell execution timeout', async () => {
    const aws = makeAwsMocks()
    process.env.BASE_COMMAND_TIMEOUT_SECONDS = String(90 * 60)
    process.env.MAX_COMMAND_TIMEOUT_SECONDS = String(6 * 60 * 60)
    aws.ddb.send.mockResolvedValue({})
    aws.ssm.send.mockResolvedValue({ Command: { CommandId: 'cmd-1' } })
    vi.doMock('../../lambda/aws', () => aws)

    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'DISPATCH',
      runId: 'r1',
      runner: 'cpu',
      benchmark: 'vector',
      params: { vectorLength: 10 },
      instanceId: 'i-cpu',
      s3Prefix: 'x/',
      createdAt: '2026-01-01T00:00:00Z',
    } as any, {} as any)

    const commandInput = aws.ssm.send.mock.calls[0][0].input
    expect(out.commandId).toBe('cmd-1')
    expect(commandInput.TimeoutSeconds).toBe(90 * 60)
    expect(commandInput.Parameters.executionTimeout).toEqual([String(90 * 60)])
  })

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

  it('FINALIZE promotes failure diagnostics from S3', async () => {
    const aws = makeAwsMocks()
    aws.ddb.send.mockResolvedValue({})
    aws.ec2.send.mockResolvedValue({})
    aws.ssm.send.mockResolvedValue({
      Status: 'Failed',
      ResponseCode: 1,
      StandardOutputContent: '',
    })
    aws.s3.send.mockImplementation(async (command: any) => {
      if (command.input.Key.endsWith('failure_diagnostics.json')) {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              classification: 'HOST_OOM_KILLED',
              returnCode: -9,
              signalName: 'SIGKILL',
              cgroup: { available: true, memoryPeakBytes: 123456789, oomKillDelta: 1 },
              gpuMemory: { available: true, peakUsedMiB: 1234, totalMiB: 49140 },
            }),
          },
        }
      }
      throw new Error('not found')
    })
    vi.doMock('../../lambda/aws', () => aws)

    const { handler } = await import('../../lambda/instance_actions/run_workflow_step')
    const out = await handler({
      action: 'FINALIZE',
      runId: 'r1',
      runner: 'gpu',
      benchmark: 'convolution',
      params: { inputN: 1 },
      instanceId: 'i-gpu',
      s3Prefix: 'x/',
      createdAt: '2026-01-01T00:00:00Z',
      commandId: 'cmd-1',
      poll: { isTerminal: true, mappedStatus: 'FAILED', ssmStatus: 'Failed', responseCode: 1 },
    } as any, {} as any)

    const update = aws.ddb.send.mock.calls.find((call) => String(call[0].input?.UpdateExpression ?? '').includes('failureDiagnostics'))?.[0].input
    expect(out.status).toBe('FAILED')
    expect(update.ExpressionAttributeValues[':reason']).toBe('HOST_OOM_KILLED')
    expect(update.ExpressionAttributeValues[':failureDiagnostics'].classification).toBe('HOST_OOM_KILLED')
    expect(update.ExpressionAttributeValues[':error']).toContain('SIGKILL')
  })
})
