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
    expect(screen.getByText('Total Duration: 2,500 ms')).toBeInTheDocument()
    expect(screen.getByText('333 ms')).toBeInTheDocument()
  })
})
