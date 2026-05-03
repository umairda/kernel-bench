import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunStatusCard } from './RunStatusCard'

describe('RunStatusCard', () => {
  it('shows an idle state when no run exists', () => {
    render(<RunStatusCard title="CPU" instanceState="stopped" />)

    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('No run started.')).toBeInTheDocument()
  })

  it('shows startup and performance details for an active run', () => {
    render(
      <RunStatusCard
        title="GPU"
        instanceState="running"
        run={{
          runId: 'run-42',
          status: 'STARTING',
          benchmark: 'matrix-multiplication',
          runner: 'gpu',
          params: { inputRows: 64, inputCols: 32, outputCols: 16 },
          startupProgress: {
            phase: 'booting',
            ec2State: 'pending',
            instanceStatus: 'initializing',
            systemStatus: 'initializing',
            ssmPingStatus: 'offline',
            detail: 'Waiting for instance checks',
          },
          performance: {
            totalDurationMs: 2500,
            phaseDurationsMs: {
              queueStartRequestMs: 100,
              instanceBootSsmReadyMs: 1200,
              buildSetupMs: 600,
              gpuWarmupMs: 180,
              benchmarkExecutionMs: 400,
              uploadFinalizationMs: 200,
            },
            operationDurations: [{ name: 'matmul', durationMs: 333 }],
          },
        }}
      />,
    )

    expect(screen.getByText('run-42')).toBeInTheDocument()
    expect(screen.getByText('64x32 * 32x16')).toBeInTheDocument()
    expect(screen.getByText('Startup Progress')).toBeInTheDocument()
    expect(screen.getByText('Waiting for instance checks')).toBeInTheDocument()
    expect(screen.getByText('Total Duration: 2.5 s')).toBeInTheDocument()
    expect(screen.getByText('CUDA warmup')).toBeInTheDocument()
    expect(screen.getByText('180 ms')).toBeInTheDocument()
    expect(screen.getByText('333 ms')).toBeInTheDocument()
  })

  it('shows elapsed duration for completed runs from created to completed time', () => {
    render(
      <RunStatusCard
        title="CPU"
        instanceState="stopped"
        run={{
          runId: 'run-complete',
          status: 'COMPLETED',
          benchmark: 'vector',
          runner: 'cpu',
          params: { vectorLength: 128 },
          createdAt: '2026-05-02T19:00:00.000Z',
          completedAt: '2026-05-02T19:04:10.000Z',
        }}
      />,
    )

    expect(screen.getByText('COMPLETED [4:10]', { exact: false })).toBeInTheDocument()
  })

  it('shows failure reason and error details', () => {
    render(
      <RunStatusCard
        title="CPU"
        instanceState="stopped"
        run={{
          runId: 'run-failed',
          status: 'FAILED',
          benchmark: 'matrix-multiplication',
          runner: 'cpu',
          params: { inputRows: 10000, inputCols: 10000, outputCols: 10000 },
          reason: 'WORKFLOW_STEP_EXCEPTION',
          error: 'Pass options.removeUndefinedValues=true to remove undefined values from map/array/set.',
        }}
      />,
    )

    expect(screen.getByText('Reason:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('WORKFLOW_STEP_EXCEPTION')).toBeInTheDocument()
    expect(screen.getByText('Error:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/removeUndefinedValues=true/)).toBeInTheDocument()
  })

  it('shows a fallback duration section for failed runs without performance data', () => {
    render(
      <RunStatusCard
        title="CPU"
        instanceState="stopped"
        run={{
          runId: 'run-failed-no-performance',
          status: 'FAILED',
          benchmark: 'matrix-multiplication',
          runner: 'cpu',
          params: { inputRows: 10000, inputCols: 10000, outputCols: 10000 },
          createdAt: '2026-05-02T23:07:57.000Z',
          completedAt: '2026-05-02T23:09:32.000Z',
          reason: 'WORKFLOW_STEP_EXCEPTION',
        }}
      />,
    )

    expect(screen.getByText('Total Duration: 95.0 s')).toBeInTheDocument()
    expect(screen.getByText('Phase Durations')).toBeInTheDocument()
    expect(screen.getByText('queue/start request')).toBeInTheDocument()
  })

  it('does not show failure details for completed runs', () => {
    render(
      <RunStatusCard
        title="CPU"
        instanceState="stopped"
        run={{
          runId: 'run-completed',
          status: 'COMPLETED',
          benchmark: 'vector',
          runner: 'cpu',
          params: { vectorLength: 100000 },
          reason: 'STALE_REASON_SHOULD_NOT_SHOW',
          error: 'stale error should not show',
        }}
      />,
    )

    expect(screen.queryByText('Reason:', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('STALE_REASON_SHOULD_NOT_SHOW')).not.toBeInTheDocument()
    expect(screen.queryByText('Error:', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('stale error should not show')).not.toBeInTheDocument()
  })
})
