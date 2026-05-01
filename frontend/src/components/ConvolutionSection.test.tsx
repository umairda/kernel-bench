import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvolutionSection } from './ConvolutionSection'
import { useStartRunMutation } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    useStartRunMutation: vi.fn(),
  }
})

describe('ConvolutionSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits convolution params for a CPU run', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ runId: 'cpu-conv-1' })
    vi.mocked(useStartRunMutation).mockReturnValue({ isPending: false, mutateAsync } as never)

    const onCpuRunStarted = vi.fn()
    const onCpuStartError = vi.fn()

    render(
      <ConvolutionSection
        cpuState="stopped"
        gpuState="stopped"
        onCpuRunStarted={onCpuRunStarted}
        onGpuRunStarted={vi.fn()}
        onCpuStartError={onCpuStartError}
        onGpuStartError={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Input H'), { target: { value: '128' } })
    fireEvent.change(screen.getByLabelText('Pad W'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Run CPU/i }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        runner: 'cpu',
        benchmark: 'convolution',
        params: {
          inputN: 1,
          inputC: 3,
          inputH: 128,
          inputW: 64,
          filterOutC: 16,
          filterH: 3,
          filterW: 3,
          strideH: 1,
          strideW: 1,
          padH: 1,
          padW: 2,
        },
      })
    })
    expect(onCpuStartError).toHaveBeenCalledWith(null)
    expect(onCpuRunStarted).toHaveBeenCalledWith('cpu-conv-1')
  })
})
