import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
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
  benchmarkChoices,
  validateBenchmarkParams,
  isBenchmark,
  putMetric,
  runnerInstanceType,
} from './shared'
import { ddb } from '../aws'
import { dispatchNextQueuedRun } from '../run_queue'

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
  if (!isBenchmark(benchmark)) {
    throw new JsonRpcError(-32602, `benchmark must be one of: ${benchmarkChoices()}`)
  }

  const normalizedParams = validateBenchmarkParams(benchmark, asObject(payload.params))
  const runId = uuidv4()
  const createdAt = nowIso()
  const timestamp = runTimestamp()
  const s3Prefix = makeS3Prefix(benchmark, normalizedParams, timestamp, runner)
  const instanceId = runner === 'cpu' ? CPU_INSTANCE_ID : GPU_INSTANCE_ID
  const instanceType = runnerInstanceType(runner)

  const item = {
    runId,
    runner,
    benchmark,
    params: normalizedParams,
    status: 'QUEUED',
    instanceId,
    instanceType,
    s3Prefix,
    createdAt,
    queuedAt: createdAt,
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
  await putMetric('RunQueued', 1, runner, benchmark)
  await dispatchNextQueuedRun(runner)

  const latest = await ddb.send(new GetCommand({ TableName: RUNS_TABLE_NAME, Key: { runId } }))
  return publicRunView((latest.Item as Record<string, any>) ?? { ...item, ssmStatus: 'Pending', responseCode: -1 })
}
