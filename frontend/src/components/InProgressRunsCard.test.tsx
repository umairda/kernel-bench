import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunRecord } from '../lib/api'
import { InProgressRunsCard } from './InProgressRunsCard'

function renderWithClient(items: RunRecord[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <InProgressRunsCard items={items} />
    </QueryClientProvider>,
  )
}

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    runId: 'run-1',
    status: 'QUEUED',
    benchmark: 'vector',
    runner: 'cpu',
    params: { vectorLength: 128 },
    createdAt: '2026-05-03T10:00:00Z',
    queuedAt: '2026-05-03T10:00:00Z',
    ...overrides,
  }
}

describe('InProgressRunsCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders queued runs in priority order with only the first run open by default', () => {
    renderWithClient([
      run({ runId: 'run-2', queuedAt: '2026-05-03T10:01:00Z', params: { vectorLength: 256 } }),
      run({ runId: 'run-1', queuedAt: '2026-05-03T10:00:00Z' }),
    ])

    expect(screen.getByText('Queued Runs')).toBeInTheDocument()
    expect(screen.getByText('2 queued runs')).toBeInTheDocument()
    expect(screen.getByText('Priority 1: CPU Vector')).toBeInTheDocument()
    expect(screen.getByText('Priority 2: CPU Vector')).toBeInTheDocument()
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.queryByText('run-2')).not.toBeInTheDocument()
  })

  it('allows multiple run details to be open at the same time', async () => {
    const user = userEvent.setup()
    renderWithClient([
      run({ runId: 'run-1', queuedAt: '2026-05-03T10:00:00Z' }),
      run({ runId: 'run-2', queuedAt: '2026-05-03T10:01:00Z', params: { vectorLength: 256 } }),
    ])

    await user.click(screen.getByRole('button', { name: /priority 2/i }))

    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('run-2')).toBeInTheDocument()
  })

  it('deletes a queued run through the API', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        result: { ok: true, runId: 'run-1', runner: 'cpu' },
      }),
    } as Response)
    renderWithClient([run({ runId: 'run-1' })])

    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api$/), expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"method":"deleteQueuedRun"'),
    }))
  })
})
