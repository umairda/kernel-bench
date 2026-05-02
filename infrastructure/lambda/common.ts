import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

export const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])
export const JSON_RPC_VERSION = '2.0'

export class JsonRpcError extends Error {
  code: number
  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function runTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  }
}

export function parseJsonBody<T = Record<string, unknown>>(event: APIGatewayProxyEventV2): T {
  if (!event.body) return {} as T
  return JSON.parse(event.body) as T
}

export function parseJsonRpcBody(event: APIGatewayProxyEventV2): JsonRpcRequest {
  const body = parseJsonBody<JsonRpcRequest>(event)
  if (body.jsonrpc !== JSON_RPC_VERSION) {
    throw new JsonRpcError(-32600, 'invalid request', { reason: 'jsonrpc must be 2.0' })
  }
  if (typeof body.method !== 'string' || body.method.length === 0) {
    throw new JsonRpcError(-32600, 'invalid request', { reason: 'method is required' })
  }
  return body
}

export function jsonRpcSuccess(id: string | number | null | undefined, result: unknown): APIGatewayProxyResultV2 {
  return response(200, { jsonrpc: JSON_RPC_VERSION, id: id ?? null, result })
}

export function jsonRpcFailure(id: string | number | null | undefined, error: JsonRpcError): APIGatewayProxyResultV2 {
  const body: Record<string, unknown> = {
    jsonrpc: JSON_RPC_VERSION,
    id: id ?? null,
    error: {
      code: error.code,
      message: error.message,
    },
  }
  if (error.data !== undefined) {
    ;(body.error as Record<string, unknown>).data = error.data
  }
  return response(200, body)
}

export function isOriginVerified(event: APIGatewayProxyEventV2): boolean {
  const expected = process.env.ORIGIN_VERIFY_SECRET ?? ''
  const headers = event.headers ?? {}
  const supplied = headers['x-kernelbench-origin'] ?? headers['X-Kernelbench-Origin']
  if (expected && supplied === expected) return true

  return !expected
}

export function makeS3Prefix(benchmark: string, params: Record<string, number>, timestamp: string, runner: string): string {
  if (benchmark === 'vector') {
    return `kernel-bench/vector/${params.vectorLength}/${timestamp}/${runner}/`
  }
  if (benchmark === 'matrix-multiplication') {
    return `kernel-bench/matrix-multiplication/${params.inputRows}-${params.inputCols}-${params.outputCols}/${timestamp}/${runner}/`
  }
  const key = `${params.inputN}-${params.inputC}-${params.inputH}-${params.inputW}-${params.filterOutC}-${params.filterH}-${params.filterW}-${params.strideH}-${params.strideW}-${params.padH}-${params.padW}`
  return `kernel-bench/convolution/${key}/${timestamp}/${runner}/`
}

export function mapSsmStatus(ssmStatus: string): string {
  if (['Pending', 'InProgress', 'Delayed'].includes(ssmStatus)) return 'RUNNING'
  if (ssmStatus === 'Success') return 'COMPLETED'
  if (['Cancelled', 'Cancelling', 'TimedOut'].includes(ssmStatus)) return 'CANCELLED'
  return 'FAILED'
}

export function reasonFromSsm(mapped: string, ssmStatus: string, responseCode: number): string {
  if (mapped === 'COMPLETED') return 'COMPLETED_SUCCESS'
  if (mapped === 'CANCELLED') {
    if (ssmStatus === 'TimedOut') return 'SSM_COMMAND_TIMED_OUT'
    return 'SSM_COMMAND_CANCELLED'
  }
  if (mapped === 'FAILED') {
    if (responseCode === 137) return 'PROCESS_KILLED_OOM_OR_SIGNAL'
    return 'SSM_COMMAND_FAILED'
  }
  return 'UNKNOWN'
}

export function normalizeOperationDurations(source: any): Array<{ name: string; durationMs: number }> {
  const sourceOps = Array.isArray(source?.operationDurations) ? source.operationDurations : (Array.isArray(source?.operations) ? source.operations : [])
  return sourceOps
    .map((op: any) => ({ name: op.name ?? op.operationType, durationMs: op.durationMs }))
    .filter((op: any) => op.name != null && op.durationMs != null)
}

export function normalizePerformance(source: any) {
  if (!source) return undefined
  return {
    totalDurationMs: source.totalDurationMs,
    phaseDurationsMs: typeof source.phaseDurationsMs === 'object' && source.phaseDurationsMs ? source.phaseDurationsMs : {},
    operationDurations: normalizeOperationDurations(source),
  }
}

export function publicRunView(item: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {
    runId: item.runId,
    runner: item.runner,
    benchmark: item.benchmark,
    params: item.params ?? {},
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    ssmStatus: item.ssmStatus,
    responseCode: item.responseCode ?? -1,
  }
  if (item.reason) out.reason = item.reason
  if (item.error) out.error = item.error
  if (item.startupProgress && typeof item.startupProgress === 'object') {
    out.startupProgress = item.startupProgress
  }
  if (item.progress && typeof item.progress === 'object') {
    out.progress = item.progress
  }
  const normalizedPerformance = normalizePerformance(item.performance)
  if (normalizedPerformance) {
    out.performance = normalizedPerformance
  }
  return out
}
