import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryTabButton } from './HistoryTabButton'

describe('HistoryTabButton', () => {
  it('renders its label and handles clicks', () => {
    const onClick = vi.fn()
    render(<HistoryTabButton active onClick={onClick}>Vector</HistoryTabButton>)

    fireEvent.click(screen.getByRole('button', { name: 'Vector' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies inactive styling when not active', () => {
    render(<HistoryTabButton active={false} onClick={() => undefined}>Historical</HistoryTabButton>)

    expect(screen.getByRole('button', { name: 'Historical' })).toHaveClass('bg-transparent')
  })
})
