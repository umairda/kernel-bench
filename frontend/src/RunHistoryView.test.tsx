import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RunHistoryView from './RunHistoryView'
import type { RunHistoryRow } from './lib/api'
import { useGetRunHistoryQuery, useStartRunMutation } from './lib/api'

vi.mock('./lib/api', () => ({
  useGetRunHistoryQuery: vi.fn(),
  useStartRunMutation: vi.fn(),
}))

const mockUseGetRunHistoryQuery = vi.mocked(useGetRunHistoryQuery)
const mockUseStartRunMutation = vi.mocked(useStartRunMutation)

function mockQueryResult(items: RunHistoryRow[] | undefined, isPending = false): ReturnType<typeof useGetRunHistoryQuery> {
  return {
    data: items ? { items } : undefined,
    isPending,
  } as unknown as ReturnType<typeof useGetRunHistoryQuery>
}

function makeRun(overrides: Partial<RunHistoryRow>): RunHistoryRow {
  return {
    runId: 'run-default',
    status: 'COMPLETED',
    benchmark: 'vector',
    runner: 'cpu',
    params: {},
    ...overrides,
  }
}

describe('RunHistoryView', () => {
  beforeEach(() => {
    mockUseGetRunHistoryQuery.mockReset()
    mockUseStartRunMutation.mockReset()
    mockUseStartRunMutation.mockReturnValue({ isPending: false, mutateAsync: vi.fn() } as never)
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('shows a loading state while history is pending', () => {
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult(undefined, true))

    render(<RunHistoryView />)

    expect(screen.getByText('Loading run history')).toBeInTheDocument()
  })

  it('shows an empty state when there are no runs', () => {
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult([]))

    render(<RunHistoryView />)

    expect(screen.getByText('No completed or failed runs yet.')).toBeInTheDocument()
  })

  it('renders newest runs first by created date and formats fields', () => {
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult([
      makeRun({
        runId: 'run-older',
        createdAt: '2026-05-01T01:00:00.000Z',
        benchmark: 'matrix-multiplication',
        runner: 'gpu',
        params: { inputRows: 64, inputCols: 64, outputCols: 64 },
        performance: {
          operationDurations: [{ name: 'matmul', durationMs: 65000 }],
        },
      }),
      makeRun({
        runId: 'run-newer',
        createdAt: '2026-05-01T03:00:00.000Z',
        status: 'FAILED',
        benchmark: 'vector',
        runner: 'cpu',
        params: { vectorLength: 128 },
        performance: {
          operationDurations: [
            { name: 'add', durationMs: 400 },
            { name: 'subtract', durationMs: 200 },
          ],
        },
      }),
    ]))

    render(<RunHistoryView />)

    const rows = screen.getAllByRole('row')
    const firstBodyRow = rows[1]
    const secondBodyRow = rows[2]

    expect(within(firstBodyRow).getByText('run-newer')).toBeInTheDocument()
    expect(within(secondBodyRow).getByText('run-older')).toBeInTheDocument()
    expect(screen.getByText('Matrix Multiplication')).toBeInTheDocument()
    expect(screen.getByText('600 ms')).toBeInTheDocument()
    expect(screen.getByText('1.1min')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('n=128')).toBeInTheDocument()
    expect(screen.getByText('64x64 * 64x64')).toBeInTheDocument()
  })

  it('copies the run id when the run id is clicked', () => {
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult([
      makeRun({ runId: 'run-copy-me', createdAt: '2026-05-01T01:00:00.000Z' }),
    ]))

    render(<RunHistoryView />)

    fireEvent.click(screen.getByRole('button', { name: 'run-copy-me' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('run-copy-me')
  })

  it('shows a retry button for failed runs and resubmits the original run payload', () => {
    const mutateAsync = vi.fn().mockResolvedValue({ runId: 'retry-run-id' })
    mockUseStartRunMutation.mockReturnValue({ isPending: false, mutateAsync } as never)
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult([
      makeRun({
        runId: 'run-failed',
        status: 'FAILED',
        benchmark: 'matrix-multiplication',
        runner: 'gpu',
        params: { inputRows: 64, inputCols: 64, outputCols: 64 },
      }),
      makeRun({
        runId: 'run-success',
        status: 'COMPLETED',
      }),
    ]))

    render(<RunHistoryView />)

    fireEvent.click(screen.getByRole('button', { name: /retry run-failed/i }))

    expect(mutateAsync).toHaveBeenCalledWith({
      runner: 'gpu',
      benchmark: 'matrix-multiplication',
      params: { inputRows: 64, inputCols: 64, outputCols: 64 },
    })
    expect(screen.queryByRole('button', { name: /retry run-success/i })).not.toBeInTheDocument()
  })

  it('sorts by operation duration when the header is clicked', () => {
    mockUseGetRunHistoryQuery.mockReturnValue(mockQueryResult([
      makeRun({
        runId: 'run-fast',
        createdAt: '2026-05-01T01:00:00.000Z',
        performance: {
          operationDurations: [{ name: 'add', durationMs: 100 }],
        },
      }),
      makeRun({
        runId: 'run-slow',
        createdAt: '2026-05-01T02:00:00.000Z',
        performance: {
          operationDurations: [{ name: 'add', durationMs: 900 }],
        },
      }),
    ]))

    render(<RunHistoryView />)

    const durationSortButton = screen.getByRole('button', { name: /operation duration/i })

    fireEvent.click(durationSortButton)
    fireEvent.click(durationSortButton)

    const rows = screen.getAllByRole('row')
    const firstBodyRow = rows[1]
    const secondBodyRow = rows[2]

    expect(within(firstBodyRow).getByText('run-fast')).toBeInTheDocument()
    expect(within(secondBodyRow).getByText('run-slow')).toBeInTheDocument()
  })
})
