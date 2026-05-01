import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccordionSection } from './accordion-section'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

describe('AccordionSection', () => {
  it('renders open content and calls onToggle', () => {
    const onToggle = vi.fn()
    render(
      <AccordionSection title="Section Title" open onToggle={onToggle}>
        <div>Section Body</div>
      </AccordionSection>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Section Title/i }))

    expect(screen.getByText('Section Body')).toBeInTheDocument()
    expect(screen.getByText('Collapse')).toBeInTheDocument()
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('hides content when closed', () => {
    render(
      <AccordionSection title="Closed Section" open={false} onToggle={() => undefined}>
        <div>Hidden Body</div>
      </AccordionSection>,
    )

    expect(screen.queryByText('Hidden Body')).not.toBeInTheDocument()
    expect(screen.getByText('Expand')).toBeInTheDocument()
  })
})
