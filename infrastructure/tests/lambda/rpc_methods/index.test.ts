import { describe, expect, it } from 'vitest'
import * as methods from '../../../lambda/rpc_methods'

describe('rpc_methods/index', () => {
  it('exports all rpc method functions', () => {
    expect(typeof methods.rpcStartRun).toBe('function')
    expect(typeof methods.rpcRunStatus).toBe('function')
    expect(typeof methods.rpcInProgressRuns).toBe('function')
    expect(typeof methods.rpcInstanceStates).toBe('function')
    expect(typeof methods.rpcHistoryVector).toBe('function')
    expect(typeof methods.rpcHistoryMatmul).toBe('function')
    expect(typeof methods.rpcHistoryConvolution).toBe('function')
  })
})

