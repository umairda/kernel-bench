import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { VectorSection } from './VectorSection'
import { useStartRunMutation } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    useStartRunMutation: vi.fn(),
  }
})

describe('VectorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a CPU vector run with the local form params', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ runId: 'cpu-vector-1' })
    vi.mocked(useStartRunMutation).mockReturnValue({ isPending: false, mutateAsync } as never)

    const onCpuRunStarted = vi.fn()
    const onCpuStartError = vi.fn()

    render(
      <VectorSection
        cpuState="stopped"
        gpuState="stopped"
        onCpuRunStarted={onCpuRunStarted}
        onGpuRunStarted={vi.fn()}
        onCpuStartError={onCpuStartError}
        onGpuStartError={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Run CPU/i }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        runner: 'cpu',
        benchmark: 'vector',
        params: { vectorLength: 100000 },
      })
    })
    expect(onCpuStartError).toHaveBeenCalledWith(null)
    expect(onCpuRunStarted).toHaveBeenCalledWith('cpu-vector-1')
  })
})
