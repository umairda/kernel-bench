import { StartExecutionCommand } from '@aws-sdk/client-sfn'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'
import { makeS3Prefix, nowIso, publicRunView, runTimestamp } from '../common'
import {
  RUNS_TABLE_NAME,
  CPU_INSTANCE_ID,
  GPU_INSTANCE_ID,
  JsonRpcError,
  Runner,
  Benchmark,
  asObject,
  validateBenchmarkParams,
  acquireRunnerLock,
  putMetric,
} from './shared'
import { sfn, ddb } from '../aws'

const RUN_WORKFLOW_STATE_MACHINE_ARN = process.env.RUN_WORKFLOW_STATE_MACHINE_ARN!

type StartRunParams = {
  runner: Runner
  benchmark: Benchmark
  params: Record<string, unknown>
}

export async function rpcStartRun(rawParams: unknown) {
  const payload = asObject(rawParams) as StartRunParams
  const runner = payload.runner
  const benchmark = payload.benchmark
  if (runner !== 'cpu' && runner !== 'gpu') {
    throw new JsonRpcError(-32602, 'runner must be one of: cpu, gpu')
  }
  if (benchmark !== 'vector' && benchmark !== 'matrix-multiplication' && benchmark !== 'convolution') {
    throw new JsonRpcError(-32602, 'benchmark must be one of: vector, matrix-multiplication, convolution')
  }

  const normalizedParams = validateBenchmarkParams(benchmark, asObject(payload.params))
  const runId = uuidv4()
  const createdAt = nowIso()
  const timestamp = runTimestamp()
  const s3Prefix = makeS3Prefix(benchmark, normalizedParams, timestamp, runner)
  const instanceId = runner === 'cpu' ? CPU_INSTANCE_ID : GPU_INSTANCE_ID

  const lock = await acquireRunnerLock(runner, runId)
  if (!lock.ok) {
    await putMetric('RunnerBusy', 1, runner, benchmark)
    throw new JsonRpcError(-32009, `${runner} runner already has an active run`, { runner, activeRunId: lock.activeRunId })
  }

  const item = {
    runId,
    runner,
    benchmark,
    params: normalizedParams,
    status: 'STARTING',
    instanceId,
    s3Prefix,
    createdAt,
    updatedAt: createdAt,
    startupProgress: {
      phase: 'QUEUED',
      ec2State: 'unknown',
      instanceStatus: 'unknown',
      systemStatus: 'unknown',
      ssmPingStatus: 'unknown',
      detail: 'Run accepted and queued for workflow execution',
      observedAt: createdAt,
    },
  }

  await ddb.send(new PutCommand({ TableName: RUNS_TABLE_NAME, Item: item }))
  await sfn.send(new StartExecutionCommand({
    stateMachineArn: RUN_WORKFLOW_STATE_MACHINE_ARN,
    name: runId,
    input: JSON.stringify(item),
  }))

  await putMetric('RunStarted', 1, runner, benchmark)
  return publicRunView({ ...item, ssmStatus: 'Pending', responseCode: -1 })
}
