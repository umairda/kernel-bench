import { beforeEach, vi } from 'vitest'

export function makeAwsMocks() {
  return {
    ddb: { send: vi.fn() },
    ec2: { send: vi.fn() },
    ssm: { send: vi.fn() },
    s3: { send: vi.fn() },
    sfn: { send: vi.fn() },
    putMetric: vi.fn().mockResolvedValue(undefined),
  }
}

export function baseEvent(overrides: Record<string, any> = {}) {
  return {
    headers: { 'x-kernelbench-origin': 'secret' },
    body: '{}',
    pathParameters: {},
    ...overrides,
  } as any
}

export function setupEnv() {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.ORIGIN_VERIFY_SECRET = 'secret'
    process.env.RUNS_TABLE_NAME = 'Runs'
    process.env.ARTIFACT_BUCKET_NAME = 'Artifacts'
    process.env.CPU_INSTANCE_ID = 'i-cpu'
    process.env.GPU_INSTANCE_ID = 'i-gpu'
    process.env.RUN_WORKFLOW_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:kb'
    process.env.SOURCE_ARCHIVE_KEY = 'kernel-bench/source/latest.tar.gz'
    process.env.COMMAND_ID_INDEX_NAME = 'commandId-index'
    process.env.RUN_STALE_MINUTES = '45'
    process.env.IDLE_INSTANCE_MINUTES = '10'
    process.env.STARTING_STALE_SECONDS = '180'
  })
}
