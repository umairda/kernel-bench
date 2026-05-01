import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NumberField } from './NumberField'

describe('NumberField', () => {
  it('formats the displayed value', () => {
    render(<NumberField label="Vector Length" value={100000} onChange={() => undefined} />)

    expect(screen.getByLabelText('Vector Length')).toHaveValue('100,000')
  })

  it('sanitizes numeric input before calling onChange', () => {
    const onChange = vi.fn()
    render(<NumberField label="Vector Length" value={100000} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Vector Length'), { target: { value: '12,3abc' } })

    expect(onChange).toHaveBeenCalledWith(123)
  })

  it('uses NaN for an empty input and respects the minimum', () => {
    const onChange = vi.fn()
    render(<NumberField label="Stride" value={3} min={5} onChange={onChange} />)
    const input = screen.getByLabelText('Stride')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '2' } })

    expect(onChange).toHaveBeenNthCalledWith(1, Number.NaN)
    expect(onChange).toHaveBeenNthCalledWith(2, 5)
  })
})
