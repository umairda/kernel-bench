import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Spotlight } from './spotlight'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

describe('Spotlight', () => {
  it('renders the svg spotlight with the provided fill', () => {
    const { container } = render(<Spotlight className="custom-spotlight" fill="rgb(1, 2, 3)" />)

    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.firstChild).toHaveClass('custom-spotlight')
    expect(container.querySelector('ellipse')).toHaveAttribute('fill', 'rgb(1, 2, 3)')
  })
})
