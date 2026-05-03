import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InProgressRunsCard } from './InProgressRunsCard'

describe('InProgressRunsCard', () => {
  it('starts collapsed and shows the active run count badge', () => {
    render(<InProgressRunsCard items={[{ runId: 'run-1', status: 'RUNNING', benchmark: 'vector', runner: 'cpu', params: { vectorLength: 128 } }]} />)

    expect(screen.getByText('Active Runs')).toBeInTheDocument()
    expect(screen.getByText('1 queued/active run')).toBeInTheDocument()
    expect(screen.queryByText(/"runId": "run-1"/)).not.toBeInTheDocument()
  })

  it('reveals the payload when expanded', async () => {
    const user = userEvent.setup()

    render(<InProgressRunsCard items={[{ runId: 'run-1', status: 'RUNNING', benchmark: 'vector', runner: 'cpu', params: { vectorLength: 128 } }]} />)

    await user.click(screen.getByRole('button', { name: /active runs/i }))

    expect(screen.getByText(/"runId": "run-1"/)).toBeInTheDocument()
    expect(screen.getByText(/"vectorLength": 128/)).toBeInTheDocument()
  })
})
