import { describe, expect, it } from 'vitest'
import {
  JsonRpcError,
  jsonRpcFailure,
  jsonRpcSuccess,
  makeS3Prefix,
  mapSsmStatus,
  normalizePerformance,
  parseJsonRpcBody,
  publicRunView,
} from '../../lambda/common'

describe('common', () => {
  it('parses JSON-RPC request', () => {
    const parsed = parseJsonRpcBody({ body: JSON.stringify({ jsonrpc: '2.0', method: 'x', id: 1 }), headers: {} } as any)
    expect(parsed.method).toBe('x')
  })

  it('maps SSM status', () => {
    expect(mapSsmStatus('Success')).toBe('COMPLETED')
    expect(mapSsmStatus('TimedOut')).toBe('CANCELLED')
  })

  it('builds s3 prefixes', () => {
    expect(makeS3Prefix('vector', { vectorLength: 10 }, 't', 'cpu')).toContain('/vector/10/')
  })

  it('normalizes performance payload', () => {
    const perf = normalizePerformance({ totalDurationMs: 1, operations: [{ operationType: 'vector-add', durationMs: 3 }] })
    expect(perf?.operationDurations[0].name).toBe('vector-add')
  })

  it('builds json rpc success/failure envelopes', () => {
    const ok = jsonRpcSuccess(1, { ok: true })
    const err = jsonRpcFailure(1, new JsonRpcError(-1, 'bad'))
    expect(String(ok.body)).toContain('"result"')
    expect(String(err.body)).toContain('"error"')
  })

  it('publicRunView keeps whitelisted fields', () => {
    const v = publicRunView({ runId: 'r', runner: 'cpu', benchmark: 'vector', params: {}, status: 'RUNNING', responseCode: 0 })
    expect(v.runId).toBe('r')
  })

  it('publicRunView includes structured failure diagnostics', () => {
    const v = publicRunView({
      runId: 'r',
      runner: 'gpu',
      benchmark: 'convolution',
      params: {},
      status: 'FAILED',
      failureDiagnostics: { classification: 'HOST_OOM_KILLED' },
    })
    expect(v.failureDiagnostics).toEqual({ classification: 'HOST_OOM_KILLED' })
  })
})
