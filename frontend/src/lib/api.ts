import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type Runner = 'cpu' | 'gpu'
export type Benchmark = 'vector' | 'matrix-multiplication' | 'convolution'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const JSON_RPC_VERSION = '2.0'

export type StartRunRequest = {
  runner: Runner
  benchmark: Benchmark
  params: Record<string, number>
}

export class ApiRequestError extends Error {
  status: number
  code?: number
  data?: unknown
  body?: unknown

  constructor(message: string, status: number, options?: { code?: number; data?: unknown; body?: unknown }) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = options?.code
    this.data = options?.data
    this.body = options?.body
  }
}

export type RunRecord = {
  runId: string
  status: 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  benchmark: Benchmark
  runner: Runner
  params: Record<string, number>
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  responseCode?: number
  ssmStatus?: string
  startupProgress?: {
    phase?: string
    ec2State?: string
    instanceStatus?: string
    systemStatus?: string
    ssmPingStatus?: string
    detail?: string
    observedAt?: string
  }
  progress?: {
    op?: string
    backend?: string
    status?: string
    phase?: string
    detail?: string
    rowsDone?: number
    totalRows?: number
    percent?: number
    elapsedMs?: number
    elapsedS?: number
    etaS?: number
    heartbeat?: number
    detailed?: number
    observedAt?: string
  }
  performance?: {
    totalDurationMs?: number
    phaseDurationsMs?: {
      queueStartRequestMs?: number
      instanceBootSsmReadyMs?: number
      buildSetupMs?: number
      benchmarkExecutionMs?: number
      uploadFinalizationMs?: number
    }
    operationDurations?: Array<{
      name: string
      durationMs: number
    }>
  }
}

export type RunHistoryRow = RunRecord

export type VectorHistoryPoint = {
  runId: string
  runner: Runner
  completedAt?: string
  vectorLength: number
  addMs: number | null
  subtractMs: number | null
  multiplyMs: number | null
  divideMs: number | null
  totalDurationMs: number | null
}

export type MatmulHistoryPoint = {
  runId: string
  runner: Runner
  completedAt?: string
  size: number | null
  inputRows: number
  inputCols: number
  outputCols: number
  matmulMs: number | null
  totalDurationMs: number | null
}

export type ConvolutionHistoryPoint = {
  runId: string
  runner: Runner
  completedAt?: string
  inputN: number
  inputC: number
  inputH: number
  inputW: number
  filterOutC: number
  filterH: number
  filterW: number
  strideH: number
  strideW: number
  padH: number
  padW: number
  inputArea: number
  filterArea: number
  convolutionMs: number | null
  totalDurationMs: number | null
}

type JsonRpcSuccess<T> = {
  jsonrpc: '2.0'
  id: string
  result: T
}

type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: string | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export const queryKeys = {
  runStatus: (runId: string | null) => ['run-status', runId] as const,
  inProgressRuns: () => ['in-progress-runs'] as const,
  instanceStates: () => ['instance-states'] as const,
  vectorHistory: (runner: Runner | 'all') => ['history', 'vector', runner] as const,
  matmulHistory: (runner: Runner | 'all') => ['history', 'matmul', runner] as const,
  convolutionHistory: (runner: Runner | 'all') => ['history', 'convolution', runner] as const,
  runHistory: () => ['history', 'runs'] as const,
}

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const res = await fetch(`${API_BASE}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params: params ?? {},
    }),
  })

  const raw = await res.text()
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    if (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html')) {
      throw new ApiRequestError(`Request failed: ${res.status} (non-JSON error from upstream)`, res.status, { body: raw })
    }
    throw new ApiRequestError(`Request failed: ${res.status}`, res.status, { body })
  }

  if (body && typeof body === 'object' && 'error' in body) {
    const failure = body as JsonRpcFailure
    throw new ApiRequestError(failure.error.message, res.status, {
      code: failure.error.code,
      data: failure.error.data,
      body,
    })
  }

  return (body as JsonRpcSuccess<T>).result
}

export function startRun(payload: StartRunRequest) {
  return rpc<RunRecord>('startRun', payload)
}

export function getRunStatus(runId: string) {
  return rpc<RunRecord>('getRunStatus', { runId })
}

export function listInProgressRuns() {
  return rpc<{ items: RunRecord[] }>('listInProgressRuns')
}

export function getInstanceStates() {
  return rpc<{ cpu: string; gpu: string }>('getInstanceStates')
}

export function getVectorHistory(runner: Runner | 'all' = 'all') {
  return rpc<{ items: VectorHistoryPoint[] }>('historyVector', { runner })
}

export function getMatmulHistory(runner: Runner | 'all' = 'all') {
  return rpc<{ items: MatmulHistoryPoint[] }>('historyMatmul', { runner, squareOnly: true })
}

export function getConvolutionHistory(runner: Runner | 'all' = 'all') {
  return rpc<{ items: ConvolutionHistoryPoint[] }>('historyConvolution', { runner })
}

export function getRunHistory() {
  return rpc<{ items: RunHistoryRow[] }>('runHistory')
}

async function startRunWithRecovery(payload: StartRunRequest) {
  try {
    return await startRun(payload)
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === -32009 && error.data && typeof error.data === 'object') {
      const activeRunId = (error.data as { activeRunId?: unknown }).activeRunId
      if (typeof activeRunId === 'string' && activeRunId.length > 0) {
        return await getRunStatus(activeRunId)
      }
    }
    throw error
  }
}

export function useStartRunMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: startRunWithRecovery,
    onSuccess: (run) => {
      queryClient.setQueryData(queryKeys.runStatus(run.runId), run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.inProgressRuns() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.instanceStates() })
    },
  })
}

export function useGetRunStatusQuery(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.runStatus(runId),
    queryFn: () => getRunStatus(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (!status || status === 'STARTING' || status === 'RUNNING') {
        return 2000
      }
      return false
    },
  })
}

export function useListInProgressRunsQuery() {
  return useQuery({
    queryKey: queryKeys.inProgressRuns(),
    queryFn: listInProgressRuns,
    refetchInterval: 4000,
  })
}

export function useGetInstanceStatesQuery() {
  return useQuery({
    queryKey: queryKeys.instanceStates(),
    queryFn: getInstanceStates,
    refetchInterval: 3000,
  })
}

export function useGetVectorHistoryQuery(runner: Runner | 'all' = 'all') {
  return useQuery({
    queryKey: queryKeys.vectorHistory(runner),
    queryFn: () => getVectorHistory(runner),
  })
}

export function useGetMatmulHistoryQuery(runner: Runner | 'all' = 'all') {
  return useQuery({
    queryKey: queryKeys.matmulHistory(runner),
    queryFn: () => getMatmulHistory(runner),
  })
}

export function useGetConvolutionHistoryQuery(runner: Runner | 'all' = 'all') {
  return useQuery({
    queryKey: queryKeys.convolutionHistory(runner),
    queryFn: () => getConvolutionHistory(runner),
  })
}

export function useGetRunHistoryQuery() {
  return useQuery({
    queryKey: queryKeys.runHistory(),
    queryFn: getRunHistory,
    refetchInterval: 5000,
  })
}
