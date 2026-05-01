import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShimmerButton } from './shimmer-button'

describe('ShimmerButton', () => {
  it('forwards button props and clicks', () => {
    const onClick = vi.fn()
    render(<ShimmerButton onClick={onClick}>Run</ShimmerButton>)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('supports the disabled state', () => {
    render(<ShimmerButton disabled>Disabled</ShimmerButton>)

    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled()
  })
})
