import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MatmulSection } from './MatmulSection'
import { useStartRunMutation } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    useStartRunMutation: vi.fn(),
  }
})

describe('MatmulSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits the updated matrix params for a GPU run', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ runId: 'gpu-matmul-1' })
    vi.mocked(useStartRunMutation).mockReturnValue({ isPending: false, mutateAsync } as never)

    const onGpuRunStarted = vi.fn()
    const onGpuStartError = vi.fn()

    render(
      <MatmulSection
        cpuState="stopped"
        gpuState="stopped"
        onCpuRunStarted={vi.fn()}
        onGpuRunStarted={onGpuRunStarted}
        onCpuStartError={vi.fn()}
        onGpuStartError={onGpuStartError}
      />,
    )

    fireEvent.change(screen.getByLabelText('Input Rows'), { target: { value: '512' } })
    fireEvent.change(screen.getByLabelText('Input Cols (= Output Rows)'), { target: { value: '128' } })
    fireEvent.change(screen.getByLabelText('Output Cols'), { target: { value: '64' } })
    fireEvent.click(screen.getByRole('button', { name: /Run GPU/i }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        runner: 'gpu',
        benchmark: 'matrix-multiplication',
        params: { inputRows: 512, inputCols: 128, outputCols: 64 },
      })
    })
    expect(onGpuStartError).toHaveBeenCalledWith(null)
    expect(onGpuRunStarted).toHaveBeenCalledWith('gpu-matmul-1')
  })
})
