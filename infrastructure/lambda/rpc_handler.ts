import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { isOriginVerified, JsonRpcError, jsonRpcFailure, jsonRpcSuccess, parseJsonRpcBody, response } from './common'
import {
  rpcDeleteQueuedRun,
  rpcReorderQueuedRuns,
  rpcHistoryConvolution,
  rpcHistoryMatmul,
  rpcHistoryVector,
  rpcInProgressRuns,
  rpcInstanceStates,
  rpcRunHistory,
  rpcRunStatus,
  rpcStartRun,
} from './rpc_methods'

const METHODS: Record<string, (params: unknown) => Promise<unknown>> = {
  startRun: rpcStartRun,
  deleteQueuedRun: rpcDeleteQueuedRun,
  reorderQueuedRuns: rpcReorderQueuedRuns,
  getRunStatus: rpcRunStatus,
  listInProgressRuns: rpcInProgressRuns,
  getInstanceStates: rpcInstanceStates,
  historyVector: rpcHistoryVector,
  historyMatmul: rpcHistoryMatmul,
  historyConvolution: rpcHistoryConvolution,
  runHistory: rpcRunHistory,
}

export async function handler(event: APIGatewayProxyEventV2) {
  if (!isOriginVerified(event)) return response(403, { error: 'origin not allowed' })

  let id: string | number | null | undefined = null
  try {
    const request = parseJsonRpcBody(event)
    id = request.id
    const method = METHODS[request.method as string]
    if (!method) {
      throw new JsonRpcError(-32601, 'method not found', { method: request.method })
    }
    const result = await method(request.params)
    return jsonRpcSuccess(id, result)
  } catch (error: any) {
    if (error instanceof JsonRpcError) {
      return jsonRpcFailure(id, error)
    }
    if (error instanceof SyntaxError) {
      return jsonRpcFailure(id, new JsonRpcError(-32700, 'parse error'))
    }
    return jsonRpcFailure(id, new JsonRpcError(-32000, String(error?.message ?? error)))
  }
}
