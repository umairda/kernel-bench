import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Loader2, Moon, Sun } from 'lucide-react'
import { ConvolutionSection } from './components/ConvolutionSection'
import { HistoryTabButton } from './components/HistoryTabButton'
import { InProgressRunsCard } from './components/InProgressRunsCard'
import { MatmulSection } from './components/MatmulSection'
import { VectorSection } from './components/VectorSection'
import { GlowCard } from './components/aceternity/glow-card'
import { Spotlight } from './components/aceternity/spotlight'
import {
  type Runner,
  type RunRecord,
  useGetInstanceStatesQuery,
  useGetRunStatusQuery,
  useListInProgressRunsQuery,
} from './lib/api'

type CompareRunState = {
  cpuRunId: string | null
  gpuRunId: string | null
  cpuStartError: string | null
  gpuStartError: string | null
}

type Theme = 'light' | 'dark'
type BenchmarkTab = 'vector' | 'matmul' | 'conv'
type AppTab = 'run' | 'historical'
const HistoricalView = lazy(() => import('./HistoricalView'))

const initialCompareState: CompareRunState = {
  cpuRunId: null,
  gpuRunId: null,
  cpuStartError: null,
  gpuStartError: null,
}

function formatInstanceStateTitle(state: string) {
  return state !== 'stopped' ? `Instance state is ${state.toUpperCase()}` : undefined
}

function resolveInstanceState(value: string | undefined, isPending: boolean, isError: boolean) {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (isPending) {
    return 'loading'
  }
  if (isError) {
    return 'error'
  }
  return 'unknown'
}

function sectionExecuting(runCpu?: RunRecord, runGpu?: RunRecord, cpuLaunching?: boolean, gpuLaunching?: boolean) {
  return (
    cpuLaunching ||
    gpuLaunching ||
    runCpu?.status === 'STARTING' ||
    runCpu?.status === 'RUNNING' ||
    runGpu?.status === 'STARTING' ||
    runGpu?.status === 'RUNNING'
  )
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('kernelbench-theme')
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [appTab, setAppTab] = useState<AppTab>('run')
  const [activeRunTab, setActiveRunTab] = useState<BenchmarkTab>('vector')
  const [historyRunner, setHistoryRunner] = useState<Runner | 'all'>('all')

  const [vectorRuns, setVectorRuns] = useState<CompareRunState>(initialCompareState)
  const [matmulRuns, setMatmulRuns] = useState<CompareRunState>(initialCompareState)
  const [convRuns, setConvRuns] = useState<CompareRunState>(initialCompareState)

  const vectorCpu = useGetRunStatusQuery(vectorRuns.cpuRunId)
  const vectorGpu = useGetRunStatusQuery(vectorRuns.gpuRunId)
  const matmulCpu = useGetRunStatusQuery(matmulRuns.cpuRunId)
  const matmulGpu = useGetRunStatusQuery(matmulRuns.gpuRunId)
  const convCpu = useGetRunStatusQuery(convRuns.cpuRunId)
  const convGpu = useGetRunStatusQuery(convRuns.gpuRunId)

  const inProgressRuns = useListInProgressRunsQuery()
  const instanceStates = useGetInstanceStatesQuery()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('kernelbench-theme', theme)
  }, [theme])

  const isAnyExecuting = useMemo(() => {
    return (
      sectionExecuting(vectorCpu.data, vectorGpu.data) ||
      sectionExecuting(matmulCpu.data, matmulGpu.data) ||
      sectionExecuting(convCpu.data, convGpu.data)
    )
  }, [
    vectorCpu.data,
    vectorGpu.data,
    matmulCpu.data,
    matmulGpu.data,
    convCpu.data,
    convGpu.data,
  ])

  const cpuState = resolveInstanceState(instanceStates.data?.cpu, instanceStates.isPending, instanceStates.isError)
  const gpuState = resolveInstanceState(instanceStates.data?.gpu, instanceStates.isPending, instanceStates.isError)

  const renderRunTab = () => (
    <div className="space-y-4">
      <InProgressRunsCard items={inProgressRuns.data?.items ?? []} />

      <div className="rounded-2xl border border-zinc-300/70 bg-white/80 p-2 dark:border-white/10 dark:bg-zinc-900/50">
        <div className="grid gap-2 md:grid-cols-3">
          <HistoryTabButton active={activeRunTab === 'vector'} onClick={() => setActiveRunTab('vector')}>Vector</HistoryTabButton>
          <HistoryTabButton active={activeRunTab === 'matmul'} onClick={() => setActiveRunTab('matmul')}>Matrix Multiplication</HistoryTabButton>
          <HistoryTabButton active={activeRunTab === 'conv'} onClick={() => setActiveRunTab('conv')}>Convolution</HistoryTabButton>
        </div>
      </div>

      {activeRunTab === 'vector' ? (
        <VectorSection
          cpuState={cpuState}
          gpuState={gpuState}
          cpuRun={vectorCpu.data}
          gpuRun={vectorGpu.data}
          cpuStartError={vectorRuns.cpuStartError}
          gpuStartError={vectorRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setVectorRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setVectorRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setVectorRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setVectorRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}

      {activeRunTab === 'matmul' ? (
        <MatmulSection
          cpuState={cpuState}
          gpuState={gpuState}
          cpuRun={matmulCpu.data}
          gpuRun={matmulGpu.data}
          cpuStartError={matmulRuns.cpuStartError}
          gpuStartError={matmulRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setMatmulRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setMatmulRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setMatmulRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setMatmulRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}

      {activeRunTab === 'conv' ? (
        <ConvolutionSection
          cpuState={cpuState}
          gpuState={gpuState}
          cpuRun={convCpu.data}
          gpuRun={convGpu.data}
          cpuStartError={convRuns.cpuStartError}
          gpuStartError={convRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setConvRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setConvRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setConvRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setConvRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}
    </div>
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-100 px-4 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Spotlight className="-top-8 hidden dark:block" />
      <Spotlight className="left-1/2 top-40 hidden dark:block" fill="rgba(129,140,248,0.2)" />
      <div className="relative z-10 mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="bg-gradient-to-r from-cyan-700 via-zinc-900 to-indigo-700 bg-clip-text text-4xl font-bold tracking-tight text-transparent dark:from-cyan-300 dark:via-white dark:to-indigo-300">
              KernelBench
            </h1>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-cyan-400 dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Run CPU and GPU benchmarks, inspect live status, and browse historical performance through the same JSON-RPC API.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-300/70 bg-white/80 p-2 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="grid gap-2 md:grid-cols-2">
            <HistoryTabButton active={appTab === 'run'} onClick={() => setAppTab('run')}>Run</HistoryTabButton>
            <HistoryTabButton active={appTab === 'historical'} onClick={() => setAppTab('historical')}>Historical</HistoryTabButton>
          </div>
        </div>

        {appTab === 'run' ? (
          renderRunTab()
        ) : (
          <Suspense
            fallback={
              <GlowCard>
                <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading historical charts
                </div>
              </GlowCard>
            }
          >
            <HistoricalView historyRunner={historyRunner} onRunnerChange={setHistoryRunner} />
          </Suspense>
        )}

        {isAnyExecuting ? (
          <div className="fixed bottom-6 right-6 inline-flex items-center rounded-full border border-cyan-500/40 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 shadow-lg dark:border-cyan-400/40 dark:bg-zinc-950 dark:text-cyan-100 dark:shadow-none">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Test Executing
          </div>
        ) : null}
      </div>
    </main>
  )
}

export default App
