import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InProgressRunsCard } from './InProgressRunsCard'

describe('InProgressRunsCard', () => {
  it('renders the in-progress run payload', () => {
    render(<InProgressRunsCard items={[{ runId: 'run-1', status: 'RUNNING', benchmark: 'vector', runner: 'cpu', params: { vectorLength: 128 } }]} />)

    expect(screen.getByText('Active Runs')).toBeInTheDocument()
    expect(screen.getByText(/"runId": "run-1"/)).toBeInTheDocument()
    expect(screen.getByText(/"vectorLength": 128/)).toBeInTheDocument()
  })
})
