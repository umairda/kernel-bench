import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GlowCard } from './glow-card'

describe('GlowCard', () => {
  it('renders its children and optional className', () => {
    const { container } = render(<GlowCard className="extra-card-class"><span>Body</span></GlowCard>)

    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('extra-card-class')
  })
})
